import assert from "node:assert/strict";
import { initialFrameOrder, layoutOrderedGroup, orderedInsertion, orderedMembersError } from "./ordered-group.ts";
import { copyCanvasSelection, pasteCanvasSelection } from "./canvas-clipboard.ts";
import { applyGroupDrop, combineGroups, containGroupMembers, dissolveGroups, groupDropTarget, groupPresentation, setAllGroupResizeModes, setGroupResizeMode } from "./group-layout.ts";
import { frameBatchCompactSize, restoreFrameBatches, syncFrameBatch } from "./frame-batch-layout.ts";
import type { FrameExtractionTask } from "../frame-extraction/types.ts";
import type { CanvasGroupNode, CanvasNode } from "./types";

const a: CanvasGroupNode = { id: "a", type: "group", position: { x: 10, y: 20 }, data: { label: "A", collapsed: true } };
const b: CanvasGroupNode = { id: "b", type: "group", position: { x: 500, y: 20 }, data: { label: "B" } };
const image: CanvasNode = { id: "image", type: "module", parentId: "a", position: { x: 20, y: 30 }, data: { moduleType: "image", previewUrl: "/preview.png" } };
const nodes = [a, b, image];
const edges = [{ id: "internal-image-output", source: "image", target: "external", sourceHandle: "image" }];
const folded = groupPresentation(nodes, edges);
assert.equal(folded.hiddenBy.get("image"), "a");
assert.equal(folded.covers.get("a")?.preview, "/preview.png");
assert.equal(folded.visibleEdges[0].source, "a");
assert.equal(edges[0].source, "image");
const expanded = groupPresentation([{ ...a, data: { ...a.data, collapsed: false } }, b, image], edges);
assert.equal(expanded.visibleEdges[0].source, "image");
const nested = combineGroups(nodes, edges, [a, b], "nest", "outer");
assert.equal(nested.nodes[0].id, "outer");
assert.equal(nested.nodes.find((node) => node.id === "a")?.parentId, "outer");
assert.deepEqual(nested.edges, edges);
assert.deepEqual(dissolveGroups(nested.nodes, new Set(["outer", "a"])).find((node) => node.id === "image")?.position, { x: 30, y: 50 });
const outputs = ["a", "b"].map((source) => ({ id: source, source, target: "extract", sourceHandle: "group-materials", targetHandle: "animated-images" }));
const merged = combineGroups(nodes, outputs, [a, b], "merge", "merged");
assert.equal(merged.nodes.find((node) => node.id === "image")?.parentId, "merged");
assert.deepEqual(merged.edges.map((edge) => edge.source), ["merged"]);
const ordered: CanvasGroupNode = { id: "ordered", type: "group", position: { x: 0, y: 0 }, style: { width: 400, height: 300 }, data: { label: "有序组", orderedChildIds: ["first"] } };
const first: CanvasNode = { id: "first", type: "module", parentId: "ordered", position: { x: 20, y: 20 }, style: { width: 100, height: 100 }, data: { moduleType: "image", assetId: "asset-1" } };
const second: CanvasNode = { id: "second", type: "module", position: { x: 150, y: 50 }, style: { width: 100, height: 100 }, data: { moduleType: "image", assetId: "asset-2" } };
const inserted = applyGroupDrop([ordered, first, second], second, ordered.id);
const insertedGroup = inserted.find((node) => node.id === ordered.id);
assert.ok(insertedGroup?.type === "group");
assert.deepEqual(insertedGroup.data.orderedChildIds, ["first", "second"]);
const removed = applyGroupDrop(inserted, inserted.find((node) => node.id === "first")!, undefined);
const removedGroup = removed.find((node) => node.id === ordered.id);
assert.ok(removedGroup?.type === "group");
assert.deepEqual(removedGroup.data.orderedChildIds, ["second"]);
const resizedGroup: CanvasGroupNode = { id: "resized", type: "group", position: { x: 0, y: 0 },
  style: { width: 400, height: 300 }, width: 900, height: 800, measured: { width: 900, height: 800 }, data: { label: "组" } };
