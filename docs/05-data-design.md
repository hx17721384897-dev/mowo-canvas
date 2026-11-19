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

节点快捷工具偏好以 `mowo:quick-actions:v1:{节点类型}` 保存在本机浏览器，记录版本、toolbar/more 操作编号顺序与 showLabels 逐项文字开关。偏好按类型同步，不进入画布撤销或资产数据。读取时移除未知及重复操作，并补入新增操作。普通组旧的 `data.quickActionLayout` 继续兼容读取，作为首次迁移来源，本机已保存偏好优先。当前画布多组旧配置不同时采用首先渲染的已配置组。全画布内容缩放开关仍保存在文档顶层。

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

图片裁切结果卡片在画布文档中保存 `cropPlan`，包含来源资产、原图尺寸、网格、逐张裁切矩形、位移、缩放、输出规格及有序意图。草稿预览不创建文件。正式生成时每张 PNG 写入资产库，`sourceType=image-crop`、`sourceUrl=asset:<来源资产 ID>`；有序结果另建序列记录与画布有序组。对已有有序组裁切时，每张结果分别记录对应成员资产为来源。更新草稿不覆盖已生成资产。
- “序列帧文件夹”是界面上的集合表现，不要求磁盘上创建同名目录。
- 原始文件、派生文件和缩略图缓存严格分开；拼接只读取正式派生文件，不读取缩略图。
- 如果内容哈希已经存在，允许复用物理资产文件，但必须新增集合位置和派生关系。
- 组导出 ZIP 只读取当前项目已关联的原始图片、视频或派生图片，按组结构生成可读文件名，不改变内部存储路径或资产身份；单次最多 1000 个文件、2 GB。

### 动图拆帧草稿与提交

视频拆帧复用以下任务、来源、帧与正式集合结构。迁移 `0014_fresh_spencer_smythe` 新增 `video_frame_jobs` 保存请求幂等、输入状态、执行身份及结果任务关联；分析任务不建帧草稿。来源增加默认 animated 的 source_kind 和参数快照，帧增加可空源映射，旧动图记录兼容。具体任务与发布规则见[视频拆帧接口](api/video-frame-extraction.md)。

拆帧任务采用“临时草稿 → 用户编辑 → 正式提交”两阶段流程。候选帧先写入：

```text
MOWO Canvas Data/
└── temp/frame-extraction/<任务ID>/<来源资产ID>/<帧序号>.png
```

草稿清单记录来源帧序号、顺序、时间位置、停留时间、是否保留和任务状态，但候选帧尚不是正式 `Asset`。用户从序列移除帧只修改草稿清单，可撤销；原始动图始终保持不变。虽然现有磁盘路径包含 `temp`，有任务记录的帧文件属于受保护的项目草稿，不按目录名或创建时间自动删除。

用户点击“保存序列（N帧）”后，系统只对保留候选帧计算哈希，并写入或复用 `storage/derived/images/<哈希前缀>/<内容哈希>.png`，随后建立正式 `AssetCollection`、成员位置和派生关系。未保留候选帧不进入长期项目资产，提交成功后清理。未提交的序列草稿和编辑记录随项目保留，关闭页面或经过 24 小时不会清理。自动清理仅处理数据库里没有任务记录、且目录已闲置超过 24 小时的解码残留。旧数据库的 `expires_at` 字段留作兼容，不再判定草稿有效性。

如果 12 帧由相同 4 帧循环三次组成，内容寻址存储可能只产生 4 个物理文件，但集合仍可保存 12 个独立位置。删至 4 帧后，最终集合只保存 4 个成员位置。为此，实现拆帧前必须把当前 `asset_collection_items` 的“集合 + 资产”主键迁移为独立成员 ID，并保持“集合 + 位置”唯一。

该决策的原因记录在 [派生图片采用内容寻址存储](decisions/0005-content-addressed-derived-assets.md)。

### ProjectAsset

- `projectId`
- `assetId`
- `addedAt`

`projectId + assetId` 必须唯一。项目通过关联记录使用全局资产；从历史画布添加资产时只新增关联记录，避免把同一物理文件复制到多个项目。

资产栏按来源视图的手动文件夹使用项目级 `asset_folders` 和 `asset_folder_items`；同一项目的资产只可有一个当前手动位置。`asset_intakes` 记录每次图片入库的原始名称、来源及时间，即使内容哈希复用同一资产 ID 也追加事件。下载批次继续使用 `asset_collections`，新批次关联当前项目。正式裁切按每张输出写入对应输入资产的派生关系；来源图与输出内容完全相同时跳过自指关系。文件夹只是浏览视图，不移动原始或派生文件。

## 文件去重原则

