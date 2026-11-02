# 本地部署

## 当前目标

在单台 Windows 电脑上运行，通过 `localhost` 访问，不向公网开放端口。

## 预计运行方式

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

完整工程检查：

```text
npm run check
```

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
