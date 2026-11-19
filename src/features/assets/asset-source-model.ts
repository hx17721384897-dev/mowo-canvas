import type { AssetSourceView } from "./asset-source-types";

export function sourceCategory(sourceType: string): "download" | "import" {
  return sourceType === "line" || sourceType === "bilibili" ? "download" : "import";
}

export function sourceRelations(data: AssetSourceView) {
  const outputIds = new Set(data.links.flatMap((link) => link.outputAssetIds));
  const outputCollections = new Set(data.links.flatMap((link) => link.outputCollectionIds));
  const sequenceById = new Map(data.sequences.map((sequence) => [sequence.id, sequence]));
  const sequenceFrameIds = new Set(data.sequences.filter((sequence) => outputCollections.has(sequence.id))
    .flatMap((sequence) => sequence.assetIds));
  for (const clip of data.clips) outputIds.add(clip.id);
  // Old assets can predate derivation records. Keep them visible until their source is known.
  const roots = data.origins.filter((asset) => !outputIds.has(asset.id)
    && !sequenceFrameIds.has(asset.id));
  const related = new Map<string, { assetIds: string[]; sequenceIds: string[] }>();
  for (const root of roots) {
    const seenAssets = new Set([root.id]);
    const seenCollections = new Set<string>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const link of data.links) {
        if (!link.inputAssetIds.some((id) => seenAssets.has(id))
          && !link.inputCollectionIds.some((id) => seenCollections.has(id))) continue;
        for (const id of link.outputAssetIds) if (!seenAssets.has(id)) { seenAssets.add(id); changed = true; }
        for (const id of link.outputCollectionIds) if (!seenCollections.has(id)) {
          seenCollections.add(id); changed = true;
          for (const member of sequenceById.get(id)?.assetIds ?? []) seenAssets.add(member);
        }
      }
      for (const clip of data.clips) if (seenAssets.has(clip.sourceAssetId) && !seenAssets.has(clip.id)) {
        seenAssets.add(clip.id); changed = true;
      }
    }
    related.set(root.id, { assetIds: [...seenAssets].filter((id) => id !== root.id && !sequenceFrameIds.has(id)),
      sequenceIds: [...seenCollections].filter((id) => sequenceById.has(id)) });
  }
  return { roots, related };
}
