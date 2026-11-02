# 架构决策记录

ADR 只记录会长期影响项目的重要且已接受决定。普通实现细节不建立 ADR。

## 读取规则

- 不默认通读本目录。
- 只有需要了解“为什么这样设计”时，读取相关 ADR。
- 当前生效的技术事实仍以主题文档为准，ADR 只解释原因。
- 新决定替换旧决定时，新建 ADR 并将旧 ADR 标记为 `Superseded`。
- 实验后完全放弃、未进入主线的方案不创建正式 ADR。

## 当前决策

- `0001-local-first.md`：本地优先，成熟后上线。
- `0002-nextjs-react-flow.md`：采用 Next.js 与 React Flow。
- `0003-delay-authentication.md`：延后账户系统。
- `0004-platform-download-adapters.md`：平台下载采用适配器与本地持久任务。
