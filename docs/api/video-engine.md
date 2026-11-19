# 视频实验引擎协议

状态：已实现并接入 A/B/C 的内部进程协议，不是正式 HTTP API；执行者校验当前执行标识。SQL 租约属于后续可选增强，范围以[精简设计书](../design/video-download-v01.md)为准。

Node 调用 `scripts/video/engine-client.mjs`，以固定绝对路径启动隔离 Python；标准输入一行 JSON，最多 64 KiB，包含 `v: 1`、`action` 及操作参数。Cookie 可选，仅通过该管道交接。标准输出为逐行 JSON，标准错误不进入业务返回或产品日志。

| action | 参数 | 结果事件 |
|---|---|---|
| health | 无 | health：Python 与提取器版本 |
| resolve | url，可选 cookies | resolved：视频 ID、标题、时长和安全的格式摘要 |
| download | url、formatIds（1–2 个真实格式 ID）、directory、ffmpeg，可选 cookies | stage、progress、downloaded |
| probe | ffprobe、file | probed：时长、音视频轨摘要 |
| preview | ffmpeg、ffprobe、file、target | previewed：生成后的预览媒体摘要 |
| cover | ffmpeg、file、target | covered：首帧 JPEG 已生成；不覆盖原片 |

download URL 仅接受 HTTPS 的 B 站普通 BV 链接或 BV 号，规范化时移除跟踪参数。resolve 另支持 b23.tv 单次受控跳转：验证目标为普通 BV 链接后才继续请求，拒绝任意跳转链。resolved.video 增加规范来源、BV/CID/分 P、分 P 列表与封面；downloaded 增加 requireAudio，表示所选格式是否实际要求音轨。所有本地路径由可信调用端提供，不能原样接收浏览器参数。输出格式摘要不含媒体 URL、请求头或 Cookie。

resolve/download 可由可信 Node 调用端传入 `credentialFile`，引擎在本进程解密 DPAPI 凭据并注入提取器 Cookie jar；调用端不得接受浏览器传入任意文件路径。凭据不会作为事件返回。

probe 可用 requireAudio 明确要求音轨；无声视频不默认失败。probed/previewed 的 browserCandidate 仅为 MP4/H.264/yuv420p/AAC 条件判断，并非所有浏览器的播放保证。preview 保留原文件，拒绝覆盖原文件，HDR 尚未实现色调映射时返回 hdr_preview_requires_tonemapping。

download 会在目录写入来源身份 manifest，存在未核实或身份变化的部分文件时返回 resume_unverified/resume_identity_changed。recovery 事件可为 fresh、existing（已有完整文件，仍须校验）、candidate（有可尝试的部分文件）、continued（实际非零 Range 获得匹配 206）、restarted（服务端忽略续下）。不能把 candidate 当成续下已通过。rateLimit 只供受控验证，范围 16384–10485760 字节/秒。正式服务沿用受控目录锁。

所有事件包含 `v: 1` 和 `event`；成功必须收到 `done` 且进程退出码为 0，单独收到 `downloaded` 不代表文件已校验或入库。失败发送 `failed` 与安全错误码并以 1 退出。调用端拒绝非法 JSON、未知事件、终态后继续发送的事件及超量输出；支持超时和取消。任务事件、媒体摘要与解析结果由 TypeScript 服务边界校验。

## 登录实验协议

`auth.py` 使用同一版本化单请求协议，支持 `generate/poll/status/logout`。generate 返回内部 `qr` 事件（key、PNG base64、有效期）；key 只保留在本机 Node 验证服务，不传给浏览器或输出到日志。poll 接收 key 和可信 credentialFile，返回 `qr_status`：waiting/scanned/expired/success。成功前校验会话并加密保存。status/logout 返回 `auth` 事件，只有 loggedIn/stored，不返回凭据。二维码图片由本机固定版本 qrcode 8.2 生成，不使用第三方二维码服务。

`login.mjs` 是 10 分钟生命周期的本机验证页。正式下载接口与单执行者仍待接入。

关键错误：`invalid_input`、`unsupported_url`、`invalid_part`、`format_unavailable`、`platform_rejected`、`network_timeout`、`engine_failed`。Node 另有 `video_runtime_unavailable`、`video_protocol_invalid`、`video_timeout`、`video_cancelled`、`video_engine_interrupted`。不返回异常原文，以免泄露签名 URL 或凭据。

## 受控进程协议

Windows download/preview 默认经 guardian.py 启动并持有实验执行槽及可选目录锁。managed 选项可指定统一 root、directory、heartbeatMs；心跳期限默认 5 秒。初始信封为 UTF-8 JSON，随后发送 `{v:1,heartbeat:true}` 或 `{v:1,cancel:true}`。正式单执行者必须使用统一数据根目录下的控制路径。

守护进程创建命名 Windows Job；包装进程加入后才派发工作，后代由系统一并管理。managed 事件为 running、reaping、stopped；残留旧 Job 清空后才启动新工作。done 延迟到树清空，Node Promise 还会等待守护进程退出。受控模式新增了管理事件，消费者必须按 event 查找业务结果，不能假设返回数组首项就是业务结果。

command/format=lines 仅用于受信任的应用启动实验，输出 process_log；不能把此命令能力暴露给浏览器。timeoutMs=0 用于长期运行的启动器，不设置总时限，仍执行心跳与取消。

引擎已接入首版独立任务服务，包括确认入库、封面和兼容预览。当前心跳用于检测 Node 存活，服务校验当前执行标识，并阻断活动和待处理任务的项目删除。不增加 SQL 租约和完整读租约系统。已验证的残留收束保留，证据见[生命周期验证](../design/video-process-lifecycle.md)。
