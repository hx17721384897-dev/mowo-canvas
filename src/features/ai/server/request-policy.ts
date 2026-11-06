import { RunError } from "./run-store.ts";

export function checkLocalRequest(request: Request) {
  const url = new URL(request.url);
  // Next's internal request URL may use localhost even when the browser connects
  // to 127.0.0.1. Host identifies the actual destination; forwarded headers do not.
  const host = request.headers.get("host") ?? url.host;
  let destination: URL;
  try { destination = new URL(`${url.protocol}//${host}`); }
  catch { throw new RunError("LOCAL_ONLY", 403); }
  if (host.toLowerCase() !== destination.host || destination.username || destination.password
    || !["localhost", "127.0.0.1", "[::1]"].includes(destination.hostname)) throw new RunError("LOCAL_ONLY", 403);
  const origin = request.headers.get("origin");
  if ((origin && origin !== destination.origin) || request.headers.get("sec-fetch-site") === "cross-site") throw new RunError("LOCAL_ONLY", 403);
}
