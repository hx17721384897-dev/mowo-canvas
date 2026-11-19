# 视频剪辑工程接口

项目内接口：`/api/projects/{projectId}/video-editor/{sourceAssetId}/cutting-project`。仅允许当前项目已关联、未删除的原视频；不接受片段资产或客户端文件路径。

| 方法 | 用途 | 成功响应 |
| --- | --- | --- |
| `GET` | 打开编辑页时读取剪辑工程 | `200`，`{ clips, revision, updatedAt? }`；无工程时 `clips: null, revision: 0` |
| `PUT` | 保存完整的成片片段序列 | `200`，`{ clips, revision, updatedAt }` |
| `GET .../export?revision=N` | 将版本 N 的成片作为 MP4 下载，不创建素材资产 | `200`，`video/mp4` 流，附件文件名为「原名 · 成片.mp4」 |
| `POST .../output` | 生成正式成片资产并放入当前画布 | `200`，`{ asset, revision }` |

`PUT` JSON 为 `{ clips: CuttingClip[], expectedRevision: number }`，每个片段含稳定 `id`、当前 `sourceAssetId`、半开源帧范围 `inFrame/outFrame`。允许空数组；最多 1000 段，正文上限 256 KiB。片段 ID 不得重复，边界须为准确源帧索引内的整数且至少包含一帧。服务端校验原片哈希，按项目与原片的组合主键保存一条工程记录；反复保存更新该行并递增版本，不创建新的选区草稿或正式片段资产。

源资产不属于项目返回 `404`；索引未就绪、原片内容变化或版本冲突返回 `409`；输入无效返回 `400`；过大返回 `413`。失败不改写上次成功保存的工程。浏览器以 500 ms 防抖自动提交，串行等待前一次保存，失败保留页面内容并显示重试。页面刷新后读取已保存版本；本页撤销/重做历史不跨刷新保存。

实现：`src/app/api/projects/[id]/video-editor/[assetId]/cutting-project/route.ts`、`src/features/video-editor/cutting-model.ts`、`src/features/assets/server/schema.ts`、迁移 `drizzle/0013_curved_karnak.sql`。验收：`node scripts/video/verify-editor-entry.mjs --browser --cutting-step-four` 检查跨分镜/剪辑撤销重做、刷新恢复、非法范围和旧版本拒绝，以及工程与选区草稿记录数。

交付接口只读取已保存的工程版本；版本不符、工程为空、索引或源资产不可用时返回 `409`，项目或原片不属于当前项目时返回 `404`。下载在受控临时目录渲染并在流关闭后清理；保存先完成相同渲染和帧数、时长校验，再以内容哈希写入 `storage/derived/videos`、关联项目素材、按“项目＋原片＋工程版本”登记一条结果，并在画布文档中按资产 ID 防重复放置。重复 `POST` 复用同一资产和卡片。输出为原始画幅的 H.264/AAC MP4；无音轨源视频输出无音轨 MP4。失败不把未校验文件写为资产，剪辑工程与原片保持不变。实现：`server/render-composition.ts`、`server/deliver-composition.ts` 和迁移 `drizzle/0015_magenta_xorn.sql`。验收：`node scripts/video/verify-editor-entry.mjs --browser --cutting-step-five` 及带音频的重排渲染测试。
