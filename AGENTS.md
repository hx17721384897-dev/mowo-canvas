# MOWO Canvas Agent Instructions

在本项目中执行规划、设计、编码、测试、部署或文档工作前，必须先读取 `.agents/skills/mowo-project/SKILL.md`，并严格按其中的任务路由只加载必要文档。

项目采用“当前事实与历史隔离”原则：

- `PROJECT_STATUS.md` 与 `docs/01` 至 `docs/13` 只描述当前有效状态。
- 不要把废弃方案、讨论过程或候选方案残留在当前文档中。
- 不要默认读取 `docs/archive/`；只有用户明确要求追溯、恢复或比较历史时才读取。
- 实验性变更前建立 Git 检查点；实验放弃时恢复检查点，并保持当前文档干净。
- 不要把自动生成目录、依赖目录或用户数据写入项目文件地图。

除非用户明确授权，不得因维护文档而扩大到实现功能、安装依赖、联网部署或引入外部服务。

## 功能完整性与复杂度控制

以当前使用场景为边界，完整交付最小可用流程；增加复杂机制需要明确依据。

1. **先定义可验收的用户流程。**规划先说明用户要完成什么、从哪里开始、最终得到什么，以及常见失败如何处理，再选择技术方案。
2. **完整性以当前场景为准。**首版应覆盖主要流程、常见失败、必要的数据保护和安全要求。明确提示失败、允许取消或手动重试，可以是完整的首版处理方式；自动恢复并非默认必需。
3. **明确区分三类需求。**每项能力标为“首版必需”“交付前收尾”或“按需增强”。按需增强只有出现实际需求时才进入版本计划，不自动成为以后必须补齐的任务。
4. **复杂机制必须说明必要性。**引入新的服务、调度系统、恢复日志、通用框架等机制前，说明它解决哪个当前需求或已发现的问题，以及更简单的办法为何不足。仅有未来可能性、参考软件具备该能力或时间充足，不足以成为首版实施依据。
5. **优先形成可操作的完整流程。**先串起界面、处理和结果，再根据实际使用完善。技术验证应围绕具体不确定性展开，有明确结束条件；验证通过后及时进入产品集成。
6. **简化实现，保留底线。**保护原始数据、凭据、必要的校验和用户已确认的核心行为。不能以控制复杂度为由，省略这些要求或把半成品宣称为完成。
7. **按实际风险安排测试。**优先验证成功路径、常见失败和可能损坏数据的边界。更多故障演练由具体风险、失败证据或明确验收要求驱动，不默认穷举所有极端情况。

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
