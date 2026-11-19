# 视频下载任务接口

普通 `npm run dev` / 构建后 `npm run start` 已统一启动受控 Next 与单执行者，原 video 后缀命令保留兼容。创建保存 queued，由执行者处理；GET 只读，不启动下载。首次准备环境使用 `npm run video:setup`；引擎内部协议见 [video-engine.md](video-engine.md)。

## 范围与输入

接口仅接受本机 loopback Host；存在 Origin 时必须同源，cross-site 请求拒绝。所有响应 no-store，任务必须属于路径指定项目。没有账户或云端权限模型。

| 方法 | 路径 | 行为与响应 |
|---|---|---|
| GET | `/api/projects/{id}/video-downloads` | `{tasks: VideoTaskSummary[]}`，最新 100 条 |
| POST | 同上 | 创建记录，201 `{task}` |
| GET | `/api/projects/{id}/video-downloads/{taskId}` | 200 `{task}` |
| DELETE | 同上 | 取消任务，运行中先等待受控进程结束，200 `{task}`；不删除文件 |
| POST | `/api/projects/{id}/video-downloads/{taskId}/retry` | 200 `{task}`，重新排队 |
| POST | `/api/projects/{id}/video-downloads/{taskId}/discard` | 明确放弃 ready 结果，200 `{task}`，取消记录但暂不清理文件 |
| POST | `/api/projects/{id}/video-downloads/{taskId}/import` | 确认入库，200 `{task, assetId, asset}`；重复确认返回同一资产 |
| POST | `/api/projects/{id}/video-downloads/{taskId}/preview` | 生成/重试兼容预览，200 `{task}`；只接收路径指定任务 |
| POST | `/api/projects/{id}/video-downloads/{taskId}/cleanup` | 清理允许状态的临时目录，200 `{task,cleanedDirectories}`；重复清理返回 0 |
| GET/HEAD | `/api/projects/{id}/video-downloads/{taskId}/content?kind=source/preview/cover` | 当前项目 ready/completed 内容流；视频支持 Range 206/416 |
| GET | `/api/video-downloads/storage` | 剩余字节数、固定预留、是否正在处理及 Python/yt-dlp/FFmpeg 版本；不返回目录或内部请求密钥 |
| POST | `/api/projects/{id}/video-downloads/resolve` | `{url}` → 200 `{video: ResolvedVideo}` |
| POST | `/api/video-downloads/auth` | `{action: status/generate/poll/logout}` → 200 登录状态；generate 另返回 PNG base64 `image` |

创建 JSON 最大 16 KiB，实际流长度也受限制：

```json
{"resolveId":"本次解析返回的 UUID","choiceId":"本次解析返回的画质选项 ID"}
```

解析 `url` 最长 2000 字符，接受 BV 号、HTTPS 的 bilibili.com/www.bilibili.com 普通视频链接，或 https://b23.tv/字母数字 短链。单 P 为 1—10000 整数，默认 1；保存时移除追踪参数。短链只请求固定 b23.tv 主机，单次跳转目标验证为普通视频链接后才允许继续；拒绝任意跳转链或内网目标。

解析返回安全来源、BV/CID/P、标题、时长、可信 hdslb HTTPS 封面、分 P 列表和真实格式选项。兼容性优先选择最高 H.264 与 AAC 音频，无音轨则保留无声。没有直接媒体 URL/请求头。解析会话保留 10 分钟、最多 20 条，限定当前项目；退出/成功登录清除旧会话，创建时重验选项，执行时重新解析格式，不静默替换画质。服务重启后需重新解析。存储层格式输入仅供受信任的服务调用，不再接受浏览器任意传格式 ID。

登录状态为 anonymous/loggedIn/waiting/scanned/expired/success。二维码 key 只保留执行者内存，接口不返回 Cookie、二维码 key 或账号标识。auth 操作串行，进行中返回 TASK_BUSY。凭据以当前 Windows 用户 DPAPI 加密保存到数据根目录 `credentials/bilibili.dpapi`；默认根目录首次启动可复制旧验证凭据密文，并记录一次性迁移标记，退出后不会因旧文件存在而重新登录。

