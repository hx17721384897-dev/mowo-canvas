import "server-only";
import { getAssetDatabase } from "@/features/assets/server/database";
import { VideoTaskStore } from "./task-store";

export async function getVideoTaskStore() {
  return new VideoTaskStore(await getAssetDatabase());
}
