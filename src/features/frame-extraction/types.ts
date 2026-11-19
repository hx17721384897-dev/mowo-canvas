export type FrameDraft = {
  id: string;
  assetId?: string;
  sourcePosition: number;
  position: number;
  timelineStartMs: number;
  durationMs: number;
  previewUrl: string;
  retained: boolean;
  sourceMapping?: { sourceStartFrame: number; sourceEndFrame: number; sourcePts: number };
};

export type FrameSequenceDraft = {
  id: string;
  manualGroupId?: string;
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
  sourceKind?: "animated" | "video";
  parameters?: Record<string, unknown>;
};

export type FrameExtractionTask = {
  id: string;
  projectId: string;
  status: "processing" | "ready" | "partial" | "failed" | "saved";
  /** Legacy canvas snapshot field. Project drafts no longer expire by this timestamp. */
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
export type FrameInputReview = {
  assetId: string;
  name: string;
  format: string;
  status: "ready" | "static" | "unsupported" | "unavailable" | "existing";
  reason?: string;
};
