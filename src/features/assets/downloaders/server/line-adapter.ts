import "server-only";

import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { unzipSync } from "fflate";
import { createDownloadHttpClient } from "./http-client";
import { isAnimatedPng, isPng, makeApngLoopForever } from "./apng";
import type { DownloadContext, DownloadedFile, DownloadResult, ImageDownloadAdapter } from "./types";

const MAX_METADATA_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_ZIP_BYTES = 25 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 100 * 1024 * 1024;
const MAX_ITEMS = 500;

type LineSource = { packageId: string; kind: "sticker" | "emoji" };
type LineMeta = {
  title?: Record<string, string>;
  stickers?: Array<{ id?: string | number }>;
};

function parseLineUrl(url: URL): LineSource | null {
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);

  if (host === "store.line.me" && parts.length >= 3 && parts[1] === "product") {
    if (parts[0] === "stickershop" && /^\d+$/.test(parts[2])) return { packageId: parts[2], kind: "sticker" };
    if (parts[0] === "emojishop" && /^[a-f\d]+$/i.test(parts[2])) return { packageId: parts[2], kind: "emoji" };
  }
  if (host === "line.me" && parts.length >= 3 && parts[0].toLowerCase() === "s" && parts[1] === "sticker" && /^\d+$/.test(parts[2])) {
    return { packageId: parts[2], kind: "sticker" };
  }
  return null;
}

function pickTitle(meta: LineMeta | null, fallback: string) {
  const titles = meta?.title ?? {};
  return titles["zh-Hant"] || titles["zh-Hans"] || titles.en || Object.values(titles).find(Boolean) || fallback;
}

function safeFileStem(value: string, fallback: string) {
  const cleaned = basename(value).replace(/[^a-zA-Z0-9_-]/g, "_").replace(/^_+|_+$/g, "");
  return cleaned.slice(0, 80) || fallback;
}

function stickerUrls(id: string) {
  const base = `https://stickershop.line-scdn.net/stickershop/v1/sticker/${id}`;
  return [
    `${base}/IOS/sticker_animation@2x.png`,
    `${base}/IOS/sticker_popup.png`,
    `${base}/IOS/sticker_animation.png`,
    `${base}/ANDROID/sticker.png`,
  ].map((value) => new URL(value));
}

type DownloadBytes = Awaited<ReturnType<typeof createDownloadHttpClient>>["getBytes"];

async function downloadSticker(id: string, position: number, directory: string, signal: AbortSignal, getBytes: DownloadBytes) {
  for (const url of stickerUrls(id)) {
    try {
      const data = await getBytes(url, MAX_IMAGE_BYTES, signal);
      if (!isPng(data)) continue;
      const animated = isAnimatedPng(data);
      const storedData = animated ? makeApngLoopForever(data) : data;
      const name = `${safeFileStem(id, `sticker_${position + 1}`)}.${animated ? "apng" : "png"}`;
      const absolutePath = join(/* turbopackIgnore: true */ directory, name);
      await writeFile(absolutePath, storedData, { flag: "wx" });
      return { externalId: id, name, absolutePath, mimeType: "image/png", size: storedData.length, animated, position } satisfies DownloadedFile;
    } catch (error) {
      if (signal.aborted) throw error;
    }
  }
  return null;
}

async function runPool<T>(inputs: T[], limit: number, worker: (value: T, index: number) => Promise<void>) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, inputs.length) }, async () => {
    while (cursor < inputs.length) {
      const index = cursor++;
      await worker(inputs[index], index);
    }
  });
  await Promise.all(runners);
}

async function downloadStickerPackage(source: LineSource, meta: LineMeta, context: DownloadContext, getBytes: DownloadBytes): Promise<DownloadResult> {
  const ids = (meta.stickers ?? []).map((item) => String(item.id ?? "")).filter((id) => /^\d+$/.test(id)).slice(0, MAX_ITEMS);
  if (!ids.length) throw new Error("这个 LINE 商品没有可下载的贴纸项目");
  const title = pickTitle(meta, `LINE_${source.packageId}`);
  context.onResolved(ids.length, title, "sticker");
  const results: Array<DownloadedFile | null> = Array(ids.length).fill(null);
  let completed = 0;

  await runPool(ids, 4, async (id, position) => {
    results[position] = await downloadSticker(id, position, context.directory, context.signal, getBytes);
    completed += 1;
    context.onProgress(completed, ids.length);
  });

  const files = results.filter((item): item is DownloadedFile => item !== null);
  if (!files.length) throw new Error("没有下载到可用的 LINE 图片，请检查代理或商品类型");
  return { title, sourceKind: "sticker", files };
}

