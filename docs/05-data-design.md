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
- `updatedAt`

第一版本地单用户数据不保存 `revision`；它是未来多窗口或多人并发编辑时才引入的冲突控制字段。

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

### AssetCollectionItem

- `collectionId`
- `assetId`
- `position`

集合成员关系独立保存顺序；同一个资产可以被不同集合引用而不复制文件。

### ProjectAsset

- `projectId`
- `assetId`
- `addedAt`

`projectId + assetId` 必须唯一。项目通过关联记录使用全局资产；从历史画布添加资产时只新增关联记录，避免把同一物理文件复制到多个项目。

## 文件去重原则

- 图片和视频导入临时区后计算内容指纹。
- 已存在相同内容指纹时复用原文件和资产身份，只增加项目关联。
- 原始文件名、来源和导入时间保存在结构化数据中，不依赖物理文件名表达业务含义。
- 缩略图和视频封面属于可重建缓存，不作为原始资产。

## 画布文档基线

```ts
type CanvasDocument = {
  schemaVersion: number;
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
- 当前本地单用户版本采用整份文档覆盖；未来支持多窗口或多人并发编辑时增加 `revision` 检测旧数据覆盖。
- 导入前验证 `schemaVersion` 与数据结构。

当前使用 Drizzle ORM 管理 SQLite。迁移包含 `projects`、`canvas_documents`、`assets`、`project_assets`、`asset_collections`、`asset_collection_items` 和下载任务表；迁移文件受 Git 管理，实际数据库不进入仓库。`canvas_documents` 按项目保存版本、节点、连线和视口 JSON。`deletedAt` 已为回收站预留，但删除与自动清理流程尚未开放。

### DownloadTask 与 DownloadItem

下载任务持久化平台、来源链接、项目、状态、进度、总数、用户安全错误与时间。下载项保存任务内顺序、临时相对路径、MIME、大小与动画标记。临时绝对路径不进入数据库或浏览器响应。

任务成功导入后，选中项转为正式 `Asset` 并形成 `AssetCollection`；任务项不是资产身份。未选项根据用户选择删除或移动至下载归档。
