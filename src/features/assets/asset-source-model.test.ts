import assert from "node:assert/strict";
import { sourceRelations } from "./asset-source-model.ts";
import type { AssetSourceView } from "./asset-source-types.ts";

const view: AssetSourceView = {
  folders: [], placements: [], batches: [], clips: [], intakes: [],
  origins: [{ id: "a", sourceType: "local", sourceUrl: null }, { id: "b", sourceType: "local", sourceUrl: null },
    { id: "frame", sourceType: "frame-extraction", sourceUrl: null }, { id: "joined", sourceType: "frame-stitch", sourceUrl: null },
    { id: "legacy", sourceType: "image-crop", sourceUrl: null }],
  sequences: [{ id: "sequence", name: "序列", assetIds: ["frame"] }],
  links: [
    { id: "extract", operation: "frame-extraction", inputAssetIds: ["a"], inputCollectionIds: [], outputAssetIds: ["frame"], outputCollectionIds: ["sequence"] },
    { id: "stitch", operation: "frame-stitch", inputAssetIds: ["b"], inputCollectionIds: ["sequence"], outputAssetIds: ["joined"], outputCollectionIds: [] },
  ],
};
const result = sourceRelations(view);
assert.deepEqual(result.roots.map((item) => item.id), ["a", "b", "legacy"]);
assert.deepEqual(result.related.get("a")?.sequenceIds, ["sequence"]);
assert.deepEqual(result.related.get("a")?.assetIds, ["joined"]);
assert.deepEqual(result.related.get("b")?.assetIds, ["joined"]);
