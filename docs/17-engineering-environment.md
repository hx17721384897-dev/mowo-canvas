# 工程环境

## 仓库基线

- 包管理器：npm
- Node.js 主版本：22
- 框架：Next.js App Router
- 语言：TypeScript 严格模式
- 样式：Tailwind CSS
- 代码检查：ESLint
- 目录：应用源码位于 `src/`
- 导入别名：`@/*` 指向 `src/*`

精确依赖以 `package.json` 和 `package-lock.json` 为准；Node.js 精确开发基线见 `.nvmrc` 与 `.node-version`。

本机视频环境使用固定来源与哈希的独立 Python/yt-dlp/FFmpeg，不依赖系统 PATH。首次执行 `npm run video:setup`；普通 dev/start 同时启动视频执行者。当前构建器采用 Webpack，具体入口与运行材料见[本地部署](09-local-deployment.md)、[视频环境清单](design/video-runtime-notices.md)。

## 2026-10-29 本机检查记录

| 工具 | 检查结果 |
|---|---|
| Node.js | 22.16.0 |
| npm / npx | 10.9.2 |
| Git | 2.49.0.windows.1 |
| Codex CLI | 可运行 |
| Git 工作区 | 检查时干净 |
| 数据库 MCP | 未配置 |

此表是一次环境审计记录，不替代仓库中的版本约束。

## 常用命令

```text
npm ci
npm run dev
npm run lint
npm run typecheck
npm run build
npm run check
```

## 脚手架来源

工程由官方 `create-next-app` 空模板生成，选择 TypeScript、Tailwind、ESLint、App Router、`src/`、npm，并禁用匿名反馈和额外 Git 初始化。
