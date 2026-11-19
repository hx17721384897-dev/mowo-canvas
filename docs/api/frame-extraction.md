# 动图拆帧接口

视频任务入口见[视频拆帧执行契约](video-frame-extraction.md)。本页创建动图接口不接受视频 ID；视频任务成功后返回 resultTaskId，共用本页查询、预览、编辑、保存和拼接接口。来源新增 sourceKind（旧动图为 animated）、parameters，帧新增可选 sourceMapping。

## 用途与范围

供本地画布的“动图拆帧”和“动画帧批次”调用。接口只访问当前本地 SQLite 与 `MOWO_DATA_ROOT`，不上传素材，不提供公网兼容承诺。第一版支持 APNG、GIF；单次最多 50 个来源，单个来源最多 1000 帧。未保存的序列属于项目草稿，不按时间过期；旧响应的 `expiresAt` 仅为兼容字段，不表示当前清理期限。

## 自动检查输入

`POST /api/frame-extraction/review` 接收 `{ projectId, assetIds, taskId? }`，最多 500 项，按资产 ID 去重。响应 `{ items }`，每项返回资产 ID、名称、实际格式、分类及可选原因。检查验证项目归属并识别动画帧数，不生成草稿文件。客户端仅将勾选且可处理的素材交给创建任务接口，每次最多 50 张。

## 创建任务

`POST /api/frame-extraction/tasks`

请求：`{ projectId: string, assetIds: string[], taskId?: string }`。资产必须已关联当前项目。首次执行不传 `taskId`；同一处理节点新增输入时传原任务 ID，只拆解尚未存在的来源并追加结果。任务同步完成第一轮解码；每个来源独立成功或失败，响应 `201 { task }`。

新任务只清理无数据库任务记录、且已闲置超过 24 小时的解码残留目录。有任务记录的旧草稿即使历史 `expiresAt` 已过去，也不会在创建任务时删除或重新生成；输入审查仍把它识别为已有结果。

常见错误：`NO_INPUTS`、`TOO_MANY_INPUTS`、`UNSUPPORTED_FORMAT`、`NOT_ANIMATED`、`TOO_MANY_FRAMES`、`DECODE_FAILED`。内部路径和堆栈不返回浏览器。

## 查询任务与帧内容

- `GET /api/frame-extraction/tasks/{taskId}`：返回任务、来源组和草稿帧顺序。
- `GET /api/frame-extraction/tasks/{taskId}/frames/{frameId}`：返回一张完整合成后的 PNG 帧，`Cache-Control: private, no-store`。

## 编辑草稿

`PATCH /api/frame-extraction/tasks/{taskId}/sources/{sourceId}`

请求：`{ orderedFrameIds: string[], duration?: { frameId: string, durationMs: number } }`。时长只能修改保留列表中的一帧，范围为 1 至 3600000 毫秒；按提交的顺序重算时间线。数组同时表达最终保留成员与顺序，至少保留一帧，不接受重复或不属于该来源的帧。重复提交同一数组产生同一草稿状态。

## 保存正式序列

`POST /api/frame-extraction/tasks/{taskId}/sources/{sourceId}/save`

保留帧按 SHA-256 写入或复用 `storage/derived/images`，建立序列集合、独立集合成员、项目资产关系和派生输入/输出关系。已保存来源重复调用直接返回原集合；并发保存通过同进程请求合并和立即事务内复查 collectionId 避免重复集合。视频的处理参数和源映射进入派生记录。成功响应 `{ sequence }`。

## 保存手动有序组

`POST /api/frame-extraction/ordered-sequences`

提交 `{ projectId, groupId, name, frames: [{ assetId, durationMs }] }`，顺序即正式序列的播放顺序。接受 1 至 1000 帧，可重复引用同一张图。写入前读取文件确认每项均为静态图片，动态或无法读取的文件返回 400。服务端验证图片均属于当前项目，事务内写入集合和成员并返回 `{ collectionId }`。相同组和相同序列内容复用集合，不复制文件。参数或资产归属错误返回 400。

## 权限、并发与验证

当前为本地单用户模式，不含账户鉴权；服务端仍验证项目资产关系和任务归属。对同一草稿的并发编辑采用最后一次成功请求为准。实现位于 `src/features/frame-extraction/server/`，路由位于 `src/app/api/frame-extraction/`；APNG 合成规则有自动化回归测试，并使用真实 LINE APNG 样本做兼容验证。
## 拼接序列

`POST /api/frame-extraction/stitch` 接收 `{ projectId, taskId, sequences: [{ sourceId, frameIds, settings }] }`，最多 50 组。帧 ID 必须按当前保留顺序提交。设置包括可选列数、0–128 px 的间距和外边距，以及透明或白色背景。输出为 PNG，响应包含成功的 `outputs` 和逐组 `failures`。服务端核对项目归属与帧顺序，并将行列、单格尺寸、格坐标、帧时长及来源写入派生记录。
