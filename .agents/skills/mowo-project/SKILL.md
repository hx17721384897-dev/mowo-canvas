---
name: mowo-project
description: 接手、规划、实现或审查 MOWO Canvas 时，按任务定位当前记录、代码入口和收尾规则。
---

# MOWO Canvas 项目 Skill

1. 从项目根目录读取 [PROJECT_STATUS.md](../../../PROJECT_STATUS.md)。接手某项功能时，打开对应专题或在办计划。
2. 按任务选择下表的参考资料。定位到入口与约束后，继续查相关代码；查询历史时只打开对应日志、Git 提交或隔离材料。
3. **规划、实施、收尾或审查**时，读取[开发指南](../../../docs/08-development-guide.md)，按任务范围核对计划、变更、验证与记录。

| 任务 | 补读 |
|---|---|
| 功能范围或里程碑 | [产品范围](../../../docs/02-product-scope.md)或[路线图](../../../docs/03-roadmap.md) |
| 调整模块职责或依赖 | [技术架构](../../../docs/04-architecture.md)。查文件责任时用[文件地图](../../../docs/07-file-map.md) |
| 改持久化或画布保存 | [数据设计](../../../docs/05-data-design.md)的对应章节 |
| 写 PRD 或核对确认的行为 | [需求入口](../../../docs/requirements/README.md)中的对应专题 |
| 改 API 或数据契约 | [接口索引](../../../docs/api/README.md)中的对应契约 |
| 改交互方案或原型 | [设计索引](../../../docs/design/README.md)中的对应专题 |
| 运行、部署或备份 | [本地运行](../../../docs/09-local-deployment.md)或[安全与备份](../../../docs/11-security-and-backup.md) |
| 查术语或长期决定 | [术语表](../../../GLOSSARY.md)或[决策索引](../../../docs/decisions/README.md) |

核对代码与现行记录的差异后再延伸设计。每条规则在对应专题维护一处。当前产品范围为本地优先、单用户，范围变更按 [AGENTS.md](../../../AGENTS.md) 的规则处理。
