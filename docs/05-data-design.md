# 数据设计

## 原则

- 结构化数据进入 SQLite，大文件进入本地素材目录。
- 所有主要实体使用稳定的字符串 ID，不使用数组序号作为身份。
- 所有记录包含创建时间和更新时间。
- 画布文档包含 `schemaVersion`，以支持未来迁移。
- 删除项目或素材必须有明确确认与可恢复策略。

## 核心实体

### AIConversation（对话会话）

`ai_conversations` 按 projectId 归属画布，保存稳定 ID、名称、是否手动命名和时间；一个画布可有多个会话。`ai_runs.conversation_id` 关联运行，每个会话独立组装上下文，消息与事件仍通过运行关联。迁移 0005 将已有运行归入各自画布的 legacy 会话，不复制消息或重新生成。接口及空会话复用规则见 [AI 对话接口](api/ai-runs.md)。

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

`kind` 已由动图拆帧迁移加入当前数据库；序列集合同时关联所属项目。

- `id`
- `name`
- `kind`（例如下载集合、序列帧集合、裁切结果）
- `sourceType`
- `sourceUrl`
- `createdAt`

集合保存同一来源或同一处理结果中的多个资产及其顺序，例如表情包、一次多视频下载或批量裁切结果。

### AssetCollectionItem

成员已迁移为独立 `id`，并以“集合 + 位置”保持唯一，因此同一图片可以在一个动画中重复出现。

- `id`
- `collectionId`
- `assetId`
- `position`
- `timelineStartMs`（仅时间序列需要）
- `durationMs`（仅时间序列需要）

集合成员关系独立保存顺序；同一个资产可以被不同集合引用而不复制文件。成员必须以独立 `id` 或“集合 + 位置”作为身份，不能以“集合 + 资产”作为唯一身份，因为动画中不同位置可能引用内容完全相同、但时间信息不同的图片资产。

### AssetDerivation

该实体及有顺序的输入、输出关系已由动图拆帧迁移建立；当前处理类型为 `frame-extraction`，后续拼接复用同一来源关系模型。

- `id`
- `projectId`
- `operationType`（例如 `frame-extraction`、`image-stitch`、`batch-crop`）
- `processorVersion`
- `parametersJson`
- `createdAt`

派生记录通过有顺序的输入与输出关系连接资产或资产集合。动图拆帧表现为“一张来源动图 → 一个序列帧集合及其图片成员”；图片拼接表现为“一个图片集合 → 一张派生图片”。物理内容即使因为哈希相同而复用同一资产身份，派生记录仍需独立保留业务来源。

## 派生文件目录方案

内部素材目录不使用用户可见的文件夹名称表达业务关系，业务分组和顺序进入 SQLite。派生图片采用内容寻址：

```text
MOWO Canvas Data/
└── storage/
    ├── originals/images/<哈希前缀>/<内容哈希>.<扩展名>
    └── derived/images/<哈希前缀>/<内容哈希>.<扩展名>
```

- 导入和下载得到的原始动图继续进入 `originals`。
- 拆出的完整 PNG 帧、后续拼接图片和裁切图片进入 `derived`。
- “序列帧文件夹”是界面上的集合表现，不要求磁盘上创建同名目录。
- 原始文件、派生文件和缩略图缓存严格分开；拼接只读取正式派生文件，不读取缩略图。
- 如果内容哈希已经存在，允许复用物理资产文件，但必须新增集合位置和派生关系。
- 未来“导出到普通文件夹”是独立操作，可生成便于人工阅读的文件名，不改变内部存储路径。

### 动图拆帧草稿与提交

拆帧任务采用“临时草稿 → 用户编辑 → 正式提交”两阶段流程。候选帧先写入：

```text
MOWO Canvas Data/
└── temp/frame-extraction/<任务ID>/<来源资产ID>/<帧序号>.png
```

草稿清单记录来源帧序号、顺序、时间位置、停留时间、是否保留和任务状态，但候选帧尚不是正式 `Asset`。用户从序列移除帧只修改草稿清单，可撤销；原始动图始终保持不变。

用户点击“保存序列（N帧）”后，系统只对保留候选帧计算哈希，并写入或复用 `storage/derived/images/<哈希前缀>/<内容哈希>.png`，随后建立正式 `AssetCollection`、成员位置和派生关系。未保留候选帧不进入长期项目资产，提交成功后清理；未提交草稿保留 24 小时用于意外关闭恢复，超时后自动清理。

如果 12 帧由相同 4 帧循环三次组成，内容寻址存储可能只产生 4 个物理文件，但集合仍可保存 12 个独立位置。删至 4 帧后，最终集合只保存 4 个成员位置。为此，实现拆帧前必须把当前 `asset_collection_items` 的“集合 + 资产”主键迁移为独立成员 ID，并保持“集合 + 位置”唯一。

该决策的原因记录在 [派生图片采用内容寻址存储](decisions/0005-content-addressed-derived-assets.md)。

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

当前使用 Drizzle ORM 管理 SQLite。迁移包含项目与画布、资产与集合、派生关系、下载任务和动图拆帧草稿表；迁移文件受 Git 管理，实际数据库不进入仓库。`canvas_documents` 按项目保存版本、节点、连线和视口 JSON。`deletedAt` 已为回收站预留，但删除与自动清理流程尚未开放。

### DownloadTask 与 DownloadItem

下载任务持久化平台、来源链接、项目、状态、进度、总数、用户安全错误与时间。下载项保存任务内顺序、临时相对路径、MIME、大小与动画标记。临时绝对路径不进入数据库或浏览器响应。

任务成功导入后，选中项转为正式 `Asset` 并形成 `AssetCollection`；任务项不是资产身份。未选项根据用户选择删除或移动至下载归档。
