import "server-only";

import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getAssetDataPaths, resolveStoredAssetPath } from "@/features/assets/server/data-paths";
import { getAssetDatabase } from "@/features/assets/server/database";
import { assets, projectAssets, videoShotAnalyses } from "@/features/assets/server/schema";
import { ensureFrameIndex, frameIndexStatus } from "./frame-index";
import { invokeEngine } from "../../../../scripts/video/engine-client.mjs";

const modelHash = "af5bc7dcbc517613d0d7fb39ee97add80e52a05d8de4717652e500a5bf573810";
type Cut = { frame: number; score: number };
type ShotState = { status: "idle" | "waiting" | "running" | "ready" | "failed" | "interrupted" | "missing";
  progressFrames?: number; frameCount?: number; cuts?: Cut[]; device?: "cpu" | "dml"; error?: string;
  manuallyEdited?: boolean; editRevision?: number };
const processState = globalThis as typeof globalThis & { __mowoShotRunning?: Map<string, AbortController> };
const running = processState.__mowoShotRunning ??= new Map<string, AbortController>();
const pendingStarts = new Map<string, Promise<ShotState>>();

async function sourceFor(projectId: string, assetId: string) {
  const database = await getAssetDatabase();
  const asset = database.select({ asset: assets }).from(projectAssets)
    .innerJoin(assets, eq(projectAssets.assetId, assets.id))
    .where(and(eq(projectAssets.projectId, projectId), eq(projectAssets.assetId, assetId), isNull(assets.deletedAt))).get()?.asset;
  if (!asset || asset.type !== "video" || asset.sourceType === "video-clip" || !asset.relativePath || !asset.contentHash) return null;
  return { path: resolveStoredAssetPath(asset.relativePath), hash: asset.contentHash };
}

function rowState(row: typeof videoShotAnalyses.$inferSelect): ShotState {
  let cuts: Cut[] = [];
  try { cuts = JSON.parse(row.status === "ready" && row.manualCutsJson !== null ? row.manualCutsJson : row.cutsJson) as Cut[]; }
  catch { /* invalid cache is treated as empty */ }
  return { status: row.status, progressFrames: row.progressFrames, frameCount: row.frameCount,
    cuts, device: row.device ?? undefined, error: row.errorMessage ?? undefined,
    manuallyEdited: row.manualCutsJson !== null, editRevision: row.editRevision };
}

export async function correctShotCuts(projectId: string, assetId: string, frames: unknown, expectedRevision: unknown) {
  const source = await sourceFor(projectId, assetId);
  if (!source) return { status: "missing" as const };
  const database = await getAssetDatabase();
  const where = and(eq(videoShotAnalyses.projectId, projectId), eq(videoShotAnalyses.sourceAssetId, assetId));
  const row = database.select().from(videoShotAnalyses).where(where).get();
  if (!row || row.status !== "ready" || row.sourceHash !== source.hash || row.modelHash !== modelHash)
    return { status: "conflict" as const, reason: "分镜结果尚未就绪，请刷新后重试" };
  if (!Array.isArray(frames) || !Number.isSafeInteger(expectedRevision) || expectedRevision !== row.editRevision ||
      frames.length >= row.frameCount || frames.some((frame, i) => !Number.isSafeInteger(frame) || frame <= 0 ||
        frame >= row.frameCount || (i > 0 && frame <= frames[i - 1]))) {
    return { status: "conflict" as const, reason: "切点无效或已被其他页面修改，请刷新后重试" };
  }
  const automatic = JSON.parse(row.cutsJson) as Cut[];
  const scores = new Map(automatic.map((cut) => [cut.frame, cut.score]));
  const cuts = (frames as number[]).map((frame) => ({ frame, score: scores.get(frame) ?? 1 }));
  const changed = database.update(videoShotAnalyses).set({ manualCutsJson: JSON.stringify(cuts),
    editRevision: row.editRevision + 1, updatedAt: new Date() })
    .where(and(where, eq(videoShotAnalyses.editRevision, row.editRevision), eq(videoShotAnalyses.status, "ready"))).run();
  if (changed.changes !== 1) return { status: "conflict" as const, reason: "切点已在其他页面更新，请刷新后重试" };
  return { status: "ready" as const, state: await shotAnalysisStatus(projectId, assetId) };
}

