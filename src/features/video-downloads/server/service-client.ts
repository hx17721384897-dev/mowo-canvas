import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getAssetDataPaths } from "@/features/assets/server/data-paths";
import { VideoTaskError } from "./task-store";

export async function callVideoService(action: string, input: Record<string, unknown> = {}) {
  try {
    const descriptor = JSON.parse(await readFile(join(getAssetDataPaths().root, "runtime/video-service.json"), "utf8"));
    if (!Number.isInteger(descriptor.port) || descriptor.port < 1 || descriptor.port > 65535 || !/^[a-f0-9]{64}$/.test(descriptor.token)) throw new Error();
    const response = await fetch(`http://127.0.0.1:${descriptor.port}/${action}`, { method: "POST", cache: "no-store",
      headers: { "authorization": `Bearer ${descriptor.token}`, "content-type": "application/json" }, body: JSON.stringify(input), signal: AbortSignal.timeout(180000) });
    const data = await response.json();
    if (!response.ok) {
      if (["INVALID_INPUT", "TASK_BUSY", "INVALID_STATE", "TASK_NOT_FOUND", "PROJECT_NOT_FOUND", "RESOLVE_EXPIRED", "AUTH_FAILED", "RESOLVE_FAILED", "DISK_FULL", "IMPORT_FAILED", "MEDIA_CHANGED", "FILE_MISSING", "ASSET_UNAVAILABLE", "CLEANUP_FAILED"].includes(data.code)) throw new VideoTaskError(data.code);
      throw new VideoTaskError("SERVICE_UNAVAILABLE");
    }
    return data;
  } catch (error) { if (error instanceof VideoTaskError) throw error; throw new VideoTaskError("SERVICE_UNAVAILABLE"); }
}
