import type { InferSelectModel } from "drizzle-orm";
import { assetCollections, downloadTasks } from "./schema";

type Collection = InferSelectModel<typeof assetCollections>;
type DownloadTask = InferSelectModel<typeof downloadTasks>;

// Collections created before project ownership was recorded are matched to the
// download task that most recently started for the same source URL.
export function belongsToLegacyDownloadBatch(collection: Collection, projectId: string, tasks: DownloadTask[]) {
  if (collection.projectId !== null || collection.kind !== "download-batch" || !collection.sourceUrl) return false;
  const candidates = tasks.filter((task) => task.sourceUrl === collection.sourceUrl
    && task.createdAt.getTime() <= collection.createdAt.getTime())
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return candidates[0]?.projectId === projectId;
}
