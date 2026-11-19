export type AssetType = "image" | "video" | "text";

export type AssetSummary = {
  id: string;
  type: AssetType;
  name: string;
  mimeType: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  sourceType: string;
  previewUrl: string | null;
  addedAt: string;
  animated?: boolean;
  coverUrl?: string | null;
  originalUrl?: string | null;
  clip?: { sourceAssetId: string; startFrame: number; endFrame: number;
    startSeconds: number; endSeconds: number; sequence: number };
};

export type AssetProjectSummary = {
  id: string;
  name: string;
  assetCount: number;
};

export const ASSET_DRAG_TYPE = "application/x-mowo-asset";
export const SEQUENCE_DRAG_TYPE = "application/x-mowo-sequence";
export type AssetSequence = { id: string; name: string; frames: Array<AssetSummary & { durationMs?: number }> };