类型定义见 `src/features/video-downloads/types.ts`。摘要包括来源 BV/P、标题、格式、状态、字节进度、预览状态、重试次数、媒体元数据、assetId、固定错误码/提示、时间与本机 originalUrl/previewUrl/coverUrl；不返回内部执行标识、文件路径、凭据、媒体签名 URL 或内部异常。预览不可用时 previewUrl 为 null，封面读取失败可回退占位。

## 状态、并发与重试

主状态：queued → downloading → merging（可选）→ verifying → ready → completed。importing 保留在状态枚举中；C 在文件准备阶段保持 ready，由请求等待和界面“正在入库”表达进行中，最终事务一次提交 completed/assetId。失败、取消和中断分别为 failed/cancelled/interrupted；预览状态独立。

创建每次产生新任务。failed/interrupted/cancelled 可重试；queued 重试幂等，其他状态返回 409。已取消记录重复取消幂等。运行中取消会 Abort 并等待受控进程树结束，再提交取消状态；ready 原片需明确导入或通过 discard 放弃，不通过 DELETE 直接丢弃。当前字节进度属于正在下载的音视频流，切换到下一条流可以重新计数，不等于整个任务已完成。

存储层通过短 SQLite 事务保证全局只有一个任务或预览进入执行状态，并为每次执行产生新标识；旧执行消息被忽略。没有 SQL 租约、完整 attempt 表或导入日志。引擎 done 只表示进程协议结束，不能把任务标为入库成功。

## 确认入库与预览

入库只接受 ready 或已 completed 的同项目任务，浏览器不能指定文件。独立执行者流式复制与计算 SHA-256，对暂存副本重新 ffprobe 校验，核查音轨、尺寸和时长与既有结果一致；同卷原子发布防止覆盖已有原片。已存在目标先核对实际哈希和大小再复用。原始临时文件保留到正式提交后，本阶段不自动清理。

事务内创建/复用 Asset、ProjectAsset，并更新任务 assetId/completed/正式相对路径。进程内同任务并发请求共享入库操作，事务仍会重新校验状态；重复点击返回同一资产。不同来源或项目的相同内容共用资产与物理原片，来源任务分别保留 BV/CID/P/格式；资产保留首个基础来源。回收站或类型冲突明确拒绝。失败保持 ready 原片供重试；文件已发布但事务未提交时，后续重试重新核对哈希复用，不把存在文件当成已入库。

下载入库不套用本地上传当前的 5 分钟/500 MiB 上限。已入库大视频从素材库放到画布时提供进入编辑（待开放）或仍放画布，不再次保存原片；本地上传接口的上限本轮不改。

不兼容原片自动排队生成 H.264/AAC 兼容预览，必要时可手动生成、重试或停止。生成、失败或停止不阻止原片入库，也不把主状态改为下载失败。HDR 返回 HDR_PREVIEW_UNSUPPORTED，界面不提供无效重试承诺。预览活动期间入库保留当前预览执行标识，完成后同步资产缓存。

封面及预览先写 `cache/video-downloads/{taskId}`，入库后复制发布到按原片哈希定位的 `cache/video-assets/{hash}`；它们不代替原片。`assets.video_metadata_json` 保存已验证媒体摘要，使资产脱离任务临时路径后仍可判断原片播放能力。素材库使用独立封面 URL 和稳定资产预览 URL，画布保存资产 ID/预览 URL，不持有下载临时地址。临时原片移除不影响正式原片和资产预览。

执行者由统一启动器放入已有 OS 锁与 Job Object 守护链，取得锁并结束旧树后进行启动恢复：queued 及执行中记录转为 interrupted，等用户重试；ready 原片保留，生成中的预览标为失败。GET 和 Next 模块初始化均不触发恢复。downloaded/probed 等成功结果在受控进程结束后提交，避免提前释放执行槽。Next 通过数据根目录的内部 loopback 端口描述文件连接执行者，使用随机请求密钥；描述文件及密钥不暴露给浏览器。

