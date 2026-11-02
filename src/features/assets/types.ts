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
};

export type AssetProjectSummary = {
  id: string;
  name: string;
  assetCount: number;
};

export const ASSET_DRAG_TYPE = "application/x-mowo-asset";