async function downloadEmojiPackage(source: LineSource, context: DownloadContext, getBytes: DownloadBytes): Promise<DownloadResult> {
  const pageUrl = new URL(`https://store.line.me/emojishop/product/${source.packageId}/zh-Hant`);
  const page = (await getBytes(pageUrl, MAX_METADATA_BYTES, context.signal)).toString("utf8");
  const titleMatch = page.match(/<p[^>]*class=["'][^"']*mdCMN38Item01Ttl[^"']*["'][^>]*>([^<]+)<\/p>/i)
    ?? page.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = (titleMatch?.[1]?.replace(/\s+[–-].*$/, "").trim()) || `LINE_Emoji_${source.packageId}`;
  const zipUrls = [
    `https://stickershop.line-scdn.net/sticonshop/v1/${source.packageId}/sticon/iphone/package_animation.zip`,
    `https://stickershop.line-scdn.net/sticonshop/v1/${source.packageId}/sticon/iphone/package.zip`,
  ];
  let zip: Buffer | null = null;
  for (const value of zipUrls) {
    try {
      zip = await getBytes(new URL(value), MAX_ZIP_BYTES, context.signal);
      break;
    } catch (error) {
      if (context.signal.aborted) throw error;
    }
  }
  if (!zip) throw new Error("这个 LINE 表情包没有可用的动画或静态资源包");

  let count = 0;
  let expanded = 0;
  const entries = unzipSync(zip, {
    filter(info) {
      if (!/\.png$/i.test(info.name)) return false;
      count += 1;
      expanded += info.originalSize;
      if (count > MAX_ITEMS || info.originalSize > MAX_IMAGE_BYTES || expanded > MAX_EXPANDED_BYTES) {
        throw new Error("LINE 表情包超过允许的文件数量或体积");
      }
      return true;
    },
  });
  const sorted = Object.entries(entries).sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }));
  if (!sorted.length) throw new Error("LINE 表情包中没有可用的 PNG 文件");
  context.onResolved(sorted.length, title, "emoji");

  const files: DownloadedFile[] = [];
  for (let position = 0; position < sorted.length; position += 1) {
    if (context.signal.aborted) throw context.signal.reason;
    const [entryName, data] = sorted[position];
    if (!isPng(data)) continue;
    const animated = isAnimatedPng(data);
    const storedData = animated ? makeApngLoopForever(data) : data;
    const stem = safeFileStem(basename(entryName, ".png"), `emoji_${position + 1}`);
    const name = `${stem}.${animated ? "apng" : "png"}`;
    const absolutePath = join(/* turbopackIgnore: true */ context.directory, name);
    await writeFile(absolutePath, storedData, { flag: "wx" });
    files.push({ externalId: stem, name, absolutePath, mimeType: "image/png", size: storedData.length, animated, position });
    context.onProgress(position + 1, sorted.length);
  }
  if (!files.length) throw new Error("LINE 表情包没有通过文件校验的图片");
  return { title, sourceKind: "emoji", files };
}

export const lineDownloadAdapter: ImageDownloadAdapter = {
  id: "line",
  supports(url) {
    return parseLineUrl(url) !== null;
  },
  async download(sourceUrl, context) {
    const url = new URL(sourceUrl);
    const source = parseLineUrl(url);
    if (!source) throw new Error("请输入受支持的 LINE 贴纸或表情包链接");
    await mkdir(context.directory, { recursive: true });
    const client = await createDownloadHttpClient();
    try {
      if (source.kind === "emoji") return await downloadEmojiPackage(source, context, client.getBytes);
      const metaUrl = new URL(`https://stickershop.line-scdn.net/stickershop/v1/product/${source.packageId}/iphone/productInfo.meta`);
      const meta = await client.getJson<LineMeta>(metaUrl, MAX_METADATA_BYTES, context.signal);
      return await downloadStickerPackage(source, meta, context, client.getBytes);
    } finally {
      await client.close();
    }
  },
};

export const lineAdapterInternals = { parseLineUrl, isPng, isAnimatedPng };
