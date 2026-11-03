# 动图拆帧接口

## 用途与范围

供本地画布的“动图拆帧”和“批量结果组”调用。接口只访问当前本地 SQLite 与 `MOWO_DATA_ROOT`，不上传素材，不提供公网兼容承诺。第一版支持 APNG、GIF；单次最多 50 个来源，单个来源最多 1000 帧，草稿保留 24 小时。

## 创建任务

`POST /api/frame-extraction/tasks`

请求：`{ projectId: string, assetIds: string[], taskId?: string }`。资产必须已关联当前项目。首次执行不传 `taskId`；同一处理节点新增输入时传原任务 ID，只拆解尚未存在的来源并追加结果。任务同步完成第一轮解码；每个来源独立成功或失败，响应 `201 { task }`。

常见错误：`NO_INPUTS`、`TOO_MANY_INPUTS`、`UNSUPPORTED_FORMAT`、`NOT_ANIMATED`、`TOO_MANY_FRAMES`、`DECODE_FAILED`。内部路径和堆栈不返回浏览器。

## 查询任务与帧内容

- `GET /api/frame-extraction/tasks/{taskId}`：返回任务、来源组和草稿帧顺序。
- `GET /api/frame-extraction/tasks/{taskId}/frames/{frameId}`：返回一张完整合成后的 PNG 帧，`Cache-Control: private, no-store`。

## 编辑草稿

`PATCH /api/frame-extraction/tasks/{taskId}/sources/{sourceId}`

请求：`{ orderedFrameIds: string[] }`。数组同时表达最终保留成员与顺序，至少保留一帧，不接受重复或不属于该来源的帧。重复提交同一数组产生同一草稿状态。

## 保存正式序列

`POST /api/frame-extraction/tasks/{taskId}/sources/{sourceId}/save`

保留帧按 SHA-256 写入或复用 `storage/derived/images`，建立序列集合、独立集合成员、项目资产关系和派生输入/输出关系。已保存来源重复调用直接返回原集合，不重复写文件或集合。成功响应 `{ sequence }`。

## 权限、并发与验证

当前为本地单用户模式，不含账户鉴权；服务端仍验证项目资产关系和任务归属。对同一草稿的并发编辑采用最后一次成功请求为准。实现位于 `src/features/frame-extraction/server/`，路由位于 `src/app/api/frame-extraction/`；APNG 合成规则有自动化回归测试，并使用真实 LINE APNG 样本做兼容验证。
