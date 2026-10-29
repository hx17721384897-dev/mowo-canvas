# MOWO Canvas Agent Instructions

在本项目中执行规划、设计、编码、测试、部署或文档工作前，必须先读取 `.agents/skills/mowo-project/SKILL.md`，并严格按其中的任务路由只加载必要文档。

项目采用“当前事实与历史隔离”原则：

- `PROJECT_STATUS.md` 与 `docs/01` 至 `docs/13` 只描述当前有效状态。
- 不要把废弃方案、讨论过程或候选方案残留在当前文档中。
- 不要默认读取 `docs/archive/`；只有用户明确要求追溯、恢复或比较历史时才读取。
- 实验性变更前建立 Git 检查点；实验放弃时恢复检查点，并保持当前文档干净。
- 不要把自动生成目录、依赖目录或用户数据写入项目文件地图。

除非用户明确授权，不得因维护文档而扩大到实现功能、安装依赖、联网部署或引入外部服务。

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