const movedInside: CanvasNode = { id: "moved-inside", type: "module", parentId: resizedGroup.id,
  position: { x: 650, y: 500 }, style: { width: 200, height: 180 }, data: { moduleType: "image" } };
assert.equal(groupDropTarget([resizedGroup, movedInside], movedInside), resizedGroup.id,
  "拖动命中应使用拉大后的组尺寸，不能使用打组时留下的 style 尺寸");
const reopenedResizedGroup = { ...resizedGroup, measured: undefined };
assert.equal(groupDropTarget([reopenedResizedGroup, movedInside], movedInside), resizedGroup.id,
  "保存后不含临时测量尺寸时，仍应使用持久化的拉伸尺寸");
assert.equal(applyGroupDrop([reopenedResizedGroup, movedInside], movedInside,
  groupDropTarget([reopenedResizedGroup, movedInside], movedInside)).find((node) => node.id === movedInside.id)?.parentId, resizedGroup.id);
const contained = containGroupMembers([resizedGroup, movedInside], resizedGroup.id, { width: 400, height: 300 });
const containedGroup = contained.find((node) => node.id === resizedGroup.id)!;
const containedImage = contained.find((node) => node.id === movedInside.id)!;
assert.equal(containedImage.parentId, resizedGroup.id);
assert.ok(containedImage.position.x >= 16 && containedImage.position.x + 200 <= Number(containedGroup.width) - 16);
assert.ok(containedImage.position.y >= 38 && containedImage.position.y + 180 <= Number(containedGroup.height) - 16);
const tooSmall = containGroupMembers([resizedGroup, movedInside], resizedGroup.id, { width: 100, height: 100 });
assert.ok(Number(tooSmall.find((node) => node.id === resizedGroup.id)?.width) >= 260);
const anotherInside: CanvasNode = { ...movedInside, id: "another-inside", position: { x: 20, y: 40 } };
const packed = containGroupMembers([resizedGroup, movedInside, anotherInside], resizedGroup.id, { width: 260, height: 180 });
const packedGroup = packed.find((node) => node.id === resizedGroup.id)!;
const packedChildren = packed.filter((node) => node.parentId === resizedGroup.id);
assert.ok(Number(packedGroup.height) >= 38 + 180 * 2 + 16 * 2);
assert.ok(Math.abs(packedChildren[0].position.y - packedChildren[1].position.y) >= 180);
const scaleGroup: CanvasGroupNode = { id: "scale", type: "group", position: { x: 0, y: 0 },
  style: { width: 650, height: 400 }, data: { label: "图片组" } };
const scaleImages: CanvasNode[] = Array.from({ length: 3 }, (_, index) => ({
  id: `scale-image-${index}`, type: "module", parentId: "scale", position: { x: 16 + index * 210, y: 54 },
  style: { width: 190, height: 150 }, data: { moduleType: "image", naturalSizeApplied: true },
}));
const scaleEnabled = setGroupResizeMode([scaleGroup, ...scaleImages], "scale", "scale");
const alreadyNarrow: CanvasGroupNode = { ...scaleGroup, style: { width: 300, height: 380 } };
const enabledAfterShrink = setGroupResizeMode([alreadyNarrow, ...scaleImages], "scale", "scale");
assert.ok(enabledAfterShrink.filter((node) => node.parentId === "scale").every((node) =>
  node.position.x + Number(node.style?.width) <= 300 && node.position.y + Number(node.style?.height) <= 380),
"已缩小的组点击内容随组缩放后应立即把全部图片排进当前组框");
const narrowed = containGroupMembers(scaleEnabled, "scale", { width: 300, height: 380 });
const scaledGroup = narrowed.find((node) => node.id === "scale")!;
const scaledImages = narrowed.filter((node) => node.parentId === "scale");
assert.ok(scaledImages.every((node) => Number(node.style?.width) < 190));
assert.ok(scaledImages.every((node) => node.position.x + Number(node.style?.width) <= Number(scaledGroup.width)));
const sortedImages = [...scaledImages].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
assert.ok(sortedImages[1].position.x - sortedImages[0].position.x < 210, "间距应随图片缩小，不能留下原来的空隙");
const narrowedAgain = containGroupMembers(narrowed, "scale", { width: 300, height: 380 });
assert.deepEqual(narrowedAgain.filter((node) => node.parentId === "scale").map((node) => node.style), scaledImages.map((node) => node.style),
  "重复缩放必须基于原展示尺寸，不能累积误差");
