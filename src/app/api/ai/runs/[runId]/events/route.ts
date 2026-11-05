import { aiError, checkLocalRequest, dispatchPending, withRuns } from "@/features/ai/server/run-service";
import { RunError } from "@/features/ai/server/run-store";
import { isTerminal } from "@/features/ai/types";

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    checkLocalRequest(request);
    const { runId } = await context.params;
    const initial = await withRuns((store) => store.get(runId));
    const after = new URL(request.url).searchParams.get("after") ?? request.headers.get("last-event-id");
    let cursor = after === null ? initial.sequence : Number(after);
    if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > initial.sequence) throw new RunError("INVALID_CURSOR", 409);
    await dispatchPending();
    const encoder = new TextEncoder();
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let detach = () => {};
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const close = () => {
          if (closed) return;
          closed = true; clearTimeout(timer); detach(); controller.close();
        };
        const abort = () => close();
        request.signal.addEventListener("abort", abort, { once: true });
        detach = () => request.signal.removeEventListener("abort", abort);
        const send = (seq: number, data: string) => controller.enqueue(encoder.encode(`id: ${seq}\ndata: ${data}\n\n`));
        if (after === null) send(initial.sequence, JSON.stringify({ type: "snapshot", run: initial }));
        async function poll() {
          if (closed) return;
          try {
            const batch = await withRuns((store) => ({ events: store.events(runId, cursor), run: store.get(runId) }));
            if (closed) return;
            for (const event of batch.events) { send(event.sequence, event.payload); cursor = event.sequence; }
            if (isTerminal(batch.run.status) && cursor >= batch.run.sequence) { close(); return; }
            controller.enqueue(encoder.encode(": keep-alive\n\n"));
            timer = setTimeout(poll, 250);
          } catch { close(); }
        }
        if (request.signal.aborted) close(); else void poll();
      },
      cancel() { closed = true; clearTimeout(timer); detach(); },
    });
    return new Response(body, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
  } catch (error) { return aiError(error); }
}
