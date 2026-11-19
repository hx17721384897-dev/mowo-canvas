# 资产接口

当前接口仅供本机 MOWO Canvas 页面调用，不是公开 API。所有接口使用 Node.js 运行时，文件路径不会返回浏览器。

## 查询项目资产

- 方法：`GET /api/projects/:id/assets`
- 成功：`200 { assets: AssetSummary[], sequences: AssetSequence[], sourceView }`。序列项包含 `id`、`name` 和按位置排序的 `frames`。图片摘要可附带 `animated`。`sourceView` 包含当前项目的手动文件夹、素材位置、下载批次、序列集合、派生输入输出、视频片段、来源字段及入库事件；平铺视图可忽略该字段。旧版下载批次若未保存项目 ID，按来源链接匹配最近的历史下载任务，并只返回当前项目拥有的成员。
- 数据范围：指定本地项目已经关联且未进入回收站的资产。
- 缓存：不缓存。
- 下载视频摘要使用稳定资产 `previewUrl`，可包含独立 `coverUrl` 和保留原片的 `originalUrl`；封面只在缓存存在时返回。图片摘要与本地上传视频保持原协议。

## 本地导入图片

- 方法：`POST /api/projects/:id/assets`
- 请求：`multipart/form-data`，字段 `files` 可以重复。
- 第一版格式：PNG、JPEG、WebP、GIF。
- 限制：单张 50MB，单批 500 张。
- 成功：`201 { assets: AssetSummary[], importedIds: string[] }`
- 失败：`400 { error: string }`
- 幂等性：按文件内容指纹去重；重复导入复用资产和物理文件。

## 查询历史项目

- 方法：`GET /api/projects?exclude=:projectId`
- 成功：`200 { projects: AssetProjectSummary[] }`
- 用途：历史画布选择器。

## 引用历史资产

- 方法：`POST /api/projects/:id/assets/reference`
- 请求：`{ assetIds: string[] }`
- 成功：`200 { assets: AssetSummary[] }`
- 失败：`400 { error: string }`
- 幂等性：`projectId + assetId` 唯一，重复引用不会新增记录或复制文件。

## 读取资产内容

- 方法：`GET /api/assets/:id/content`，支持 `?download=1` 以原始文件名作为附件下载；未带参数时保持内联播放/预览。`HEAD` 同样返回对应的附件或内联响应头。
- 成功：`200` 原始文件流；单段 `Range: bytes=...` 返回 `206`、`Content-Range` 与 `Content-Length`，非法或越界范围返回 `416`。支持 `HEAD` 查询大小，视频支持拖动播放进度。
- 失败：`404`。
- 安全：服务端验证资产存在且路径位于数据根目录内；响应使用 `nosniff`。

## 导出已保存视频片段

- 方法：`GET /api/projects/:id/video-clips/:clipId/export`，由画布片段卡片调用，无请求体。
- 成功：`200 video/mp4` 附件下载，文件名为片段名加 `.mp4`；从项目拥有的原片按已保存的 `[startFrame, endFrame)` 渲染，视频帧数与片段一致。生成临时文件并在发送后删除，不创建正式资产或草稿；重复请求生成等价片段。
- 错误：片段或原片不存在返回 `404`，存储的片段范围无效返回 `409`，转码器缺失或渲染失败返回 `500`。接口不返回文件系统路径；失败时清理本次临时文件。
- 范围：只读取指定项目的片段记录及其未删除的来源资产；原片不改动。片段导出需要本地视频运行时的 FFmpeg。

## 视频预览与封面

- `GET/HEAD /api/assets/:id/preview`：优先读取已验证兼容预览缓存，否则在原片符合兼容条件时流式读取原片。支持 Range 206/416，不一次性读整片；本机同源请求，不缓存失败响应。
- `GET/HEAD /api/assets/:id/cover`：读取独立 JPEG 封面，不把视频 URL 当图片。没有封面返回 404，由界面回退占位或首帧。
- 不兼容且预览不存在时返回 409 `PREVIEW_FAILED`，原片仍通过 content 读取。预览重试由对应视频任务 POST 操作触发，GET 不隐式启动转码；浏览器播放失败可在预览就绪后重新加载。
- 正式原片、按内容哈希保存的缓存与任务临时文件独立；删除任务临时文件不应影响资产读取。确认入库、来源和幂等规则见[视频下载接口](video-downloads.md)。
# 图片裁切生成

`POST /api/projects/[id]/assets` 的 `multipart/form-data` 可提交多个 `files`（PNG）和 `cropSourceAssetIds`（与文件一一对应的资产 ID JSON 数组）。接口验证所有来源属于当前项目，返回资产列表及 `importedIds`，按提交顺序关联画布裁切结果。旧的单一 `cropSourceAssetId` 字段仍受支持。