export async function shotAnalysisStatus(projectId: string, assetId: string): Promise<ShotState> {
  const source = await sourceFor(projectId, assetId);
  if (!source) return { status: "missing" };
  const database = await getAssetDatabase();
  const row = database.select().from(videoShotAnalyses).where(and(eq(videoShotAnalyses.projectId, projectId),
    eq(videoShotAnalyses.sourceAssetId, assetId))).get();
  if (!row || row.sourceHash !== source.hash || row.modelHash !== modelHash) return { status: "idle" };
  if ((row.status === "running" || row.status === "waiting") && !running.has(`${projectId}:${assetId}`)) {
    database.update(videoShotAnalyses).set({ status: "interrupted", errorMessage: "分镜任务已中断，可重新开始", updatedAt: new Date() })
      .where(and(eq(videoShotAnalyses.projectId, projectId), eq(videoShotAnalyses.sourceAssetId, assetId))).run();
    return { ...rowState(row), status: "interrupted", error: "分镜任务已中断，可重新开始" };
  }
  return rowState(row);
}

async function runtime() {
  const root = join(process.cwd(), "data", "video-runtime");
  let manifest: { directory: string };
  try { manifest = JSON.parse(await readFile(join(process.cwd(), "scripts", "video", "python-runtime.json"), "utf8")) as { directory: string }; }
  catch { throw new Error("分镜运行环境尚未准备，请运行 npm run video:setup-shots"); }
  if (!/^python-[\d.]+$/.test(manifest.directory)) throw new Error("分镜运行环境配置无效");
  const python = join(root, manifest.directory, "python.exe");
  const model = join(root, "models", "transnet-split.onnx");
  try { await Promise.all([python, model, join(root, manifest.directory, "shot-packages", "av")].map((path) => access(path))); }
  catch { throw new Error("分镜运行环境尚未准备，请运行 npm run video:setup-shots"); }
  return { python, model, device: "auto" as const };
}

async function processShot(projectId: string, assetId: string, source: { path: string; hash: string }, abort: AbortController) {
  const key = `${projectId}:${assetId}`;
  const database = await getAssetDatabase();
  const where = and(eq(videoShotAnalyses.projectId, projectId), eq(videoShotAnalyses.sourceAssetId, assetId));
  let output: string | undefined;
  try {
    let index = await frameIndexStatus(projectId, assetId);
    if (index.status !== "ready") {
      await ensureFrameIndex(projectId, assetId);
      index = await frameIndexStatus(projectId, assetId);
    }
    while (index.status !== "ready") {
      if (abort.signal.aborted) throw new Error("任务已取消");
      if (index.status === "failed" || index.status === "missing") throw new Error("源帧索引不可用，请重试");
      await new Promise((resolve) => setTimeout(resolve, 1500));
      index = await frameIndexStatus(projectId, assetId);
    }
    const { python, model, device } = await runtime();
    const directory = join(getAssetDataPaths().root, "cache", "video-editor", `shots-${source.hash}`);
    await mkdir(directory, { recursive: true });
    const indexPath = join(getAssetDataPaths().root, "cache", "video-editor", `${source.hash}-v1.sqlite`);
    output = join(directory, `${randomUUID()}.json`);
    database.update(videoShotAnalyses).set({ status: "running", device: null, frameCount: index.metadata.frameCount,
      updatedAt: new Date() }).where(where).run();
    let cuts: Cut[] = [];
    await invokeEngine({}, { python, signal: abort.signal, timeoutMs: 2 * 60 * 60 * 1000,
      managed: { root: join(getAssetDataPaths().root, "cache", "video-editor", "shot-control"), directory,
        command: [python, "-I", join(process.cwd(), "scripts", "video", "transnet_worker.py"),
          "--source", source.path, "--index", indexPath, "--model", model, "--output", output,
          "--device", device] },
      onEvent: (event) => {
        if (event.event !== "process_log" || typeof event.message !== "string") return;
        let item: { type?: string; frame?: number; score?: number; current?: number; total?: number;
          device?: string };
        try { item = JSON.parse(event.message); } catch { return; }
        if (item.type === "device" && (item.device === "cpu" || item.device === "dml"))
          database.update(videoShotAnalyses).set({ device: item.device, updatedAt: new Date() }).where(where).run();
        if (item.type === "reset") {
          cuts = [];
          database.update(videoShotAnalyses).set({ progressFrames: 0, cutsJson: "[]", device: "cpu",
            updatedAt: new Date() }).where(where).run();
          return;
        }
        if (item.type === "cut" && Number.isSafeInteger(item.frame) && typeof item.score === "number")
          cuts = [...cuts, { frame: item.frame!, score: item.score }];
        if (item.type === "progress" && Number.isSafeInteger(item.current) && item.current! >= 0)
          database.update(videoShotAnalyses).set({ progressFrames: item.current!,
            cutsJson: JSON.stringify(cuts), updatedAt: new Date() }).where(where).run();
      } });
    const result = JSON.parse(await readFile(output, "utf8")) as { sourceHash: string; modelSha256: string;
      frameCount: number; cuts: Cut[]; device?: string };
    if (result.sourceHash !== source.hash || result.modelSha256 !== modelHash ||
      (result.device !== "cpu" && result.device !== "dml") ||
      result.frameCount !== index.metadata.frameCount || !Array.isArray(result.cuts) ||
      result.cuts.some((cut, i) => !Number.isSafeInteger(cut.frame) || cut.frame <= 0 ||
        cut.frame >= result.frameCount || (i > 0 && cut.frame <= result.cuts[i - 1].frame)))
      throw new Error("分镜结果校验失败");
    database.update(videoShotAnalyses).set({ status: "ready", device: result.device, progressFrames: result.frameCount,
      frameCount: result.frameCount, cutsJson: JSON.stringify(result.cuts), errorMessage: null,
      updatedAt: new Date() }).where(where).run();
  } catch (error) {
    database.update(videoShotAnalyses).set({ status: abort.signal.aborted ? "interrupted" : "failed",
      errorMessage: abort.signal.aborted ? "分镜已取消，可重新开始" :
        error instanceof Error && ["分镜运行环境尚未准备，请运行 npm run video:setup-shots", "分镜运行环境配置无效", "源帧索引不可用，请重试"].includes(error.message)
          ? error.message : "分镜失败，请重试", updatedAt: new Date() }).where(where).run();
  } finally {
    if (output) await unlink(output).catch(() => undefined);
    running.delete(key);
  }
}