const restoredScale = containGroupMembers(narrowed, "scale", { width: 650, height: 400 });
assert.ok(restoredScale.filter((node) => node.parentId === "scale").every((node) => Number(node.style?.width) === 190));
const reflowed = setGroupResizeMode(narrowed, "scale", "reflow");
assert.ok(reflowed.filter((node) => node.parentId === "scale").every((node) => Number(node.style?.width) === 190));
assert.equal((reflowed.find((node) => node.id === "scale") as CanvasGroupNode).data.scaleBase, undefined);
const mixedGroup = setGroupResizeMode([scaleGroup, ...scaleImages, { ...a, parentId: "scale" }], "scale", "scale");
assert.equal((mixedGroup.find((node) => node.id === "scale") as CanvasGroupNode).data.resizeMode, "scale");
assert.deepEqual(mixedGroup.find((node) => node.id === scaleImages[0].id)?.position, scaleImages[0].position,
  "混合组应记住统一开关，但切换时不能移动其他内容");
const anotherGroup: CanvasGroupNode = { id: "another-group", type: "group", position: { x: 800, y: 0 },
  style: { width: 300, height: 380 }, data: { label: "另一组" } };
const anotherImage: CanvasNode = { ...scaleImages[0], id: "another-image", parentId: anotherGroup.id, position: { x: 450, y: 54 } };
const allScaled = setAllGroupResizeModes([alreadyNarrow, ...scaleImages, anotherGroup, anotherImage], "scale");
assert.ok(allScaled.filter((node) => node.type === "group").every((node) => node.data.resizeMode === "scale"));
assert.ok(allScaled.filter((node) => node.type === "module").every((node) => node.position.x + Number(node.style?.width) <= 300));
const reopenedAllScaled = setAllGroupResizeModes(allScaled, "scale");
assert.deepEqual(reopenedAllScaled.filter((node) => node.type === "module").map((node) => node.style),
  allScaled.filter((node) => node.type === "module").map((node) => node.style),
  "刷新后不能把已经缩小的图片误记成原展示尺寸");
const allRestored = setAllGroupResizeModes(allScaled, "reflow");
assert.ok(allRestored.filter((node) => node.type === "group").every((node) => node.data.resizeMode === "reflow"));
assert.ok(allRestored.filter((node) => node.type === "module").every((node) => Number(node.style?.width) === 190));
const orderedScaleGroup: CanvasGroupNode = { ...alreadyNarrow, data: { label: "有序组", orderedChildIds: scaleImages.map((node) => node.id) } };
const orderedScaled = setAllGroupResizeModes([orderedScaleGroup, ...scaleImages], "scale");
assert.equal((orderedScaled.find((node) => node.id === orderedScaleGroup.id) as CanvasGroupNode).data.resizeMode, "scale",
  "有序图片组也应服从画布统一开关");
assert.ok(orderedScaled.filter((node) => node.parentId === orderedScaleGroup.id).every((node) =>
  node.position.x + Number(node.style?.width) <= 300));
