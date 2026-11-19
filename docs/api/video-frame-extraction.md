# 视频拆帧任务与内部执行契约

状态：持久任务、HTTP 接口、共用序列草稿、画布节点与工具栏已接入；节点按动画/拍摄视频处理，超限后确认输出。

## HTTP 任务接口

settings.restore=true表示动画节奏分析（targetFps不传时自动推断），false表示拍摄视频源帧处理。节点连接仅读现有资产元数据；点击生成才POST extract，settings.deferOutput=true。输出超限或目标帧率不足时返回来源status=analyzed和analysis.issue，不创建该来源PNG/草稿；数量合规则直接生成。该设置可选，旧调用仍保持原有错误行为。settings.truncate=true只用于用户明确选择「仅输出前150帧」，应用在间隔筛选之后；estimatedFrameCount仍是截断前数量，实际frames最多150项，durationMs为实际覆盖时长。

- `POST /api/projects/{projectId}/video-frame-jobs`：接收 `{ requestId, nodeId, mode: "analyze"|"extract", settings?, inputs: [{ assetId, settings? }] }`，返回 `202 {job}`。requestId 必须是客户端在一次操作开始时生成并保留的 UUID；网络重试/重复点击沿用它。每批 1–50 个不同视频，逐项设置覆盖默认设置。服务端验证所有输入属于当前项目且是视频，不接受路径。
- `GET /api/projects/{projectId}/video-frame-jobs?nodeId=...`：返回最近最多 100 项任务，支持按节点恢复。
- `GET /api/projects/{projectId}/video-frame-jobs/{jobId}`：返回 `{job}`，包含每来源参数、状态、阶段、进度、分析摘要、错误和已生成 sourceId，以及共用 resultTaskId。不返回执行身份、内部路径或差异度量全文。
- `PATCH /api/projects/{projectId}/video-frame-jobs/{jobId}`：`{action:"cancel"}` 或 `{action:"retry"}`。取消运行中的任务先返回 cancelling，执行进程确认停止和清理后为 cancelled；排队任务直接取消。重试复用原任务，仅重置未成功来源，保留已完成来源和同一个共用草稿。
- 同一PATCH支持`{action:"confirm", inputs:[{assetId, settings}]}`，仅更新原extract任务中analyzed且analysis.issue非空的来源并重新排队。常用于确认目标帧率、截前150张、确认间隔选取。不得修改已发布来源；相同参数的重复确认返回原状态，重放不会再排队已发布项。多来源可继续同一resultTaskId，不另建批次。输入受原有归属、数量、设置结构及节点忙校验约束。

请求仅允许本机同源，JSON 请求体最多 16 KiB。未知字段/非法参数返回 400，跨项目任务返回 404。同项目同 requestId 与相同规范化参数只返回原任务；参数不同返回 `409 REQUEST_CONFLICT`。同一节点已有排队/执行/取消中的任务时，新请求返回 `409 NODE_BUSY`。明确重跑使用新 requestId，保留旧结果；不能用旧 requestId 偷换参数。

job 状态为 queued/running/cancelling/ready/partial/failed/cancelled。来源状态为 pending/running/analyzed/ready/failed/cancelled。job=ready表示这一轮执行结束，来源analyzed且analysis.issue非空仍待用户确认，不代表已输出。mode=analyze不创建共用草稿；extract在第一个来源成功时才创建共用任务并逐来源原子发布，其余失败/待确认不会破坏已完成结果。

阶段 4 的分析摘要补充可选 sourceFrameCount 和 sourceFps（按实际处理时长计算的平均帧率），兼容此前已保存的摘要。节点配置作为 videoFrameConfig 随画布保存：settings 为默认参数，overrides 按资产 ID 覆盖，excluded 保存未选来源；服务端画布写入校验该结构。客户端发送前持久保存请求编号，响应未确认时恢复同一请求，结果批次按 taskId 复用。

ready 结果仍通过现有 `/api/frame-extraction/tasks/{resultTaskId}`、草稿编辑、帧读取、save、stitch 接口访问。common source 增加 sourceKind、parameters，frame 增加可选 sourceMapping；旧动图默认为 animated。重复保存由同进程合并及事务内 collectionId 复查保护，返回同一集合。PNG 内容去重不合并帧位。

## 调度、重启与来源保存

复用 `scripts/video/service.ts`，无新常驻服务。下载/兼容预览和视频拆帧在该执行进程顺序调度；服务通过 SQLite 轮询领取任务，进度写回 SQLite，关闭页面不会取消。原片没有索引时，在本次执行临时目录使用 PyAV 原生创建现有格式索引，再原子发布到共享缓存；没有额外 ffprobe 子进程，取消不会遗留索引子进程。索引阶段进度未知时 total=0。

每次领取生成新的内部 executionId，进度和结果提交均检查该身份及运行状态，旧执行不能向新重试写入。监护进程收束上次进程树后，启动将未完成运行标记为中断失败或部分完成，排队项继续等待；不自动重做已完成来源。清理执行临时目录及本任务下无数据库来源记录的未提交子目录，保留正式共用草稿。项目存在 queued/running/cancelling 视频拆帧任务时禁止删除。

