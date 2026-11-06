import { aiError, checkLocalRequest, dispatchPending, readRunInput, withRuns } from "@/features/ai/server/run-service";
import { RunError } from "@/features/ai/server/run-store";
import { isTerminal } from "@/features/ai/types";

type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  try {
    checkLocalRequest(request);
    const { id } = await context.params;
    const input = await readRunInput(request);
    const result = await withRuns((store) => {
      // Idempotent retries must still work if configuration was removed meanwhile.
      try {
        store.find(id, input.clientRequestId);
      } catch (error) {
        if (!(error instanceof RunError) || error.code !== "RUN_NOT_FOUND") throw error;
        if (!process.env.DEEPSEEK_API_KEY?.trim()) throw new RunError("CONFIG_MISSING", 503);
      }
      return store.create(id, input.clientRequestId, input.message);
    });
    await dispatchPending();
    return Response.json(result, { status: isTerminal(result.run.status) ? 200 : 202 });
  } catch (error) { return aiError(error); }
}
export async function GET(request: Request, context: Context) {
  try {
    checkLocalRequest(request);
    const { id } = await context.params;
    const requestId = new URL(request.url).searchParams.get("clientRequestId");
    const result = await withRuns((store) => requestId ? { run: store.find(id, requestId) } : store.conversation(id));
    await dispatchPending();
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return aiError(error); }
}
