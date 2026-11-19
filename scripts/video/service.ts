import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { mkdir, writeFile, statfs, copyFile, access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { z } from "zod";
import * as schema from "../../src/features/assets/server/schema.ts";
import { VideoTaskStore, VideoTaskError } from "../../src/features/video-downloads/server/task-store.ts";
import { readVideoJson } from "../../src/features/video-downloads/server/http.ts";
import { resolvedVideo } from "../../src/features/video-downloads/server/resolve-video.ts";
import { idSchema, type ResolvedVideo } from "../../src/features/video-downloads/types.ts";
import { invokeEngine } from "./engine-client.mjs";
import { importVideoTask, insideVideoRoot, syncVideoCache, taskCache } from "../../src/features/video-downloads/server/import-video.ts";
import { videoMediaSchema } from "../../src/features/video-downloads/types.ts";
import { cleanupVideoTask, reconcileVideoFiles } from "../../src/features/video-downloads/server/maintenance.ts";
import { requireVideoSpace, videoReserveBytes } from "../../src/features/video-downloads/server/space-policy.ts";
import { readFile } from "node:fs/promises";
import { VideoFrameJobStore } from "../../src/features/frame-extraction/server/video-frame-job-store.ts";
import { VideoFrameExecutor } from "../../src/features/frame-extraction/server/video-frame-executor.ts";

// One coordinator, owned by run-app's existing OS lock and Job Object.
const root = process.env.MOWO_DATA_ROOT?.trim() ? resolve(process.env.MOWO_DATA_ROOT) : join(homedir(), "Documents", "MOWO Canvas Data");
const runtime = resolve("data/video-runtime");
const credentialFile = join(root, "credentials/bilibili.dpapi");
await mkdir(join(root, "database"), { recursive: true });
await mkdir(join(root, "runtime"), { recursive: true });
// Preserve the user's previously verified encrypted session on the default data root.
// Isolated verification roots never receive production credentials.
if (root === join(homedir(), "Documents", "MOWO Canvas Data")) {
  await mkdir(join(root, "credentials"), { recursive: true });
  const marker = join(root, "credentials/legacy-bilibili-imported");
  const migrated = await access(marker).then(() => true, () => false);
  if (!migrated) {
    await copyFile(join(runtime, "bilibili.credentials"), credentialFile, constants.COPYFILE_EXCL).catch(error => {
      if (!["ENOENT", "EEXIST"].includes(error.code)) throw new Error("credential_migration_failed");
    });
    await writeFile(marker, "1"); // Logging out must never resurrect the old prototype session.
  }
}
const sqlite = new Database(join(root, "database/mowo.db"));
sqlite.pragma("journal_mode = WAL"); sqlite.pragma("foreign_keys = ON"); sqlite.pragma("busy_timeout = 5000");
const db = drizzle(sqlite, { schema }); migrate(db, { migrationsFolder: "drizzle" });
const [pythonManifest, mediaManifest, packageInfo, migrationJournal] = await Promise.all([
  "scripts/video/python-runtime.json", "scripts/video/media-runtime.json", "package.json", "drizzle/meta/_journal.json",
].map(async file => JSON.parse(await readFile(resolve(file), "utf8"))));
const versions = { python: pythonManifest.version, ytDlp: "2026.10.21", ffmpeg: mediaManifest.version };
await writeFile(join(root, "data-version.json"), JSON.stringify({ app: packageInfo.version, schema: migrationJournal.entries.at(-1)?.tag, engines: versions }, null, 2));
const store = new VideoTaskStore(db);
const frameExecutor = new VideoFrameExecutor(new VideoFrameJobStore(db), root);
await frameExecutor.initialize();
store.interruptPending(); // Guardian has already reaped the previous coordinator and its descendants.
await reconcileVideoFiles(db, root);
const sessions = new Map<string, { projectId: string; expires: number; video: ResolvedVideo }>();
const identity = z.object({ projectId: idSchema, taskId: idSchema });
let active: { projectId: string; taskId: string; abort: AbortController; done: Promise<void> } | undefined;
let qr: { key: string; expires: number } | undefined;
let authBusy = false, resolving = false;
const imports = new Map<string, ReturnType<typeof importVideoTask>>();
const maintenance = new Set<string>();
const authScript = resolve("scripts/video/auth.py");
const ffmpeg = join(runtime, "tools/ffmpeg.exe"), ffprobe = join(runtime, "tools/ffprobe.exe");
const common = { credentialFile, ffmpeg };

async function space(additional = 0) {
  const disk = await statfs(root);
  requireVideoSpace(disk.bavail * disk.bsize, additional);
}
function failureCode(error: unknown) {
  if (error instanceof VideoTaskError && error.code === "DISK_FULL") return "disk_full";
  return error instanceof Error && /^video_[a-z_]+$/.test(error.message) ? error.message.slice(6) : "engine_failed";
}
async function runTask(projectId: string, taskId: string, executionId: string, abort: AbortController) {
  let lowSpace = false;
  const monitor = setInterval(() => { void space().catch(() => { lowSpace = true; abort.abort(); }); }, 3000);
  try {
    await space();
    const task = store.get(projectId, taskId);
    const directory = join(root, "temp/video-downloads", taskId);
    await mkdir(directory, { recursive: true });
    let lastProgress = 0;
    const events = await invokeEngine({ ...common, action: "download", url: task.sourceUrl, formatIds: task.formatIds, directory }, {
      timeoutMs: 0, signal: abort.signal, managed: { root: join(root, "runtime/video-media"), directory },
      onEvent: (event: { event: string }) => {
        if (abort.signal.aborted) return;
        if (event.event === "progress") { if (Date.now() - lastProgress < 250) return; lastProgress = Date.now(); }
        if (["stage", "progress", "recovery"].includes(event.event)) store.applyEvent(projectId, taskId, executionId, event);
      },
    });
    const downloaded = events.find((event: { event: string }) => event.event === "downloaded");
    if (!downloaded || typeof downloaded.file !== "string" || !/^source\.(mp4|mkv|webm)$/.test(downloaded.file)) throw new Error("video_output_not_unique");
    if (abort.signal.aborted) throw new Error("video_cancelled");
    await space();
    store.applyEvent(projectId, taskId, executionId, downloaded);
    const media = await invokeEngine({ action: "probe", file: join(directory, downloaded.file), ffprobe, requireAudio: downloaded.requireAudio === true }, { signal: abort.signal });
    if (abort.signal.aborted) throw new Error("video_cancelled");
    const probed = media.find((event: { event: string }) => event.event === "probed");
    const cache = taskCache(root, taskId); await mkdir(cache, { recursive: true });
    try {
      await invokeEngine({ action: "cover", file: join(directory, downloaded.file), target: join(cache, "cover.jpg"), ffmpeg },
        { signal: abort.signal, managed: { root: join(root, "runtime/video-media"), directory: cache } });
    } catch { /* A missing cover does not invalidate a verified original. */ }
    if (abort.signal.aborted) throw new Error("video_cancelled");
    store.applyEvent(projectId, taskId, executionId, probed);
  } catch (error) {
    if (abort.signal.aborted && !lowSpace) store.cancelExecution(projectId, taskId, executionId);
    else store.applyEvent(projectId, taskId, executionId, { v: 1, event: "failed", code: lowSpace ? "disk_full" : failureCode(error) });
  } finally { clearInterval(monitor); }
}
async function runPreview(projectId: string, taskId: string, executionId: string, abort: AbortController) {
  let lowSpace = false;
  const monitor = setInterval(() => { void space().catch(() => { lowSpace = true; abort.abort(); }); }, 3000);
  try {
    const row = store.executionSource(projectId, taskId);
    if (!row.relativePath) throw new VideoTaskError("FILE_MISSING");
    const source = insideVideoRoot(root, row.relativePath);
    const information = await stat(source).catch(() => { throw new VideoTaskError("FILE_MISSING"); });
    await space(information.size);
    const directory = taskCache(root, taskId); await mkdir(directory, { recursive: true });
    const events = await invokeEngine({ action: "preview", file: source,
      target: join(directory, "preview.mp4"), ffmpeg, ffprobe }, { timeoutMs: 0, signal: abort.signal,
      managed: { root: join(root, "runtime/video-media"), directory } });
    if (abort.signal.aborted) throw new Error("video_cancelled");
    await syncVideoCache(db, root, projectId, taskId);
    store.applyEvent(projectId, taskId, executionId, events.find((event: { event: string }) => event.event === "previewed"));
  } catch (error) {
    store.applyEvent(projectId, taskId, executionId, { v: 1, event: "failed", code: lowSpace ? "disk_full" : failureCode(error) });
  } finally { clearInterval(monitor); }
}
function pump() {
  if (active || frameExecutor.busy || maintenance.size) return;
  const queued = store.nextQueued();
  const next = queued ?? store.nextPreview(); if (!next) { frameExecutor.pump(); return; }
  const executionId = queued ? store.claim(next.projectId, next.id).executionId : store.beginPreview(next.projectId, next.id);
  const abort = new AbortController();
  const done = (queued ? runTask(next.projectId, next.id, executionId, abort) : runPreview(next.projectId, next.id, executionId, abort))
    .catch(() => { /* Errors are persisted by runTask; never print engine exceptions. */ })
    .finally(() => { active = undefined; });
  active = { projectId: next.projectId, taskId: next.id, abort, done };
}
const scheduler = setInterval(() => { try { pump(); } catch { /* Retry DB contention next tick. */ } }, 350);

async function auth(action: string) {
  if (!["generate", "poll", "status", "logout"].includes(action)) throw new VideoTaskError("INVALID_INPUT");
  if (authBusy) throw new VideoTaskError("TASK_BUSY");
  authBusy = true;
  try {
    if (action === "poll" && (!qr || Date.now() >= qr.expires)) { qr = undefined; return { status: "expired" }; }
    if (action === "generate" || action === "logout") qr = undefined;
    const events = await invokeEngine({ action, credentialFile, ...(action === "poll" ? { key: qr?.key } : {}) }, { script: authScript, timeoutMs: 30000 });
    const event = events[0];
    if (action === "generate") {
      if (typeof event.key !== "string" || typeof event.image !== "string" || event.image.length > 200000) throw new Error();
      qr = { key: event.key, expires: Date.now() + 180000 };
      return { status: "waiting", image: event.image };
    }
    if (action === "poll") {
      if (!event.status || !["waiting", "scanned", "expired", "success"].includes(event.status)) throw new Error();
      if (["expired", "success"].includes(event.status)) { qr = undefined; sessions.clear(); }
      return { status: event.status };
    }
    if (action === "logout") sessions.clear();
    return { status: event.loggedIn ? "loggedIn" : "anonymous" };
  } catch (error) { if (error instanceof VideoTaskError) throw error; throw new VideoTaskError("AUTH_FAILED"); }
  finally { authBusy = false; }
}
async function dispatch(action: string, body: unknown) {
  const data = z.record(z.string(), z.unknown()).parse(body);
  if (action === "storage") {
    const disk = await statfs(root);
    return { availableBytes: disk.bavail * disk.bsize, reserveBytes: videoReserveBytes, processing: !!active || imports.size > 0,
      versions };
  }
  if (action === "auth") return auth(z.string().parse(data.action));
  if (action === "resolve") {
    const input = z.object({ projectId: idSchema, url: z.string().trim().min(1).max(2000) }).strict().parse(data);
    store.list(input.projectId);
    if (resolving) throw new VideoTaskError("TASK_BUSY");
    resolving = true;
    try {
      const events = await invokeEngine({ ...common, action: "resolve", url: input.url }, { timeoutMs: 120000 });
      const { video } = resolvedVideo(events.find((event: { event: string }) => event.event === "resolved")?.video);
      for (const [key, value] of sessions) if (value.expires < Date.now()) sessions.delete(key);
      if (sessions.size >= 20) sessions.delete(sessions.keys().next().value!);
      sessions.set(video.resolveId, { projectId: input.projectId, expires: Date.now() + 600000, video });
      return { video };
    } catch (error) { if (error instanceof VideoTaskError) throw error; throw new VideoTaskError("RESOLVE_FAILED"); }
    finally { resolving = false; }
  }
  if (action === "create") {
    const input = z.object({ projectId: idSchema, resolveId: z.string().uuid(), choiceId: z.string().max(80) }).strict().parse(data);
    const session = sessions.get(input.resolveId);
    if (!session || session.projectId !== input.projectId || session.expires < Date.now()) throw new VideoTaskError("RESOLVE_EXPIRED");
    const choice = session.video.choices.find(c => c.id === input.choiceId); if (!choice) throw new VideoTaskError("INVALID_INPUT");
    await space(choice.size ? choice.size * 2 : 0);
    const task = store.create(input.projectId, { url: session.video.sourceUrl, formatIds: choice.formatIds, title: session.video.title });
    store.setCid(input.projectId, task.id, session.video.cid);
    return { task };
  }
  const { projectId, taskId } = identity.strict().parse(data);
  const operationKey = `${projectId}/${taskId}`;
  if (maintenance.has(operationKey)) throw new VideoTaskError("TASK_BUSY");
  if (action === "cleanup") {
    if (imports.has(operationKey) || (active?.projectId === projectId && active.taskId === taskId)) throw new VideoTaskError("TASK_BUSY");
    maintenance.add(operationKey);
    try { return await cleanupVideoTask(db, root, projectId, taskId); }
    catch (error) { if (error instanceof VideoTaskError) throw error; throw new VideoTaskError("CLEANUP_FAILED"); }
    finally { maintenance.delete(operationKey); }
  }
  if (action === "import") {
    // Same-process duplicate clicks share the operation; the final database transaction is idempotent too.
    store.get(projectId, taskId);
    const key = `${projectId}/${taskId}`;
    let pending = imports.get(key);
    if (!pending) {
      pending = (async () => {
        const row = store.executionSource(projectId, taskId);
        if (row.status !== "completed" && row.relativePath) {
          const file = await stat(insideVideoRoot(root, row.relativePath)).catch(() => { throw new VideoTaskError("FILE_MISSING"); });
          await space(file.size);
        }
        return importVideoTask(db, root, projectId, taskId, async (file, requireAudio) => {
          const events = await invokeEngine({ action: "probe", ffprobe, file, requireAudio });
          return videoMediaSchema.parse(events.find(event => event.event === "probed"));
        });
      })().finally(() => { imports.delete(key); });
      imports.set(key, pending);
    }
    return pending;
  }
  if (action === "preview") return { task: store.requestPreview(projectId, taskId) };
  if (action === "cancel") {
    store.get(projectId, taskId);
    if (active?.projectId === projectId && active.taskId === taskId) { active.abort.abort(); await active.done; return { task: store.get(projectId, taskId) }; }
    return { task: store.cancelIdle(projectId, taskId) };
  }
  if (action === "retry") return { task: store.retry(projectId, taskId) };
  if (action === "discard") {
    if (imports.has(`${projectId}/${taskId}`)) throw new VideoTaskError("TASK_BUSY");
    return { task: store.discard(projectId, taskId) };
  }
  throw new VideoTaskError("INVALID_INPUT");
}
const token = randomBytes(32).toString("hex");
const server = createServer(async (request, response) => {
  response.setHeader("Cache-Control", "no-store"); response.setHeader("Content-Type", "application/json");
  if (request.method !== "POST" || request.headers.authorization !== `Bearer ${token}`) { response.writeHead(403).end('{"code":"LOCAL_ONLY"}'); return; }
  try {
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of request) { size += chunk.length; if (size > 16384) throw new VideoTaskError("BODY_TOO_LARGE"); chunks.push(chunk); }
    // Reuse the public bounded JSON parser rather than accepting different input rules internally.
    const body = await readVideoJson(new Request("http://localhost/internal", { method: "POST", body: Buffer.concat(chunks) }));
    response.end(JSON.stringify(await dispatch(request.url?.slice(1) ?? "", body)));
  } catch (error) {
    const safe = error instanceof VideoTaskError ? error : new VideoTaskError(error instanceof z.ZodError ? "INVALID_INPUT" : "INTERNAL_ERROR");
    response.writeHead(safe.status).end(JSON.stringify({ code: safe.code, error: safe.message }));
  }
});
server.listen(0, "127.0.0.1", async () => {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("service_address");
  await writeFile(join(root, "runtime/video-service.json"), JSON.stringify({ port: address.port, token }), { mode: 0o600 });
  console.log("Video download service ready");
});
process.once("SIGTERM", () => { clearInterval(scheduler); active?.abort.abort(); void frameExecutor.stop(); server.close(); });