单项及批量项目删除在同一 SQLite 事务中检查视频/LINE 活动或待处理任务；批量中任一不满足就返回 409，整批保留。

## 交付运行、清理与恢复

空间检查包含固定 256 MiB 预留，加上当前阶段所需估计：创建按音视频总量与合并估计，合并前由 Python 按已下载流文件实际大小检查，预览/入库按原片大小检查；运行中继续监测。估计不构成“无限大文件必定成功”的保证，实际 ENOSPC 也映射为 DISK_FULL，并保留安全来源。

清理只允许 failed/cancelled/completed，拒绝排队、运行、ready 唯一原片、活动预览或同任务入库。清理期间暂停领取和该任务的新操作。completed 先核对正式原片的实际哈希/大小并发布独立资产缓存；只删除服务构造的 `temp/video-downloads/{id}` 和 `cache/video-downloads/{id}`，不使用客户端路径或递归删除任务 relativePath。删除前验证两个绝对目标均在数据根目录内，拒绝符号链接/联接。正式 storage、资产 cache、记录及关联均保留，已入库摘要始终使用稳定资产 URL。

启动先收束旧进程，再标记未结束任务中断，检查 ready/completed 文件存在性。恢复后缺少临时原片的 ready 变 failed/FILE_MISSING，允许重新下载；正式原片缺失仍保留 completed/assetId，提示 ASSET_FILE_MISSING 和恢复备份，不能据此删除仅存临时来源。缺少预览标为可重试失败，不假报缓存有效。

弹窗提供存储与备份说明及实际剩余空间。备份应先导入要保留的原片、停止处理并退出所有应用实例，复制 `database/`、`storage/` 与 `data-version.json`；不把临时目录当正式素材。`cache/` 可重建，凭据不随素材分享。没有新增在线备份屏障、自动备份或恢复日志。

## 错误与验证

错误为 `{code,error}`，提示固定且不会输出原始异常。

| 状态码 | code |
|---|---|
| 400 | INVALID_INPUT、INVALID_JSON、INVALID_EVENT |
| 403 | LOCAL_ONLY |
| 404 | PROJECT_NOT_FOUND、TASK_NOT_FOUND |
| 409 | TASK_BUSY、INVALID_STATE、RESOLVE_EXPIRED、DISK_FULL、FILE_MISSING、ASSET_FILE_MISSING、MEDIA_CHANGED、ASSET_UNAVAILABLE、PREVIEW_FAILED、CLEANUP_FAILED |
| 413 | BODY_TOO_LARGE |
| 500 | INTERNAL_ERROR、IMPORT_FAILED |
| 502 | AUTH_FAILED、RESOLVE_FAILED |
| 503 | SERVICE_UNAVAILABLE |

处理失败信息写入摘要，不通过进程输出直接构造 HTTP 错误。预览失败保留 ready 原片，不能误报下载失败。

`npm run test:video` 覆盖迁移保留 LINE 数据、新连接持久读取、两连接执行互斥、旧消息隔离、状态校验、预览失败、启动中断、项目范围、请求体限制和错误脱敏。`npm run check` 包含这些测试。

生产构建后运行 `node scripts/video/verify-task-http.mjs`，使用独立数据根目录和随机本机端口检查真实路由，不写正式项目。`--live --browser --restart` 使用用户已提供样本做实际解析、下载、校验、取消/重试、弹窗关闭/重开、项目删除保护和重启中断验证；会访问 B 站，隔离环境不复制正式凭据。短链危险跳转与分 P/格式边界另由离线测试覆盖，不声称单 P 样本验证了所有真实短链和多 P 内容。

`node --no-warnings --experimental-strip-types scripts/video/verify-import.mjs --browser` 使用隔离数据库和本地生成的无声 H.264、HEVC、带 PQ 元数据样本，验证实际入库、预览、HDR 拒绝、Range/HEAD、封面、素材拖入画布和临时文件独立性；不访问平台或使用正式凭据。
