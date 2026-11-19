import type { Edge } from "@xyflow/react";
import type { VideoFrameConnectedInput } from "../frame-extraction/video-frame-controls.ts";
import type { CanvasNode } from "./types";

export function connectedFrameInputs(nodes: CanvasNode[], edges: Edge[], nodeId: string,
  type: "image" | "video", handle: string): VideoFrameConnectedInput[] {
  const connected = new Set(edges.filter((edge) => edge.target === nodeId && (edge.targetHandle ?? handle) === handle).map((edge) => edge.source));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const assets = new Map<string, VideoFrameConnectedInput>();
  for (const node of nodes) {
    if (node.type !== "module" || node.data.moduleType !== type || !node.data.assetId) continue;
    let ancestor = node.parentId;
    const seen = new Set<string>();
    while (ancestor && !connected.has(ancestor) && !seen.has(ancestor)) {
      seen.add(ancestor); ancestor = byId.get(ancestor)?.parentId;
    }
    if (connected.has(node.id) || (ancestor && connected.has(ancestor))) {
      assets.set(node.data.assetId, { assetId: node.data.assetId, name: node.data.title ?? (type === "video" ? "视频" : "动图"),
        ...(node.data.clip ? { clip: { sourceAssetId: node.data.clip.sourceAssetId } } : {}) });
    }
  }
  return [...assets.values()].sort((a, b) => a.assetId.localeCompare(b.assetId));
}