每个成功来源保存参数快照、原片哈希、源帧范围、PTS/时间基、算法版本和每帧映射。写入共用整数毫秒字段时按累计边界取整，保持总时长。正式保存及直接拼接的派生记录保留这些来源信息。文件同盘移动到共用草稿目录后，在事务内一次性建立来源、帧位和任务关联；事务失败删除本次文件，重启清理未提交残留。

## 输入与归属

`resolveVideoFrameSource(db, root, projectId, assetId)` 为 Next 和执行进程共用的项目归属、廉价范围检查与路径解析。`resolveVideoFrameInput(projectId, assetId)` 仍提供已有索引就绪的读取接口，未就绪返回 `SOURCE_INDEX_REQUIRED`；异步执行器会先建立索引。源文件 realpath 必须仍在数据根内。

`runVideoFrames(input, settings, { tempRoot, extract, signal, onProgress? })`：settings包含restore、可选targetFps（1–120）、every、keep（整数且1≤keep≤every≤1000000）、可选truncate及deferOutput。extract=false只分析和规划；true且无issue才写PNG。deferOutput=true允许在extract模式返回待确认摘要。仅对全幅画面做连续保持识别，不保证恢复原作者的手绘节奏。

Python CLI为`frame_sequence.py --source --index --parent --start --end [--restore] [--target-fps] --every --keep [--extract] [--truncate] [--defer-output]`，使用当前捆绑Python/PyAV/NumPy，不访问网络或预览文件。缺少依赖报告`RUNTIME_PACKAGES_REQUIRED`。

## 进度与结果

stdout NDJSON 事件：`progress {stage: preparing|analyzing|extracting, completed, total}`、`ready {directory}` 或 `failed {code}`。完整结果保存在本次独立目录 manifest.json，TypeScript 使用 Zod 验证并检查目录位于调用方临时根内。stderr 仅排空，不返回本机路径。

manifest 包含版本、sourceContentHash、尺寸、源帧半开范围、源起止 PTS/时间基、处理大小、时长、参数、建议/原因、estimatedFrameCount、issue、取整误差、保持段、差异度量和输出帧列表。

每帧包含独立 position、代表图 sourcePosition、对应保持段 sourceStartFrame/sourceEndFrame、sourcePts、编辑时间 timelineStartMs、durationMs，以及提取时的安全 PNG 文件名。所有帧位独立，即使 file 相同。浮点毫秒表达精确时长，阶段 3 入整数毫秒字段时必须按累计边界取整，不能逐帧取整造成漂移。相似度阈值与算法版本保存在实现/设计书，不由客户端任意注入。

正常但不可开始的分析结果：`TARGET_FPS_REQUIRED`、`OUTPUT_LIMIT`、`TARGET_FPS_TOO_LOW`。超限保留预计数量，不返回被截断的前 150 帧。提取模式遇到以上状态直接失败。

## 资源与清理

原片实际文件最多 200 MiB；短片段只封装所选视频帧，按视频轨 CRF18/yuv444p 受限准备文件的实际大小判断（不含音轨），正式 PNG 仍直接读取原片。prepare、analyze、extract 均按原片 PTS 校验。片段准备文件随后删除，不进入素材库。

限额：60 秒、150 输出帧、7200 源帧、单帧 4096×2160 像素量、总源像素 40 亿、PNG 总量 512 MiB、磁盘保留 512 MiB、工作进程 600 秒。来源尺寸变化、重复/逆序/缺失 PTS 明确拒绝，不猜测帧映射。索引与文件大小/mtime 不符拒绝，处理结束再次校验源文件未改变。

失败/取消删除本次独立目录，不覆盖已有结果。TypeScript AbortSignal 终止子进程，并等子进程关闭后清理父目录；成功返回 dispose，调用方完成草稿转存后必须调用。并发调用各有独立目录；持久任务通过执行身份和立即事务保证幂等。

主要执行错误：`SIZE_LIMIT`、`DURATION_LIMIT`、`PIXEL_LIMIT`、`SOURCE_FRAME_LIMIT`、`OUTPUT_SIZE_LIMIT`、`DISK_SPACE`、`CANCELLED`、`TIMEOUT`、`STALE_INDEX`、`SOURCE_CHANGED`、`INVALID_TIMESTAMPS`、`DECODE_PTS_MISMATCH`、`INCOMPLETE_DECODE`。

## 验证入口

`npm run test:video-frames` 验证纯参数规则、合成实际编码视频和真实 Node/Python 进程协议；`node --no-warnings --experimental-strip-types scripts/video/verify-frame-sequence.ts <视频路径>` 只读原素材，在隔离目录验证帧索引、抽帧、手动还原及 PNG 输出，最后清理。

专项入口另包含任务存储和真实执行器测试。HTTP 闭环：设置 `MOWO_NEXT_DIST_DIR=.next-video-frame-jobs-test` 后运行生产构建，再执行 `node scripts/video/verify-frame-jobs-http.mjs`。验证脚本在隔离临时数据根启动现有受监护应用，检查分析不建草稿、重复创建、共用编辑/拼接、并发保存、GIF 兼容和重启后无重复记录，结束收束进程并清理数据。受限环境可能需允许本机回环和构建目录访问。

`node scripts/video/verify-frame-jobs-http.mjs --browser --dev`使用隔离开发应用和Chrome，验证连接不分析、两类处理、目标帧率确认、超限抽帧/前150张/裁剪入口和重复点击/恢复/刷新去重。开发模式跳过服务重启，生产入口仍保留该回归。
