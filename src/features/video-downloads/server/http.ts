import { VideoTaskError } from "./task-store.ts";

export function checkVideoLocalRequest(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get("host") ?? url.host;
  let destination: URL;
  try { destination = new URL(`${url.protocol}//${host}`); } catch { throw new VideoTaskError("LOCAL_ONLY"); }
  if (host.toLowerCase() !== destination.host || destination.username || destination.password
    || !["localhost", "127.0.0.1", "[::1]"].includes(destination.hostname)) throw new VideoTaskError("LOCAL_ONLY");
  const origin = request.headers.get("origin");
  if ((origin && origin !== destination.origin) || request.headers.get("sec-fetch-site") === "cross-site") throw new VideoTaskError("LOCAL_ONLY");
}

export async function readVideoJson(request: Request) {
  const maximum = 16 * 1024;
  if (Number(request.headers.get("content-length")) > maximum) throw new VideoTaskError("BODY_TOO_LARGE");
  if (!request.body) throw new VideoTaskError("INVALID_JSON");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "", bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maximum) { await reader.cancel().catch(() => {}); throw new VideoTaskError("BODY_TOO_LARGE"); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } catch (error) {
    if (error instanceof VideoTaskError) throw error;
    throw new VideoTaskError("INVALID_JSON");
  } finally { reader.releaseLock(); }
}

export async function videoTaskResponse(request: Request, action: () => Promise<unknown>, status = 200) {
  try {
    checkVideoLocalRequest(request);
    return Response.json(await action(), { status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const safe = error instanceof VideoTaskError ? error : new VideoTaskError("INTERNAL_ERROR");
    return Response.json({ code: safe.code, error: safe.message }, { status: safe.status, headers: { "Cache-Control": "no-store" } });
  }
}
