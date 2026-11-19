# 视频工作进程生命周期验证

日期：2026-11-12。普通 npm dev/start 已接统一守护入口，首版采用单执行者；SQL 租约和复杂接管不作为交付条件。

启动器先在独立守护根目录内运行 Node 视频服务，等待就绪后启动受控 Next；任一服务退出就停止另一方。普通 dev/start 与兼容的 video 后缀入口均使用此链路。执行者取得自身 Job/文件锁并清空旧树后才处理启动中断，实际下载使用同一数据根目录下的媒体执行槽和任务目录锁。

## 已实现的控制链

```text
Node 调用端（心跳、超时、取消）
  → guardian.py（执行槽锁、任务目录锁、命名 Job Object）
      → managed-worker.py（先加入 Job，再启动子进程）
          → Python 媒体引擎 / Next.js 命令
              → FFmpeg / Next.js 派生进程
```

使用 Windows [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects) 和 KILL_ON_JOB_CLOSE 管理进程树，不启用 breakaway。工作包装进程加入 Job 后关闭自身的 Job 句柄，守护进程确认加入成功才派发命令及标准输入。加入失败则禁止启动媒体处理。

守护进程在执行槽及任务目录锁内持有命名 Job，名字由规范化控制路径的哈希派生。取得执行槽后若 Job 仍有旧进程，先终止旧 Job 并查询活动数归零，才启动新工作。不能用 PID 或单独取得文件锁作为可写依据。

正常结束、取消、父管道断开、心跳丢失与异常都会收束进程树。守护进程被强杀时由最后一个 Job 句柄关闭触发系统结束成员；若其他句柄暂时阻止自动结束，新执行者仍必须主动清空旧 Job。done 延迟到进程树归零，Node 还须等待守护进程退出后才兑现结果；调用方不能只凭中间事件提交最终任务状态。

Windows 下 download/preview/cover 默认使用此控制链。下载锁定任务目录，预览和封面锁定目标目录。B/C 已接基本原片保护和删除阻断，完整读租约系统延期；正式视频服务使用统一数据根目录下的控制路径。

## 心跳与协议边界

初始信封为 UTF-8 JSON，含受信任命令数组、输入对象、控制根目录及可选目录。秘密只走标准输入，不进入命令行。后续仅接受 heartbeat/cancel 控制消息；父管道关闭或超过期限即停止。命令不交给 shell 执行。

当前心跳证明 Node 存活，首版沿用此能力，并在服务层校验当前执行标识。多执行者 SQL 租约及代次协议已延期，见[后续清单](video-download-backlog.md)，不为首版继续补齐。

## 已运行的验证

7 项 Windows 故障测试使用真实 FFmpeg：正常结束、父管道断开、心跳丢失、守护进程强杀、竞争执行槽、保留旧 Job 句柄时的主动接管，以及直接工作进程退出后的孤儿 FFmpeg 回收。Node 集成另测中文路径、失败工作释放、及时取消、竞争及取消后重新获取执行槽。

应用启动原型 run-app.mjs 已验证：隔离 Next 开发夹具连续两次返回 HTTP 200；现有 MOWO 生产构建在隔离数据库和独立端口下返回 HTTP 200。强制结束启动器后派生进程退出、原端口释放。开发夹具使用 Webpack，此结果不代替当前 MOWO Turbopack 全页面回归；生产检查使用已有构建，不代替新的源码构建验收。

真实样本已在受控模式下完成过音视频下载、合并及 HEVC 转预览；接入管理事件后修正了测试程序应按 event 取结果的逻辑。后续一次在线复测发生网络超时并保留部分文件，守护链按超时退出；使用已完成下载的本机样本继续离线媒体回归，不把网络超时写成下载成功。

`verify-launch.mjs dev` 与 `start` 已验证普通 npm 入口、退出后 Next/视频服务两端口释放、记录持久化和重启中断/文件缺失提示。开发验证使用隔离源码副本，保留用户正在运行的开发服务；数据库按应用相同 WAL 模式检查。没有因夹具退出时的 I/O 检查失败而删除 WAL 文件或改写正式数据。

## 命令

```powershell
data/video-runtime/python/python.exe scripts/video/test_lifecycle.py
node scripts/video/verify-managed-engine.mjs
node scripts/video/verify-app-lifecycle.mjs
node scripts/video/verify-managed-media.mjs
node scripts/video/run-app.mjs dev -p 3001 -H 127.0.0.1
```

进程与 Job 测试在实际 Windows 用户环境运行，仅管理本次创建的进程树。启动原型使用 MOWO_APP_CONTROL_ROOT 控制路径及 MOWO_DATA_ROOT 数据路径，仍属内部能力，不提供正式下载界面。
