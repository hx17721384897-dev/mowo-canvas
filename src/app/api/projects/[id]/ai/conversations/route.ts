import { aiError, checkLocalRequest, withRuns } from "@/features/ai/server/run-service";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    checkLocalRequest(request);
    const { id } = await context.params;
    const search = new URL(request.url).searchParams.get("search") ?? "";
    return Response.json({ conversations: await withRuns((store) => store.conversations(id, search.slice(0, 100))) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return aiError(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    checkLocalRequest(request);
    const { id } = await context.params;
    return Response.json({ conversation: await withRuns((store) => store.createConversation(id)) }, { status: 201 });
  } catch (error) { return aiError(error); }
}
