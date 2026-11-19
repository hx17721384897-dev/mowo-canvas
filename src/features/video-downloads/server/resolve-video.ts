import { randomUUID } from "node:crypto";
import { z } from "zod";
import { normalizeVideoUrl, type ResolvedVideo, type VideoChoice } from "../types.ts";
import { VideoTaskError } from "./task-store.ts";

const optionalNumber = z.number().finite().nonnegative().nullable();
const formatSchema = z.object({ format_id: z.string().regex(/^[A-Za-z0-9_.-]{1,80}$/), ext: z.string().nullable(),
  width: optionalNumber, height: optionalNumber, fps: optionalNumber, vcodec: z.string().nullable(), acodec: z.string().nullable(),
  filesize: optionalNumber, filesize_approx: optionalNumber, tbr: optionalNumber, format_note: z.string().nullable() });
const resultSchema = z.object({ sourceUrl: z.string(), bvid: z.string(), part: z.number().int().positive(), cid: z.string().regex(/^\d+$/),
  title: z.string().max(1000), duration: optionalNumber, cover: z.string().nullable(),
  pages: z.array(z.object({ part: z.number().int().positive().max(10000), title: z.string().max(1000), duration: optionalNumber })).min(1).max(10000),
  formats: z.array(formatSchema).max(200) });

export function resolvedVideo(input: unknown): { video: ResolvedVideo; choices: VideoChoice[] } {
  const parsed = resultSchema.safeParse(input);
  if (!parsed.success) throw new VideoTaskError("RESOLVE_FAILED");
  const data = parsed.data; const source = normalizeVideoUrl(data.sourceUrl);
  if (source.bvid !== data.bvid || source.part !== data.part) throw new VideoTaskError("RESOLVE_FAILED");
  const audio = data.formats.filter(f => f.vcodec === "none" && f.acodec && f.acodec !== "none")
    .sort((a, b) => Number(b.acodec?.startsWith("mp4a")) - Number(a.acodec?.startsWith("mp4a")) || (b.tbr ?? 0) - (a.tbr ?? 0))[0];
  const choices = data.formats.filter(f => f.vcodec && f.vcodec !== "none" && f.height)
    .sort((a, b) => Number(b.vcodec?.startsWith("avc")) - Number(a.vcodec?.startsWith("avc")) || (b.height ?? 0) - (a.height ?? 0) || (b.fps ?? 0) - (a.fps ?? 0))
    .map(f => {
      const separate = !f.acodec || f.acodec === "none";
      const parts = separate && audio ? [f, audio] : [f];
      const sizes = parts.map(p => p.filesize ?? p.filesize_approx);
      return { id: f.format_id, formatIds: parts.map(p => p.format_id),
        label: `${f.height}p · ${f.fps ?? "未知"}fps · ${f.vcodec?.startsWith("avc") ? "H.264" : /^(hev|hvc)/.test(f.vcodec ?? "") ? "HEVC" : f.vcodec} ${separate && !audio ? "· 无声" : ""}`,
        size: sizes.every(s => s !== null) ? sizes.reduce<number>((sum, s) => sum + (s ?? 0), 0) : null,
        requireAudio: !separate || !!audio };
    });
  if (!choices.length) throw new VideoTaskError("RESOLVE_FAILED");
  let cover: string | null = null;
  try { const url = new URL(data.cover ?? ""); if (["http:", "https:"].includes(url.protocol) && /(^|\.)hdslb\.com$/.test(url.hostname) && !url.username && !url.password && !url.port) { url.protocol = "https:"; cover = url.href; } } catch { /* optional cover */ }
  return { video: { resolveId: randomUUID(), ...source, cid: data.cid, title: data.title.slice(0, 200), duration: data.duration, cover, pages: data.pages, choices }, choices };
}
