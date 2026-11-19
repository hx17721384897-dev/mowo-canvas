import assert from "node:assert/strict";
import { CanvasDocumentError, validateCanvasDocument } from "./canvas-document.ts";
import { restoreFrameBatches, syncFrameBatch } from "../canvas/frame-batch-layout.ts";
import { arrangeGroupChildren, projectExpandedBatches } from "../canvas/arrange-group.ts";
import type { CanvasDocumentState } from "./types";

const valid = {
  schemaVersion: 1,
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [
    { id: "group", type: "group", position: { x: 0, y: 0 }, data: { label: "组" } },
    { id: "image", type: "module", parentId: "group", position: { x: 0, y: 0 }, style: { width: 132 }, data: { moduleType: "image", assetId: "asset" } },
    { id: "extract", type: "module", position: { x: 200, y: 0 }, data: { moduleType: "frame-extraction" } },
    { id: "result", type: "module", position: { x: 500, y: 0 }, data: { moduleType: "frame-result", frameTask: {
      id: "task", projectId: "project", status: "ready", expiresAt: "2026-11-05T00:00:00Z",
      sources: [{ id: "source", name: "动图", status: "ready", frames: [{
        id: "frame", position: 0, sourcePosition: 0, timelineStartMs: 0, durationMs: 80, previewUrl: "/api/frame", retained: true,
      }] }],
    } } },
  ],
  edges: [
    { id: "legacy", source: "image", target: "extract" },
    { id: "result-edge", source: "extract", target: "result", sourceHandle: "frame-sequences", targetHandle: "source-task" },
  ],
};
const serialized = JSON.stringify(valid);
validateCanvasDocument(valid);
validateCanvasDocument({ ...valid, nodes: valid.nodes.map((node) => node.id === "group"
  ? { ...node, data: { ...node.data, quickActionLayout: { toolbar: ["arrange", "preview", "toggle-collapse", "ungroup", "delete"], more: ["toggle-scale", "toggle-order"] } } } : node) });
assert.throws(() => validateCanvasDocument({ ...valid, nodes: valid.nodes.map((node) => node.id === "group"
  ? { ...node, data: { ...node.data, quickActionLayout: { toolbar: ["delete", "delete"], more: [] } } } : node) }), CanvasDocumentError);
validateCanvasDocument({ ...valid, groupContentScaleEnabled: true });
assert.throws(() => validateCanvasDocument({ ...valid, groupContentScaleEnabled: "true" }), CanvasDocumentError);
validateCanvasDocument({ ...valid, nodes: valid.nodes.map((node) => node.id === "group"
  ? { ...node, data: { ...node.data, resizeMode: "scale", scaleBase: { image: { width: 190, height: 150 } } } } : node) });
assert.throws(() => validateCanvasDocument({ ...valid, nodes: valid.nodes.map((node) => node.id === "group"
  ? { ...node, data: { ...node.data, resizeMode: "scale", scaleBase: { image: { width: -1, height: 150 } } } } : node) }), CanvasDocumentError);
