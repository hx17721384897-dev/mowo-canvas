export type EngineEvent = { event: string; v: number; file?: string; requireAudio?: boolean; key?: string; image?: string; status?: string; loggedIn?: boolean; video?: unknown; message?: string };
export function invokeEngine(request: Record<string, unknown>, options?: {
  python?: string; signal?: AbortSignal; timeoutMs?: number; script?: string;
  onEvent?: (event: EngineEvent) => void;
  managed?: false | { root?: string; directory?: string; heartbeatMs?: number; command?: string[] };
}): Promise<EngineEvent[]>;
