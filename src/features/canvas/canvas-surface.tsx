"use client";

import { useCallback } from "react";
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  type Connection,
  type Edge,
  type IsValidConnection,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import { getCanvasModule } from "./module-registry";
import { ModuleNode } from "./nodes/module-node";
import type { CanvasModuleNode } from "./types";
import styles from "./canvas.module.css";

const nodeTypes = { module: ModuleNode };

const initialNodes: CanvasModuleNode[] = [
  {
    id: "image-1",
    type: "module",
    position: { x: 80, y: 95 },
    data: { moduleType: "image", title: "表情图集-01.png", detail: "2048 × 2048 · 3.2 MB", variant: "warm" },
  },
  {
    id: "image-2",
    type: "module",
    position: { x: 80, y: 260 },
    data: { moduleType: "image", title: "表情图集-02.png", detail: "2048 × 2048 · 2.8 MB", variant: "cool" },
  },
  {
    id: "crop-1",
    type: "module",
    position: { x: 410, y: 150 },
    data: { moduleType: "batch-crop" },
  },
];

const initialEdges: Edge[] = [
  { id: "image-1-crop", source: "image-1", sourceHandle: "image", target: "crop-1", targetHandle: "source-images", type: "smoothstep" },
  { id: "image-2-crop", source: "image-2", sourceHandle: "image", target: "crop-1", targetHandle: "source-images", type: "smoothstep" },
];

function findPort(node: CanvasModuleNode | undefined, handleId: string | null | undefined, side: "inputs" | "outputs") {
  if (!node || !handleId) return undefined;
  return getCanvasModule(node.data.moduleType)[side].find((port) => port.id === handleId);
}

export function CanvasSurface() {
  const [nodes, , onNodesChange] = useNodesState<CanvasModuleNode>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const isValidConnection: IsValidConnection<Edge> = useCallback((connection) => {
    const sourceNode = nodes.find((node) => node.id === connection.source);
    const targetNode = nodes.find((node) => node.id === connection.target);
    const sourcePort = findPort(sourceNode, connection.sourceHandle, "outputs");
    const targetPort = findPort(targetNode, connection.targetHandle, "inputs");

    if (!sourcePort || !targetPort || sourcePort.contentType !== targetPort.contentType) return false;
    if (targetPort.multiple) return true;

    return !edges.some((edge) => edge.target === connection.target && edge.targetHandle === connection.targetHandle);
  }, [edges, nodes]);

  const onConnect = useCallback((connection: Connection) => {
    setEdges((currentEdges) => addEdge({ ...connection, type: "smoothstep" }, currentEdges));
  }, [setEdges]);

  return (
    <div className={styles.surface}>
      <ReactFlow<CanvasModuleNode, Edge>
        className={styles.flow}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        deleteKeyCode={["Backspace", "Delete"]}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={2}
        selectionOnDrag
        panOnDrag={[1, 2]}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1.2} color="#d9dce6" />
        <Controls className={styles.controls} showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