- 图片和视频导入临时区后计算内容指纹。
- 已存在相同内容指纹时复用原文件和资产身份，只增加项目关联。
- 原始文件名、来源和导入时间保存在结构化数据中，不依赖物理文件名表达业务含义。
- 缩略图和视频封面属于可重建缓存，不作为原始资产。

## 画布文档基线

```ts
type CanvasDocument = {
  schemaVersion: number;
  groupContentScaleEnabled?: boolean;
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
- 同一编辑器一次只发送一份快照。请求完成后比较当前内容与服务端最后确认的快照，有差异时发送最新内容。手动保存与返回首页等待当前内容确认。返回首页遇到失败时保留编辑器，提供继续编辑、重试和明确离开的选择。
- 编辑期间持续写入按项目隔离的浏览器草稿。关闭页面依靠草稿恢复；重新打开先比较服务器版和草稿，用户载入后可手动提交。浏览器存储不可用时在顶部提示。
- 界面显示“未保存、保存中、已保存、保存失败”。
- 当前本地单用户版本采用整份文档覆盖；未来支持多窗口或多人并发编辑时增加 `revision` 检测旧数据覆盖。
- 导入前验证 `schemaVersion` 与数据结构。

当前使用 Drizzle ORM 管理 SQLite。迁移包含项目与画布、资产与集合、派生关系、下载任务和动图拆帧草稿表；迁移文件受 Git 管理，实际数据库不进入仓库。`canvas_documents` 按项目保存版本、节点、连线和视口 JSON。`deletedAt` 已为回收站预留，但删除与自动清理流程尚未开放。

### DownloadTask 与 DownloadItem

下载任务持久化平台、来源链接、项目、状态、进度、总数、用户安全错误与时间。下载项保存任务内顺序、临时相对路径、MIME、大小与动画标记。临时绝对路径不进入数据库或浏览器响应。

任务成功导入后，选中项转为正式 `Asset` 并形成 `AssetCollection`；任务项不是资产身份。未选项根据用户选择删除或移动至下载归档。

### 本地视频原片

B 站下载另用 `video_download_tasks` 保存项目来源、BV/P、格式、主状态、独立预览状态、当前执行标识、进度、临时相对路径及 assetId。该表与 LINE 下载任务隔离；状态与恢复规则见[视频任务接口](api/video-downloads.md)。校验完成为 ready，用户确认后以事务关联正式资产并标记 completed。项目删除须在事务中阻断视频和 LINE 活动或待处理任务。

`assets.video_metadata_json` 可选保存下载原片的媒体摘要，0007 迁移只增加可空列；复用 Asset/ProjectAsset 和统一内容哈希，不新增资产身份表或导入日志。下载确认采用流式复制、哈希、重新校验与原子发布，临时原片在提交失败时仍可重试。任务缓存位于 `cache/video-downloads`，已入库预览和封面按原片哈希发布到 `cache/video-assets`；正式资产读取不依赖下载临时路径。下载长片可先入库，再按画布提示选择去向。

本地视频以流式临时文件接收，计算 SHA-256 后进入 `storage/originals/videos/<哈希前缀>/<内容哈希>.<扩展名>`，复用已有 Asset 与 ProjectAsset 模型。记录实际字节数、像素尺寸和秒数时长；节点只保存资产 ID、内容 URL 和信息摘要。视频读取支持 Range，不为播放一次性读取整个原片。5 分钟/500 MiB 只触发去向提示，不再阻止入库。源帧索引位于可重建缓存 `cache/video-editor`，以源资产哈希关联，独立于正式原片。`video_clips` 为每个正式片段记录项目、源资产、不可变半开帧边界、PTS、时间基和序号；同一 ID 也作为素材库中的视频资产身份，但引用原片文件而不复制字节。`video_clip_drafts` 只保存用户主动提交的编辑草稿，不进入素材库。对应迁移为 0008、0009。

`video_cutting_projects` 按项目和原视频唯一保存成片序列 JSON、原片内容哈希、版本号与时间；迁移为 0013。编辑页自动保存成功后更新同一行，失败保留上一版本；该记录与用户主动保存的单片段选区草稿相互独立，不产生重复草稿，也不创建正式片段资产。接口规则见[视频剪辑工程](api/video-editor-cutting.md)。

成片导出在临时目录渲染、校验后流式下载，不创建资产。用户选择「保存到素材库并放入画布」时，校验后的 MP4 按内容哈希存放在 `storage/derived/videos`，建立或复用正式视频资产和项目关联；`video_cutting_outputs` 以项目、原片和工程版本唯一定位输出，迁移为 0015。重复保存复用资产，画布按资产 ID 避免重复卡片。剪辑工程、原片、分镜结果和单片段选区草稿均不被成片交付改写。
