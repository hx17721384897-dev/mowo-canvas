# 视频编辑页分镜任务接口

当前项目内使用的内部接口。路径前缀为 `/api/projects/{projectId}/video-editor/{sourceAssetId}/shots`；`sourceAssetId` 必须是该项目已入库的原视频资产，片段资产不能作为检测源。请求体为空，不接受客户端文件路径或模型参数。

| 方法 | 用途 | 成功响应 |
| --- | --- | --- |
| `GET` | 只读取当前原片的任务、进度和切点；进入页面及轮询只使用此方法 | `200`，`ShotState` |
| `POST` | 用户点击左侧「开始分镜」或「重试分镜」时启动；相同任务已运行或已完成则返回现状 | `202`，`ShotState` |
| `DELETE` | 用户取消正在运行的检测；待进程退出后状态变为 `interrupted` | `202`，`ShotState` |
| `PATCH` | 校正模式中提交完整的有效切点帧序列 | `200`，更新后的 `ShotState` |

`ShotState.status` 为 `idle`、`waiting`、`running`、`ready`、`failed`、`interrupted` 或 `missing`。`progressFrames`、`frameCount` 是已处理帧数与源帧总数；`cuts` 是当前有效的 `{ frame, score }[]`，`frame` 指右侧镜头第一帧的源帧序号，从 0 开始，升序排列。第一个镜头隐含从 0 开始，末镜头终点隐含为 `frameCount`。`device` 在选定运行设备后为 `dml`（显卡）或 `cpu`，任务进行中与完成后均可显示。`manuallyEdited` 表示有效切点已由人工改写，`editRevision` 是校正版本号。`error` 仅为可展示的简短消息。未开始时返回 `idle`，不创建任务。

`PATCH` JSON 为 `{ "cuts": number[], "expectedRevision": number }`。必须有已完成且与当前原片一致的检测结果；数组可以为空，其他元素须严格升序，且每个元素是 `1..frameCount-1` 的整数。服务端以 `expectedRevision` 做原子版本匹配，防止两个页面互相覆盖；成功时立即持久化人工切点并把版本加一。Ctrl+Z 通过同一接口提交上一步切点快照，不另设临时草稿。输入非法、任务未就绪或版本冲突返回 `409` 与 `{ error }`，无效 JSON 返回 `400`；源资产不存在返回 `404`。自动候选与人工结果分别保存，`GET` 在任务就绪时优先返回人工结果。原片内容变化时旧结果失效，重新检测前清除旧原片的人工切点。

源资产或项目不存在、或资产不属于项目时返回 `404` 和 `missing`。写操作和读取操作都重新校验当前项目与源资产关系，不暴露本地路径。重复点击不会为同一原片创建多个有效任务；检测完成后的再次点击返回已保存结果。失败或中断后允许重新启动，重新启动清空该次自动候选；已保存的人工片段不会被修改。任务进度由后台进程持久写入 SQLite；浏览器关闭不取消任务。进程异常结束时任务可显示 `interrupted` 并由用户重试。

实现：`src/app/api/projects/[id]/video-editor/[assetId]/shots/route.ts`、`src/features/video-editor/server/shot-analysis.ts`、`scripts/video/transnet_worker.py`。验收：`node scripts/video/verify-editor-entry.mjs --shots` 检查页面打开后仍为空闲、只读轮询不启动、点击启动及重复点击复用结果；`node scripts/video/verify-shot-real.mjs <本地视频路径> --browser` 检查真实视频、浏览器按钮和镜头定位。