const frameTask: FrameExtractionTask = { id: "task", projectId: "project", status: "ready", expiresAt: "", sources: [{
  id: "source", sourceAssetId: "asset", name: "动图", position: 0, status: "ready", width: 100, height: 100,
  totalDurationMs: 80, collectionId: null, errorCode: null, errorMessage: null,
  frames: [{ id: "frame", position: 0, sourcePosition: 0, timelineStartMs: 0, durationMs: 80, previewUrl: "/frame", retained: true }],
}] };
const staleBatch: CanvasGroupNode = { id: "batch", type: "group", position: { x: 100, y: 200 },
  style: { width: 652, height: 1295 }, data: { label: "动画帧批次", frameTask } };
const collapsedSequence: CanvasGroupNode = { id: "sequence", type: "group", parentId: staleBatch.id,
  position: { x: 24, y: 218 }, style: { width: 400, height: 536 }, data: { label: "动图", collapsed: true, frameSourceId: "source" } };
const afterSave = syncFrameBatch([staleBatch, collapsedSequence], staleBatch, frameTask);
const syncedSequence = afterSave.find((node) => node.id === collapsedSequence.id);
assert.ok(syncedSequence?.type === "group");
assert.deepEqual(syncedSequence.data.orderedChildIds, ["sequence-frame-frame"]);
assert.deepEqual(syncedSequence.data.frameDurationsMs, { "sequence-frame-frame": 80 });
const restoredSequence = restoreFrameBatches(afterSave.map((node) => node.id === collapsedSequence.id ? collapsedSequence : node))
  .find((node) => node.id === collapsedSequence.id);
assert.ok(restoredSequence?.type === "group");
assert.deepEqual(restoredSequence.data.orderedChildIds, ["sequence-frame-frame"]);
const savedBatch = afterSave.find((node) => node.id === staleBatch.id);
assert.ok(savedBatch?.type === "group");
assert.equal(savedBatch.style?.height, 388, "折叠后的批次应收紧到可见小组，而不是沿用旧展开高度");
assert.equal(frameBatchCompactSize([staleBatch, collapsedSequence], staleBatch.id).height, 388,
  "复制位置应按封面占用高度计算，不能直接使用旧批次高度");
const expandedSequence: CanvasGroupNode = { ...collapsedSequence, data: { ...collapsedSequence.data, collapsed: false } };
const whileExpanded = syncFrameBatch([staleBatch, expandedSequence], staleBatch, frameTask);
const expandedBatch = whileExpanded.find((node) => node.id === staleBatch.id);
assert.ok(expandedBatch?.type === "group");
assert.equal(expandedBatch.style?.height, 388, "展开编辑的临时尺寸不能写进批次的持久尺寸");
const reopenedBatch = restoreFrameBatches([staleBatch, collapsedSequence]).find((node) => node.id === staleBatch.id);
assert.ok(reopenedBatch?.type === "group");
assert.equal(reopenedBatch.style?.height, 388, "已有画布重新打开时也应修正旧的过大批次尺寸");
const otherCovers: CanvasGroupNode[] = [
  { x: 24, y: 42 }, { x: 234, y: 42 }, { x: 444, y: 42 }, { x: 234, y: 218 },
].map((position, index) => ({ ...collapsedSequence, id: `cover-${index}`, position,
  data: { ...collapsedSequence.data, frameSourceId: `other-${index}` } }));