const validated: CanvasDocumentState = valid;
const editor = validated.nodes.find((node) => node.id === "result");
const task = editor?.type === "module" ? editor.data.frameTask : undefined;
assert.ok(task);
const legacyBatch = { id: "real-batch", type: "module" as const, position: { x: 350, y: 0 }, data: { moduleType: "frame-batch" as const, frameTask: task } };
const migrated = restoreFrameBatches([...validated.nodes, legacyBatch]);
const batch = migrated.find((node) => node.id === legacyBatch.id);
assert.ok(batch?.type === "group");
const child = migrated.find((node) => node.parentId === batch.id);
assert.ok(child?.type === "group" && child.data.collapsed);
assert.equal(migrated.filter((node) => node.parentId === child.id).length, 1);
validateCanvasDocument({
  ...valid, nodes: migrated,
  edges: [
    { id: "real-input", source: "extract", target: batch.id, sourceHandle: "frame-sequences", targetHandle: "source-task" },
    { id: "real-output", source: batch.id, target: "result", sourceHandle: "sequences", targetHandle: "source-task" },
  ],
});
validateCanvasDocument({
  ...valid, nodes: migrated.map((node) => node.id === "group" && node.type === "group"
    ? { ...node, data: { ...node.data, orderedChildIds: ["image"] } } : node),
  edges: [
    { id: "ordered-editor", source: "group", target: "result", sourceHandle: "group-materials", targetHandle: "source-task" },
    { id: "batch-editor", source: batch.id, target: "result", sourceHandle: "sequences", targetHandle: "source-task" },
  ],
});
const edited = { ...task, sources: task.sources.map((source) => ({ ...source, frames: source.frames.map((frame) => ({ ...frame, retained: false })) })) };
const moved = migrated.map((node) => node.id === child.id ? { ...child, position: { x: 90, y: 55 }, data: { ...child.data, collapsed: false } } : node);
const synced = syncFrameBatch(moved, batch, edited);
assert.equal(synced.filter((node) => node.parentId === child.id).length, 0);
assert.deepEqual(synced.find((node) => node.id === child.id)?.position, { x: 90, y: 55 });
const syncedChild = synced.find((node) => node.id === child.id);
assert.ok(syncedChild?.type === "group");
assert.equal(syncedChild.data.collapsed, false);
const sibling = { ...child, id: "sibling", data: { ...child.data, frameSourceId: "other" } };
const previewNodes = [...moved, sibling];
const projection = projectExpandedBatches(previewNodes);
assert.ok(projection.positions.get(child.id)!.y >= projection.positions.get(sibling.id)!.y + 146);
assert.deepEqual(previewNodes.find((node) => node.id === child.id)?.position, { x: 90, y: 55 });
assert.equal(projectExpandedBatches([...migrated, sibling]).positions.size, 0);
const ordinaryImages = ["animated", "static"].map((id) => ({
  id, type: "module" as const, position: { x: 0, y: 0 },
  data: { moduleType: "image" as const, previewUrl: "/image", assetId: id },
}));
const arranged = arrangeGroupChildren(ordinaryImages, new Map([["animated", true], ["static", false]]), 600);
assert.deepEqual(arranged.nodes.map((node) => node.id), ["static", "animated"]);
assert.equal(arranged.nodes[0].style?.width, 180);
assert.ok(arranged.nodes[1].position.y > arranged.nodes[0].position.y + 146);
validateCanvasDocument({
  ...valid,
  nodes: [...valid.nodes, { id: "batch", type: "module", position: { x: 350, y: 0 }, data: { moduleType: "frame-batch" } }],
  edges: [
    { id: "extract-batch", source: "extract", target: "batch", sourceHandle: "frame-sequences", targetHandle: "source-task" },
    { id: "batch-editor", source: "batch", target: "result", sourceHandle: "sequences", targetHandle: "source-task" },
  ],
});
validateCanvasDocument({ ...valid, edges: [{ id: "group-link", source: "group", target: "extract", sourceHandle: "group-materials", targetHandle: "animated-images" }] });
validateCanvasDocument({ ...valid,
  nodes: [...migrated, { id: "other-batch", type: "group", position: { x: 800, y: 0 }, data: { label: "动画帧批次", frameTask: task } }],
  edges: [
    { id: "first-batch", source: batch.id, target: "result", sourceHandle: "sequences", targetHandle: "source-task" },
    { id: "second-batch", source: "other-batch", target: "result", sourceHandle: "sequences", targetHandle: "source-task" },
  ],
});
validateCanvasDocument({ ...valid, nodes: migrated, edges: [
  { id: "sequence-editor", source: child.id, target: "result", sourceHandle: "sequences", targetHandle: "source-task" },
] });
validateCanvasDocument({ ...valid, nodes: valid.nodes.map((node) => node.id === "group"
  ? { ...node, data: { ...node.data, orderedChildIds: ["image"], frameDurationsMs: { image: 100 } } } : node) });
assert.equal(JSON.stringify(valid), serialized);
const invalid = (value: unknown, field: string, code = "INVALID_CANVAS") => {
  assert.throws(() => validateCanvasDocument(value), (error) => error instanceof CanvasDocumentError && error.field === field && error.code === code);
};
invalid({ ...valid, schemaVersion: 2 }, "schemaVersion", "UNSUPPORTED_CANVAS_VERSION");
invalid({ ...valid, nodes: [null] }, "nodes[0].id");
invalid({ ...valid, viewport: { x: 0, y: 0, zoom: -2 } }, "viewport.zoom");
invalid({ ...valid, edges: [{ id: "bad", source: "image" }] }, "edges[0].target");
invalid({ ...valid, edges: [{ ...valid.edges[1], targetHandle: "missing" }] }, "edges[0].targetHandle");
invalid({ ...valid, edges: [{ id: "wrong-group-link", source: "group", target: "image", sourceHandle: "group-materials", targetHandle: "image-input" }] }, "edges[0].targetHandle");
invalid({ ...valid, nodes: valid.nodes.map((node) => node.id === "group"
  ? { ...node, data: { ...node.data, orderedChildIds: ["extract"] } } : node) }, "nodes[0].data.orderedChildIds");
invalid({ ...valid, nodes: valid.nodes.map((node) => node.id === "group"
  ? { ...node, data: { ...node.data, orderedChildIds: ["image"], frameDurationsMs: { image: -1 } } } : node) }, "nodes[0].data.frameDurationsMs");
invalid({ ...valid, nodes: [{ ...valid.nodes[0], parentId: "group" }, ...valid.nodes.slice(1)] }, "nodes[0].parentId");
invalid({ ...valid, nodes: Array(5001).fill(null) }, "nodes", "CANVAS_LIMIT");
console.log("Canvas document validation tests passed");