export async function startShotAnalysis(projectId: string, assetId: string): Promise<ShotState> {
  const source = await sourceFor(projectId, assetId);
  if (!source) return { status: "missing" };
  const key = `${projectId}:${assetId}`;
  if (pendingStarts.has(key)) return pendingStarts.get(key)!;
  const start = (async () => {
    const state = await shotAnalysisStatus(projectId, assetId);
    if (state.status === "ready" || state.status === "running" || state.status === "waiting") return state;
    const database = await getAssetDatabase();
    const now = new Date();
    database.insert(videoShotAnalyses).values({ projectId, sourceAssetId: assetId, sourceHash: source.hash,
      modelHash, status: "waiting", progressFrames: 0, frameCount: 0, cutsJson: "[]", createdAt: now,
      updatedAt: now }).onConflictDoUpdate({ target: [videoShotAnalyses.projectId, videoShotAnalyses.sourceAssetId],
      set: { sourceHash: source.hash, modelHash, status: "waiting", progressFrames: 0, frameCount: 0,
        cutsJson: "[]", device: null, errorMessage: null, updatedAt: now,
        manualCutsJson: sql`CASE WHEN ${videoShotAnalyses.sourceHash} = ${source.hash} THEN ${videoShotAnalyses.manualCutsJson} ELSE NULL END`,
        editRevision: sql`CASE WHEN ${videoShotAnalyses.sourceHash} = ${source.hash} THEN ${videoShotAnalyses.editRevision} ELSE 0 END` } }).run();
    const abort = new AbortController();
    running.set(key, abort);
    void processShot(projectId, assetId, source, abort);
    return { status: "waiting" as const, progressFrames: 0, frameCount: 0, cuts: [] };
  })().finally(() => pendingStarts.delete(key));
  pendingStarts.set(key, start);
  return start;
}

export async function cancelShotAnalysis(projectId: string, assetId: string) {
  const source = await sourceFor(projectId, assetId);
  if (!source) return { status: "missing" as const };
  running.get(`${projectId}:${assetId}`)?.abort();
  return shotAnalysisStatus(projectId, assetId);
}
