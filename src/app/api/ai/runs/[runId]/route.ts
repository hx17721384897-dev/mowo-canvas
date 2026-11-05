import { aiError, checkLocalRequest, dispatchPending, withRuns } from "@/features/ai/server/run-service";
export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    checkLocalRequest(request);
    const { runId } = await context.params;
    const run = await withRuns((store) => store.get(runId));
    await dispatchPending();
    return Response.json({ run }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return aiError(error); }
}
