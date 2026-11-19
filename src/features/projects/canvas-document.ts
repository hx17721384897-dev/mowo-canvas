import { canConnectPorts, canvasModules, groupMaterialsPort, stitchResultPort } from "../canvas/module-metadata.ts";
import { validGroupActionLayout } from "../canvas/group-quick-actions.ts";
import { validCropPlan } from "../canvas/image-crop.ts";
import { videoFrameConfigSchema } from "../frame-extraction/video-frame-controls.ts";
import type { CanvasModuleType } from "../canvas/types";
import type { CanvasDocumentState } from "./types";

export const MAX_CANVAS_BYTES = 5 * 1024 * 1024;

export class CanvasDocumentError extends Error {
  readonly field: string;
  readonly code: string;

  constructor(field: string, message: string, code = "INVALID_CANVAS") {
    super(message);
    this.field = field;
    this.code = code;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function id(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function optionalFields(value: Record<string, unknown>, keys: string[], type: "string" | "boolean", field: string) {
  for (const key of keys) {
    if (value[key] !== undefined && typeof value[key] !== type) {
      throw new CanvasDocumentError(field + "." + key, "字段类型无效");
    }
  }
}

function validateFrameData(data: Record<string, unknown>, field: string) {
  if (data.frameTask !== undefined) {
    const task = data.frameTask;
    if (!record(task) || !id(task.id) || !Array.isArray(task.sources)) {
      throw new CanvasDocumentError(field + ".frameTask", "拆帧任务结构无效");
    }
    for (const [index, source] of task.sources.entries()) {
      if (!record(source) || !id(source.id) || typeof source.name !== "string" || !Array.isArray(source.frames)
        || source.frames.some((frame: unknown) => !record(frame) || !id(frame.id) || typeof frame.previewUrl !== "string"
          || typeof frame.retained !== "boolean" || ![frame.position, frame.sourcePosition, frame.durationMs, frame.timelineStartMs].every(Number.isFinite))) {
        throw new CanvasDocumentError(field + ".frameTask.sources[" + index + "]", "拆帧序列结构无效");
      }
    }
  }
  if (data.savedSequences !== undefined && (!record(data.savedSequences)
    || Object.values(data.savedSequences).some((sequence) => !record(sequence) || !id(sequence.collectionId)
      || typeof sequence.name !== "string" || !Array.isArray(sequence.assets)
      || sequence.assets.some((asset: unknown) => !record(asset) || !id(asset.id)
        || typeof asset.name !== "string" || typeof asset.previewUrl !== "string")))) {
    throw new CanvasDocumentError(field + ".savedSequences", "已保存序列结构无效");
  }
}

export function validateCanvasDocument(value: unknown): asserts value is CanvasDocumentState {
  if (!record(value) || value.schemaVersion !== 1) {
    throw new CanvasDocumentError("schemaVersion", "不支持的画布文档版本", "UNSUPPORTED_CANVAS_VERSION");
  }
  optionalFields(value, ["groupContentScaleEnabled"], "boolean", "canvas");
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    throw new CanvasDocumentError("nodes/edges", "节点和连线必须是数组");
  }
  if (value.nodes.length > 5000 || value.edges.length > 10000) {
    throw new CanvasDocumentError(value.nodes.length > 5000 ? "nodes" : "edges", "画布超出节点或连线数量上限", "CANVAS_LIMIT");
  }
  const viewport = value.viewport;
  if (!record(viewport) || !Number.isFinite(viewport.x) || !Number.isFinite(viewport.y)) {
    throw new CanvasDocumentError("viewport", "视口坐标必须是有限数值");
  }
  if (typeof viewport.zoom !== "number" || !Number.isFinite(viewport.zoom) || viewport.zoom < 0.05 || viewport.zoom > 2) {
    throw new CanvasDocumentError("viewport.zoom", "缩放必须在 0.05 到 2 之间");
  }

  const nodes = new Map<string, { group: boolean; frameSequence: boolean; stitchResult: boolean; module?: CanvasModuleType; parent?: string; index: number }>();
  for (const [index, node] of value.nodes.entries()) {
    const field = "nodes[" + index + "]";
    if (!record(node) || !id(node.id) || nodes.has(node.id)) throw new CanvasDocumentError(field + ".id", "节点必须有唯一 ID");
    if (!record(node.position) || !Number.isFinite(node.position.x) || !Number.isFinite(node.position.y)) {
      throw new CanvasDocumentError(field + ".position", "节点坐标必须是有限数值");
    }
    if (node.parentId !== undefined && !id(node.parentId)) throw new CanvasDocumentError(field + ".parentId", "父节点 ID 无效");
    const data = node.data;
    if (!record(data)) throw new CanvasDocumentError(field + ".data", "节点数据必须是对象");
    const group = node.type === "group";
    let moduleType: CanvasModuleType | undefined;
    if (group) {
      if (typeof data.label !== "string") throw new CanvasDocumentError(field + ".data.label", "组名称必须是文字");
      optionalFields(data, ["frameSourceId"], "string", field + ".data");
      optionalFields(data, ["frameSaved", "stitchResult"], "boolean", field + ".data");
      if (data.frameTask !== undefined) {
        validateFrameData(data, field + ".data");
        moduleType = "frame-batch";
      }
      optionalFields(data, ["collapsed"], "boolean", field + ".data");
      if (data.quickActionLayout !== undefined && !validGroupActionLayout(data.quickActionLayout)) {
        throw new CanvasDocumentError(field + ".data.quickActionLayout", "组快捷工具配置无效");
      }
      if (data.resizeMode !== undefined && data.resizeMode !== "reflow" && data.resizeMode !== "scale") {
        throw new CanvasDocumentError(field + ".data.resizeMode", "不支持的组缩放模式");
      }
      if (data.scaleBase !== undefined && (!record(data.scaleBase) || Object.keys(data.scaleBase).length > 1000
        || Object.entries(data.scaleBase).some(([key, size]) => !id(key) || !record(size)
          || typeof size.width !== "number" || typeof size.height !== "number"
          || !Number.isFinite(size.width) || !Number.isFinite(size.height)
          || size.width < 80 || size.height < 80 || size.width > 100000 || size.height > 100000))) {
        throw new CanvasDocumentError(field + ".data.scaleBase", "组内原展示尺寸无效");
      }
      if (data.orderedChildIds !== undefined && (!Array.isArray(data.orderedChildIds)
        || data.orderedChildIds.length > 1000 || data.orderedChildIds.some((value) => !id(value))
        || new Set(data.orderedChildIds).size !== data.orderedChildIds.length)) {
        throw new CanvasDocumentError(field + ".data.orderedChildIds", "组内顺序必须是唯一节点 ID 列表");
      }
      if (data.frameDurationsMs !== undefined && (!record(data.frameDurationsMs)
        || Object.entries(data.frameDurationsMs).length > 1000
        || Object.entries(data.frameDurationsMs).some(([key, duration]) => !id(key) || typeof duration !== "number" || !Number.isInteger(duration) || duration < 1 || duration > 3600000))) {
        throw new CanvasDocumentError(field + ".data.frameDurationsMs", "帧停留时间必须在 1 到 3600000 毫秒之间");
      }
    } else {
      if (node.type !== "module" || typeof data.moduleType !== "string" || !Object.hasOwn(canvasModules, data.moduleType)) {
        throw new CanvasDocumentError(field + ".data.moduleType", "不支持的节点类型");
      }
      moduleType = data.moduleType as CanvasModuleType;
      optionalFields(data, ["assetId", "previewUrl", "title", "detail", "textContent", "statusMessage", "derivationId"], "string", field + ".data");
      optionalFields(data, ["busy", "naturalSizeApplied"], "boolean", field + ".data");
      if (data.cropPlan !== undefined && (moduleType !== "crop-result" || !validCropPlan(data.cropPlan))) {
        throw new CanvasDocumentError(field + ".data.cropPlan", "裁切方案无效");
      }
      validateFrameData(data, field + ".data");
      if (data.videoFrameConfig !== undefined && (moduleType !== "video-frame-extraction" || !videoFrameConfigSchema.safeParse(data.videoFrameConfig).success)) {
        throw new CanvasDocumentError(field + ".data.videoFrameConfig", "视频拆帧参数无效");
      }
    }
    nodes.set(node.id, { group, frameSequence: group && typeof data.frameSourceId === "string", stitchResult: group && data.stitchResult === true, module: moduleType, parent: node.parentId, index });
  }

  const checked = new Set<string>();
  for (const [nodeId, node] of nodes) {
    const path = new Set<string>();
    let current: string | undefined = nodeId;
    while (current !== undefined && !checked.has(current)) {
      const entry: { parent?: string; index: number } = nodes.get(current)!;
      const field = "nodes[" + node.index + "].parentId";
      if (path.has(current)) throw new CanvasDocumentError(field, "父子关系不能形成循环");
      path.add(current);
      if (entry.parent !== undefined && !nodes.get(entry.parent)?.group) {
        throw new CanvasDocumentError("nodes[" + entry.index + "].parentId", "父节点必须是现存的组");
      }
      current = entry.parent;
    }
    for (const visited of path) checked.add(visited);
  }

  for (const [index, node] of value.nodes.entries()) {
    if (node.type !== "group" || node.data.orderedChildIds === undefined) continue;
    for (const childId of node.data.orderedChildIds) {
      if (nodes.get(childId)?.parent !== node.id) {
        throw new CanvasDocumentError(`nodes[${index}].data.orderedChildIds`, "顺序成员必须是当前组的直接子节点");
      }
    }
  }

  const edgeIds = new Set<string>();
  const usedPorts = new Set<string>();
  for (const [index, edge] of value.edges.entries()) {
    const field = "edges[" + index + "]";
    if (!record(edge) || !id(edge.id) || edgeIds.has(edge.id)) throw new CanvasDocumentError(field + ".id", "连线必须有唯一 ID");
    edgeIds.add(edge.id);
    const source = typeof edge.source === "string" ? nodes.get(edge.source) : undefined;
    const target = typeof edge.target === "string" ? nodes.get(edge.target) : undefined;
    if (!source) throw new CanvasDocumentError(field + ".source", "起点必须是现存节点");
    if (!target) throw new CanvasDocumentError(field + ".target", "终点必须是现存的模块节点");
    const outputs = source.module ? canvasModules[source.module].outputs : source.frameSequence ? canvasModules["frame-result"].outputs : [groupMaterialsPort];
    const inputs = target.stitchResult ? [stitchResultPort] : target.module ? canvasModules[target.module].inputs : [];
    const output = edge.sourceHandle == null && outputs.length === 1 ? outputs[0] : outputs.find((port) => port.id === edge.sourceHandle);
    const input = edge.targetHandle == null && inputs.length === 1 ? inputs[0] : inputs.find((port) => port.id === edge.targetHandle);
    if (!output) throw new CanvasDocumentError(field + ".sourceHandle", "输出端口无效");
    if (!input || !canConnectPorts(output, input)) throw new CanvasDocumentError(field + ".targetHandle", "输入端口无效或不兼容");
    const key = JSON.stringify([edge.target, input.id]);
    if (!input.multiple && usedPorts.has(key)) throw new CanvasDocumentError(field + ".targetHandle", "该输入端口只允许一条连线");
    usedPorts.add(key);
  }
}
