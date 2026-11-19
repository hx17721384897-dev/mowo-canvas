export type AssetSourceView = {
  folders: Array<{ id: string; name: string; category: "download" | "import" }>;
  placements: Array<{ assetId: string; folderId: string }>;
  batches: Array<{ id: string; name: string; category: "download"; createdAt: string; assetIds: string[] }>;
  sequences: Array<{ id: string; name: string; assetIds: string[] }>;
  links: Array<{ id: string; operation: string; inputAssetIds: string[]; inputCollectionIds: string[];
    outputAssetIds: string[]; outputCollectionIds: string[] }>;
  clips: Array<{ id: string; sourceAssetId: string }>;
  origins: Array<{ id: string; sourceType: string; sourceUrl: string | null }>;
  intakes: Array<{ id: string; assetId: string; sourceType: string; sourceName: string; sourceUrl: string | null;
    batchId: string | null; createdAt: string }>;
};
