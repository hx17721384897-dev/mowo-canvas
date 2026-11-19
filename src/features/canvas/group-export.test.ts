import assert from "node:assert/strict";
import { groupExportManifest } from "./group-export.ts";
import type { CanvasNode } from "./types.ts";

const nodes = [
  { id: "root", type: "group", position: { x: 0, y: 0 }, data: { label: "普通组" } },
  { id: "child", type: "group", parentId: "root", position: { x: 0, y: 0 }, data: { label: "动作", orderedChildIds: ["b", "a"] } },
  { id: "a", type: "module", parentId: "child", position: { x: 0, y: 0 }, data: { moduleType: "image", assetId: "asset-a" } },
  { id: "b", type: "module", parentId: "child", position: { x: 0, y: 100 }, data: { moduleType: "image", assetId: "asset-b" } },
  { id: "video", type: "module", parentId: "root", position: { x: 100, y: 0 }, data: { moduleType: "video", assetId: "asset-video" } },
  { id: "tool", type: "module", parentId: "root", position: { x: 0, y: 100 }, data: { moduleType: "frame-stitch" } },
] as CanvasNode[];
assert.deepEqual(groupExportManifest(nodes, "root"), { entries: [
  { assetId: "asset-b", directories: ["01_动作"], order: 1 },
  { assetId: "asset-a", directories: ["01_动作"], order: 2 },
  { assetId: "asset-video", directories: [] },
], skipped: 1 });
console.log("Group export manifest tests passed");
