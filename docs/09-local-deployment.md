# 本地部署

## 当前目标

在单台 Windows 电脑上运行，通过 `localhost` 访问，不向公网开放端口。

## 运行方式

开发模式：

```text
npm run dev
```

稳定本地运行：

```text
npm run build
npm run start
```

首次获取代码后使用 `npm ci` 按锁文件安装依赖。开发环境使用 Node.js 22；精确基线见 `.nvmrc`、`.node-version` 和 `package.json`。

首次准备视频运行环境：`npm run video:setup`。脚本安装到项目内固定目录并校验包/程序哈希，不修改系统 Python。普通 dev/start 会先校验环境，再统一启动受控 Next 和视频执行者；缺少环境时明确提示先运行 setup。

自动分镜另需运行 `npm run video:setup-shots -- -ModelPath "C:\\path\\to\\transnet-split.onnx"`，将经 SHA-256 校验的模型复制到项目内，并下载固定版本的推理依赖。模型已位于 `data/video-runtime/models/transnet-split.onnx` 时，可直接运行 `npm run video:setup-shots` 检查和补齐依赖。只复制源码到另一台电脑并不足以运行分镜；需在该电脑执行上述准备步骤，或转移已准备好的项目运行目录。另一台 Windows 电脑的实机验收尚未完成。

完整工程检查：

```text
npm run check
```

普通 `npm run dev` 与 `npm run start` 已包含视频执行者，只监听 127.0.0.1，可追加 `-- -p 端口`。原 `dev:video/start:video` 保留兼容。默认开发与生产构建使用已验证的 Webpack，避免当前 Turbopack 内部构建错误；没有更换 Next.js 技术栈。

首次运行视频功能须按[媒体运行说明](design/video-media-runtime.md)准备项目内固定的 Python、yt-dlp 与 FFmpeg 工具。入口先加载与 Next 相同的环境文件，再用同一 `MOWO_DATA_ROOT` 启动 Next 和独立执行者；不要手动单独启动 `service.ts` 绕过守护链。关闭下载弹窗不停止任务，退出应用会终止工作进程，重开后未完成记录显示已中断。

当前固定版本、许可与来源见[运行环境材料](design/video-runtime-notices.md)。需要手动清理时，在视频任务记录点击“清理临时文件”；ready 唯一原片不能清理，已入库原片和资产缓存会保留。弹窗的“存储与备份说明”展示剩余空间与备份范围。

## 本地数据

- SQLite 数据库和素材目录不进入 Git。
- 默认数据根目录为当前 Windows 用户的 `Documents\MOWO Canvas Data`。
- 可在 `.env.local` 中设置 `MOWO_DATA_ROOT` 改为其他本地绝对路径；示例见 `.env.example`。
- 当前目录结构包含 `database`、`storage/originals/images`、`temp/imports`、`trash` 和 `backups`。
- LINE 下载任务使用 `temp/download-tasks`；选择保留的未勾选文件进入 `storage/download-archive`。
- 程序升级不得覆盖 `data`。
- 数据目录位置应可配置，不能散落在源代码目录中。
- 仅复制程序代码不等于完成数据备份。

数据库结构变更先修改 Drizzle 表定义，再运行 `npm run db:generate` 生成迁移。程序首次访问资产接口时会自动执行尚未应用的迁移。

## 安全边界

- 默认只监听本机需要的接口。
- 不通过路由器端口映射、内网穿透或公网 IP 暴露开发服务。
- 环境变量和密钥不得提交 Git。
- 若后续允许局域网访问，应先重新评估认证、权限和防火墙。

Docker、开机启动器和桌面封装延后到本地功能稳定后评估。

## LINE 网络与代理

Windows 上默认读取系统设置中已经启用的 HTTP 代理。使用 v2rayN 时，只要“设置系统代理”已开启且对应端口可连接，一般不需要额外配置。

若需要覆盖系统代理，可在 `.env.local` 设置：

```text
MOWO_HTTP_PROXY=http://127.0.0.1:10809
```

修改代理后重启 `npm run dev`。代理地址仅在服务端读取，不进入浏览器、SQLite 或日志。
