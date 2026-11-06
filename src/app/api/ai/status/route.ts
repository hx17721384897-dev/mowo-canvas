import { aiError, checkLocalRequest } from "@/features/ai/server/run-service";
import type { AiConfiguration } from "@/features/ai/types";

export async function GET(request: Request) {
  try {
    checkLocalRequest(request);
    return Response.json({ configured: Boolean(process.env.DEEPSEEK_API_KEY?.trim()), provider: "deepseek", model: "deepseek-flash" } satisfies AiConfiguration,
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return aiError(error); }
}
