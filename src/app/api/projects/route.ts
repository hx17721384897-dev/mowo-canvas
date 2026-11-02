import { listAssetProjects } from "@/features/assets/server/asset-catalog";

export async function GET(request: Request) {
  const exclude = new URL(request.url).searchParams.get("exclude") ?? undefined;
  return Response.json({ projects: await listAssetProjects(exclude) });
}
