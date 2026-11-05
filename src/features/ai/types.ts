export type RunStatus = "queued" | "running" | "completed" | "stopped" | "failed" | "interrupted";
export type ChatMessage = { role: "user" | "assistant"; content: string };
export type AiRun = {
  id: string;
  projectId: string;
  clientRequestId: string;
  model: string;
  status: RunStatus;
  output: string;
  sequence: number;
  errorCode: string | null;
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | null;
  createdAt: number;
  updatedAt: number;
};
export const isTerminal = (status: RunStatus) => status !== "queued" && status !== "running";