每张正式裁切结果与对应源资产分别写入派生关系；来源和结果内容相同、复用同一资产 ID 时不建立自指关系。

## 资产栏手动文件夹

- `GET /api/projects/:id/asset-folders`：返回当前项目文件夹及素材位置。
- `POST /api/projects/:id/asset-folders`：提交 `{ name, sourceCategory: "download" | "import" }`，名称 1–80 字；返回新文件夹。
- `PATCH /api/projects/:id/asset-folders/:folderId`：提交 `{ name }` 改名。
- `DELETE /api/projects/:id/asset-folders/:folderId`：删除文件夹与位置关系；资产回到来源列表，资产文件不会删除。
- `PUT /api/projects/:id/asset-folders/placement`：提交 `{ assetId, folderId: string | null }`，移动当前项目的原始素材；`null` 移回来源原位。衍生素材与跨来源分类移动返回 400。
- `PATCH /api/projects/:id/asset-batches/:batchId`：提交 `{ name }` 改当前项目的下载批次显示名。

请求 JSON 无效、对象不属于项目或名称越界均返回 `400 { error }`。文件夹变更不修改源文件或派生关系；同一资产在同一项目只有一个当前手动位置。相同内容再次导入会保留新的入库事件，仍复用资产身份。

## 本地导入视频

- 方法：`POST /api/projects/:id/videos?name=<编码后的文件名>`。
- 请求：原始文件二进制 body（`application/octet-stream`），不使用 multipart，不接收客户端声明的时长。
- 范围：本机当前存在的项目；文件名最长 255 字符，拒绝路径分隔符与控制字符。首轮支持 MP4、M4V、MOV；服务端核查容器及视频轨道。
- 限制：5 分钟或 500 MiB 仅触发画布端去向提示，服务端不再据此拒绝。元数据区最多 16 MiB；实际容量受数据目录磁盘限制，单文件真实接收上限待大文件验证。
- 成功：`201 { asset: AssetSummary }`，元数据包含尺寸、秒数时长及大小。
- 错误：`400 { error, code? }` 文件或格式无效；`404` 项目不存在；`507 { code: INSUFFICIENT_STORAGE }` 预判磁盘空间不足。接收中止或失败只清理临时文件，不创建正式资产。
- 幂等性：按 SHA-256 复用资产与项目关联；重复上传不会创建重复资产，但画布允许多个引用。
- 清理：失败或取消的上传临时文件清理；响应不返回磁盘路径。关闭页面后的未完成请求不视为成功导入。
- 验证：`src/features/assets/server/video-import.test.ts` 覆盖容器元数据、阈值边界与字节范围；真实导入与浏览器交互使用隔离数据目录验收。

## 视频观察页源帧接口

- `POST /api/projects/:id/video-editor/:assetId/index`：校验视频属于项目；已有完整索引时返回 `ready`，否则启动本机后台索引并返回 `202 { status: "running" }`。重复请求不会在同一进程中并发索引同一内容。
- `GET /api/projects/:id/video-editor/:assetId/index`：返回 `pending | running | ready | failed` 及就绪时的 `metadata.frameCount`、时间基与首末 PTS。`GET .../index?at=<秒>` 返回该时间对应的源帧号与 PTS；`GET .../index?frame=<边界序号>` 返回指定帧边界时间，终点可等于总帧数。 `GET .../index?timeline=1` 返回 `{ times: number[] }`（按源显示帧序排列的实际秒时间戳），供拖动预览使用；须验证项目归属、原片身份和完整索引，未就绪返回 404。
- `GET /api/projects/:id/video-editor/:assetId/frames/:ordinal`：索引就绪后按源显示帧序号从原片解码 JPEG；返回 `X-Source-Frame`、`X-Source-Pts` 和 `X-Source-Time`。解码器校验画面 PTS，失配时拒绝返回错误画面。项目不拥有资产、索引未就绪或越界时返回 404。
- `GET/POST /api/projects/:id/video-editor/:assetId/preview-state`：查看或启动兼容预览生成。浏览器可直接播放原片时返回 `ready`；不兼容时后台生成可重建缓存，失败保留原片并允许重试。
- `GET/POST /api/projects/:id/video-editor/:assetId/clips`：列出原片的项目片段，或按 `{ intentId, startFrame, endFrame, name? }` 保存正式片段。帧区间为半开 `[startFrame,endFrame)`；必须有完整索引，`intentId` 重复提交只产生一个片段。响应含片段素材卡信息。
- `GET/PUT/DELETE /api/projects/:id/video-editor/:assetId/draft`：读取、主动保存或清除项目视频草稿。草稿允许粗选时间和可选帧边界，不进入素材库。
- 索引、帧图和兼容预览均为可重建缓存，不修改原片。正式片段有独立资产 ID，引用原片字节；保存并放入画布先提交片段，再建立画布卡片。
