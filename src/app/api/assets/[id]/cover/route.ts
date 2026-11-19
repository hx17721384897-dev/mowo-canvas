import { videoAssetContent } from "@/features/assets/server/video-content";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) { return videoAssetContent(request, (await context.params).id, "cover"); }
export async function HEAD(request: Request, context: Context) { return videoAssetContent(request, (await context.params).id, "cover", true); }
