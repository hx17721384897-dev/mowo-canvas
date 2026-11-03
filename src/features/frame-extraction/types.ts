export type FrameDraft = {
  id: string;
  sourcePosition: number;
  position: number;
  timelineStartMs: number;
  durationMs: number;
  previewUrl: string;
  retained: boolean;
};

export type FrameSequenceDraft = {
  id: string;
  sourceAssetId: string;
  name: string;
  position: number;
  status: "ready" | "failed" | "saved";
  width: number | null;
  height: number | null;
  totalDurationMs: number | null;
  collectionId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  frames: FrameDraft[];
};

export type FrameExtractionTask = {
  id: string;
  projectId: string;
  status: "processing" | "ready" | "partial" | "failed" | "saved";
  expiresAt: string;
  sources: FrameSequenceDraft[];
};

export type SavedFrameSequence = {
  sourceId: string;
  collectionId: string;
  name: string;
  assets: Array<{
    id: string;
    name: string;
    previewUrl: string;
    position: number;
    durationMs: number;
  }>;
};
