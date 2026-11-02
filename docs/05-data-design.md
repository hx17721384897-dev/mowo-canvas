# 数据设计

## 原则

- 结构化数据进入 SQLite，大文件进入本地素材目录。
- 所有主要实体使用稳定的字符串 ID，不使用数组序号作为身份。
- 所有记录包含创建时间和更新时间。
- 画布文档包含 `schemaVersion`，以支持未来迁移。
- 删除项目或素材必须有明确确认与可恢复策略。

## 核心实体

### Project

- `id`
- `name`
- `createdAt`
- `updatedAt`
- `lastOpenedAt`

### CanvasDocument

- `projectId`
- `schemaVersion`
- `nodes`
- `edges`
- `viewport`
- `revision`
- `updatedAt`

### Asset

- `id`
- `type`
- `originalName`
- `relativePath`（文字资产可为空）
- `textContent`（仅文字资产）
- `mimeType`
- `size`
- `width`、`height`、`duration` 等可选元数据
- `sourceType`
- `sourceUrl`
- `contentHash`
- `createdAt`

资产是可以跨画布重复使用的长期内容，不等同于画布节点。图片、动图和视频使用本地文件；文字内容直接进入结构化数据。删除画布节点不删除资产。

### AssetCollection

- `id`
- `name`
- `sourceType`
- `sourceUrl`
- `createdAt`

集合保存同一来源或同一处理结果中的多个资产及其顺序，例如表情包、一次多视频下载或批量裁切结果。

### ProjectAsset

- `projectId`
- `assetId`
- `addedAt`

项目通过关联记录使用全局资产，避免把同一物理文件复制到多个项目。

## 画布文档基线

```ts
type CanvasDocument = {
  schemaVersion: number;
  revision: number;
  nodes: Array<{
    id: string;
    type: string;
    position: { x: number; y: number };
    data: Record<string, unknown>;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    sourceHandle?: string;
    targetHandle?: string;
  }>;
  viewport: { x: number; y: number; zoom: number };
};
```

## 保存策略

- 前端操作立即更新内存状态。
- 停止操作后进行防抖保存，避免每个像素移动都写数据库。
- 界面显示“未保存、保存中、已保存、保存失败”。
- `revision` 用于检测旧数据覆盖新数据。
- 导入前验证 `schemaVersion` 与数据结构。

具体表结构在 ORM 选定时补充，本文件不提前锁定 ORM 语法。