const fiveCoverBatch = restoreFrameBatches([staleBatch, collapsedSequence, ...otherCovers]).find((node) => node.id === staleBatch.id);
assert.ok(fiveCoverBatch?.type === "group");
assert.equal(fiveCoverBatch.style?.width, 652);
assert.equal(fiveCoverBatch.style?.height, 388);
const fragment = copyCanvasSelection([
  { ...ordered, selected: true, data: { ...ordered.data, orderedChildIds: [first.id, second.id], frameDurationsMs: { [first.id]: 80 } } },
  first, { ...second, parentId: ordered.id }, { ...staleBatch, selected: true },
], [{ id: "inside", source: first.id, target: second.id }, { id: "outside", source: second.id, target: staleBatch.id }]);
const pasted = pasteCanvasSelection(fragment, { x: 400, y: 500 });
const [pastedGroup, pastedFirst, pastedSecond] = pasted.nodes;
assert.ok(pastedGroup.type === "group");
assert.deepEqual(pastedGroup.position, { x: 400, y: 500 });
assert.notEqual(pastedGroup.id, ordered.id);
assert.equal(pastedFirst.parentId, pastedGroup.id);
assert.deepEqual(pastedGroup.data.orderedChildIds, [pastedFirst.id, pastedSecond.id]);
assert.deepEqual(pastedGroup.data.frameDurationsMs, { [pastedFirst.id]: 80 });
assert.equal(pastedFirst.type === "module" && pastedFirst.data.assetId, "asset-1");
assert.deepEqual(pasted.edges.map(({ source, target }) => [source, target]), [[pastedFirst.id, pastedSecond.id]]);
const orderedImages: CanvasNode[] = Array.from({ length: 5 }, (_, index) => ({
  ...first, id: `ordered-${index}`, parentId: ordered.id,
  position: { x: 400 - index * 60, y: index % 2 * 150 },
  data: { moduleType: "image", assetId: `asset-${index}`, previewUrl: "/image.png" },
}));
const orderedGrid: CanvasGroupNode = { ...ordered, style: { width: 650, height: 300 }, data: {
  label: "有序组", orderedChildIds: orderedImages.map((node) => node.id).reverse(),
  frameDurationsMs: { "ordered-3": 80 },
} };
const grid = layoutOrderedGroup([orderedGrid, ...orderedImages], ordered.id);
const gridGroup = grid.find((node) => node.id === ordered.id)!;
const framesByOrder = orderedGrid.data.orderedChildIds!.map((id) => grid.find((node) => node.id === id)!);
assert.deepEqual(framesByOrder.map((node) => node.position), [
  { x: 24, y: 42 }, { x: 224, y: 42 }, { x: 424, y: 42 }, { x: 24, y: 208 }, { x: 224, y: 208 },
], "有序组的视觉排列必须严格跟随保存的帧顺序");
assert.equal(layoutOrderedGroup(grid, ordered.id), grid, "稳定布局不能反复触发画布更新");
const narrowGrid = containGroupMembers(grid, ordered.id, { width: 300, height: 180 });
assert.equal(narrowGrid.find((node) => node.id === framesByOrder[1].id)?.position.y, 208);
assert.deepEqual((narrowGrid.find((node) => node.id === ordered.id) as CanvasGroupNode).data.orderedChildIds,
  orderedGrid.data.orderedChildIds, "组框换行不能改变播放顺序");
const insertion = orderedInsertion(grid, ordered.id, { ...framesByOrder[3], position: { x: -40, y: 42 } });
assert.equal(insertion?.order[0], framesByOrder[3].id);
assert.equal(insertion?.order.length, 5);
assert.equal((gridGroup as CanvasGroupNode).data.frameDurationsMs?.["ordered-3"], 80);
const staticStatus = new Map(orderedImages.map((node, index) => [`asset-${index}`, { status: "static" }]));
assert.equal(orderedMembersError(orderedImages, staticStatus), undefined);
assert.ok(orderedMembersError([...orderedImages, b], staticStatus));
assert.ok(orderedMembersError(orderedImages, new Map()));
staticStatus.set("asset-2", { status: "ready" });
assert.match(orderedMembersError(orderedImages, staticStatus)!, /先拆帧/);
assert.deepEqual(initialFrameOrder([
  { ...first, id: "right", position: { x: 300, y: 14 } },
  { ...first, id: "left", position: { x: 0, y: 30 } },
  { ...first, id: "below", position: { x: 0, y: 160 } },
]), ["left", "right", "below"]);
console.log("Canvas group layout and clipboard tests passed");
