import { aiError, checkLocalRequest, withRuns } from "@/features/ai/server/run-service";
export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    checkLocalRequest(request);
    const { runId } = await context.params;
    return Response.json(await withRuns((store) => {
      store.get(runId);
      store.finish(runId, "stopped");
      return { run: store.get(runId) };
    }));
  } catch (error) { return aiError(error); }
}
