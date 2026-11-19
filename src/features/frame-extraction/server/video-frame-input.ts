import "server-only";

import { getAssetDatabase } from "@/features/assets/server/database";
import { getAssetDataPaths } from "@/features/assets/server/data-paths";
import { resolveVideoFrameSource, readyVideoFrameIndex } from "./video-frame-source";
import { VideoFrameRuntimeError } from "./video-frame-runtime";

/** Resolve only project-owned input IDs. Worker paths are never supplied by the browser. */
export async function resolveVideoFrameInput(projectId: string, assetId: string) {
  const source = resolveVideoFrameSource(await getAssetDatabase(), getAssetDataPaths().root, projectId, assetId);
  const index = await readyVideoFrameIndex(source);
  if (!index) throw new VideoFrameRuntimeError("SOURCE_INDEX_REQUIRED");
  return { ...source, endFrame: source.endFrame ?? index.frameCount };
}
