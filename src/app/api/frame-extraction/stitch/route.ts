import { stitchFrameSequences, toFrameExtractionError } from "@/features/frame-extraction/server/frame-extraction-service";
import type { StitchSettings } from "@/features/frame-extraction/stitch-layout";

type Input = { sourceId: string; frameIds: string[]; settings: StitchSettings };
const integer = (value: unknown, min: number, max: number) => typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

function validInput(value: unknown): value is Input {
  if (!value || typeof value !== "object") return false;
  const { sourceId, frameIds, settings } = value as Partial<Input>;
  return typeof sourceId === "string" && Array.isArray(frameIds) && frameIds.length > 0 && frameIds.length <= 1000
    && frameIds.every((id) => typeof id === "string") && Boolean(settings
      && (settings.columns === undefined || integer(settings.columns, 1, frameIds.length))
      && integer(settings.gap, 0, 128) && integer(settings.margin, 0, 128)
      && ["transparent", "white"].includes(settings.background));
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { projectId?: unknown; taskId?: unknown; sequences?: unknown } | null;
  if (!body || typeof body.projectId !== "string" || typeof body.taskId !== "string" || !Array.isArray(body.sequences)
    || !body.sequences.length || body.sequences.length > 50 || !body.sequences.every(validInput)
    || new Set(body.sequences.map((item) => item.sourceId)).size !== body.sequences.length) {
    return Response.json({ error: "拼接参数无效" }, { status: 400 });
  }
  try {
    return Response.json(await stitchFrameSequences(body.projectId, body.taskId, body.sequences));
  } catch (error) {
    const failure = toFrameExtractionError(error);
    return Response.json({ error: failure.status === 500 ? "无法完成拼接" : failure.message }, { status: failure.status });
  }
}
