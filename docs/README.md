# MOWO Canvas 文档导航

本目录是项目知识的唯一事实来源。文档按主题拆分，避免 AI 或开发者为一个小任务读取整套资料。

## 默认读取

任何任务只需先读根目录 `PROJECT_STATUS.md`。随后根据任务选择下表中的文档；不要顺序通读全部文档。

| 任务 | 读取文档 |
|---|---|
| 理解产品目标 | `01-project-overview.md`、`02-product-scope.md` |
| 理解产品术语 | `../GLOSSARY.md` |
| 安排迭代 | `03-roadmap.md` |
| 修改系统结构或依赖 | `04-architecture.md` |
| 修改数据库、保存或素材 | `05-data-design.md` |
| 修改画布、节点或快捷键 | `06-canvas-design.md` |
| 定位文件职责 | `07-file-map.md` |
| 开发、测试、提交 | `08-development-guide.md` |
| 本地安装和运行 | `09-local-deployment.md` |
| 准备公开上线 | `10-future-online-deployment.md` |
| 备份、恢复或安全 | `11-security-and-backup.md` |
| 选择或引入模板 | `12-template-selection.md` |
| 登录、用户、权限 | `13-account-system-plan.md` |
| 沉淀需求或编写 PRD | `requirements/README.md`，再读取当前 PRD 或指定功能需求 |
| 创建或修改接口 | `api/README.md`，再读取对应接口文档 |
| 原型、截图、视觉交互 | `design/README.md` |
| Node.js、npm、脚手架或工程环境 | `17-engineering-environment.md` |
| 数据库 MCP 或 AI 数据访问 | `18-database-mcp.md` |
| 询问某项决定的原因 | `decisions/README.md`，再读取指定 ADR |
| 追溯废弃方案 | 仅在用户明确要求时读取 `archive/README.md` |

## 当前文档规则

1. 主文档只写当前有效事实，不保留“以前考虑过什么”的叙述。
2. 一个规则只在一个主题文档中定义，其他文件只链接，不复制。
3. 设计被替换时，直接把主文档改成新设计；原因写入新的 ADR。
4. 设计实验被放弃时，使用 Git 恢复实验前检查点，不更新 `CHANGELOG.md`。
5. `PROJECT_STATUS.md` 保持简短，只写当前阶段、目标、已确认、下一步和阻塞项。
6. `CHANGELOG.md` 只记录进入稳定主线的结果。
7. `logs/current.md` 只记录当前迭代；结束后压缩成结论，必要时移入归档。
8. `archive/` 不属于默认上下文，不从主导航逐项列出历史内容。
9. 已确认需求写入当前 PRD；未确认信息只进入开放问题，不伪装成最终需求。
10. 接口行为变化必须同时更新对应 API 文档和验证用例。

## 文档状态

除 `archive/` 外，本目录中的文档均代表当前有效版本。若代码与文档不一致，先停止扩展工作，确认真实状态后同步修正。
