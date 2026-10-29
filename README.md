# MOWO Canvas

MOWO Canvas 是一个采用本地优先路线开发的无限画布项目。当前目标是先完成单机、自用、可持续迭代的节点画布，再在产品成熟后迁移到中国大陆的线上基础设施。

## 当前阶段

阶段 1A 工程准备基线已完成：官方 Next.js 脚手架、依赖锁定、工程检查、需求/API/原型目录和数据库 MCP 决策均已建立。尚未开始 React Flow 业务功能开发。

## 文档入口

- 当前进度与下一步：[PROJECT_STATUS.md](PROJECT_STATUS.md)
- 文档导航与读取规则：[docs/README.md](docs/README.md)
- 产品范围：[docs/02-product-scope.md](docs/02-product-scope.md)
- 迭代路线：[docs/03-roadmap.md](docs/03-roadmap.md)
- 技术架构：[docs/04-architecture.md](docs/04-architecture.md)
- AI 工作规范：[.agents/skills/mowo-project/SKILL.md](.agents/skills/mowo-project/SKILL.md)
- 当前 PRD：[docs/requirements/current-prd.md](docs/requirements/current-prd.md)
- 开放问题：[docs/requirements/open-questions.md](docs/requirements/open-questions.md)
- API 文档入口：[docs/api/README.md](docs/api/README.md)
- 原型与截图入口：[docs/design/README.md](docs/design/README.md)
- 工程环境：[docs/17-engineering-environment.md](docs/17-engineering-environment.md)

## 已确定的技术方向

- Next.js、TypeScript、React Flow、Tailwind CSS
- 本地 SQLite 保存结构化数据
- 本地文件夹保存图片、视频等素材
- 单用户、本地运行优先
- 账户、协作、国内云部署延后到对应迭代
- 不引入强绑定海外托管、支付、身份或数据库服务的完整 SaaS 模板
- 当前不接入已归档的 SQLite MCP；数据库操作通过仓库内代码、迁移和验证完成

本文只承担项目入口职责。具体规则以对应主题文档为唯一事实来源。
