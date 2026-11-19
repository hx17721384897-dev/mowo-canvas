import "server-only";

import { and, eq, inArray, or } from "drizzle-orm";
import { getAssetDatabase } from "@/features/assets/server/database";
import { assetCollections, projects, videoDownloadTasks, downloadTasks, videoShotAnalyses, videoFrameJobs } from "@/features/assets/server/schema";

export class ProjectTasksPendingError extends Error {
  constructor() { super("项目还有运行中的任务，请先取消并等待任务结束后再删除"); }
}

export async function deleteProjects(ids: string[]) {
  const database = await getAssetDatabase();
  return database.transaction((transaction) => {
    const video = transaction.select({ id: videoDownloadTasks.id }).from(videoDownloadTasks).where(and(inArray(videoDownloadTasks.projectId, ids),
      or(inArray(videoDownloadTasks.status, ["queued", "downloading", "merging", "verifying", "ready", "importing", "interrupted"]), eq(videoDownloadTasks.previewStatus, "generating")))).limit(1).get();
    const line = transaction.select({ id: downloadTasks.id }).from(downloadTasks).where(and(inArray(downloadTasks.projectId, ids),
      inArray(downloadTasks.status, ["queued", "resolving", "downloading", "ready", "importing"]))).limit(1).get();
    const shots = transaction.select({ projectId: videoShotAnalyses.projectId }).from(videoShotAnalyses).where(and(
      inArray(videoShotAnalyses.projectId, ids), inArray(videoShotAnalyses.status, ["waiting", "running"]))).limit(1).get();
    const frames = transaction.select({ id: videoFrameJobs.id }).from(videoFrameJobs).where(and(
      inArray(videoFrameJobs.projectId, ids), inArray(videoFrameJobs.status, ["queued", "running", "cancelling"]))).limit(1).get();
    if (video || line || shots || frames) throw new ProjectTasksPendingError();
    let deleted = 0;
    for (const id of ids) {
      transaction.update(assetCollections).set({ projectId: null }).where(eq(assetCollections.projectId, id)).run();
      deleted += transaction.delete(projects).where(eq(projects.id, id)).run().changes;
    }
    return deleted;
  }, { behavior: "immediate" });
}
