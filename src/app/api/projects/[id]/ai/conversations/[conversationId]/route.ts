import { aiError, checkLocalRequest, withRuns } from "@/features/ai/server/run-service";
import { RunError } from "@/features/ai/server/run-store";
export async function PATCH(request: Request, context: { params: Promise<{ id: string; conversationId: string }> }) {
  try {
    checkLocalRequest(request);
    // Names are small; reject bodies exceeding the bounded reader before parsing.
    const reader = request.body?.getReader();
    if (!reader) throw new RunError("INVALID_TITLE");
    let raw = "", bytes = 0;
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        bytes += value.byteLength;
        if (bytes > 1024) { await reader.cancel(); throw new RunError("INVALID_TITLE", 413); }
        raw += decoder.decode(value, { stream: true });
      }
      raw += decoder.decode();
    } finally { reader.releaseLock(); }
    let input: unknown;
    try { input = JSON.parse(raw); } catch { throw new RunError("INVALID_TITLE"); }
    if (!input || typeof input !== "object" || !("title" in input) || typeof input.title !== "string") throw new RunError("INVALID_TITLE");
    const title = input.title;
    const { id, conversationId } = await context.params;
    return Response.json({ conversation: await withRuns((store) => store.renameConversation(id, conversationId, title)) });
  } catch (error) { return aiError(error); }
}
