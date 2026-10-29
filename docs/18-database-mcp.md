# 数据库 MCP 评估

## 当前决定

当前不接入 SQLite MCP。AI 通过仓库内的类型、Repository、数据库迁移、种子脚本和测试参与数据库开发；所有变更都能被 Git 审查和回退。

## 原因

- Model Context Protocol 官方仓库中的 SQLite 参考服务器已经归档且不再维护。
- 归档仓库明确说明不提供安全保证，不适合作为本项目的默认数据库写入通道。
- 当前阶段尚未创建数据库，提前提供任意 SQL 写入能力没有实际收益。
- 直接修改数据库会绕过迁移、类型、测试和代码审查，降低可复现性。

参考：

- [官方 MCP 服务器仓库中的归档说明](https://github.com/modelcontextprotocol/servers/blob/main/README.md)
- [归档的 SQLite 参考服务器](https://github.com/modelcontextprotocol/servers-archived/tree/main/src/sqlite)
- [OpenAI Codex MCP 配置说明](https://developers.openai.com/learn/docs-mcp)

## 安全使用边界

如果未来重新评估数据库 MCP，必须同时满足：

1. 项目维护活跃、许可证清楚、版本可锁定，并完成源码与依赖审查。
2. 默认连接开发数据库副本，不连接生产库或唯一数据副本。
3. 优先只读工具；写入操作需要显式批准。
4. 数据库账号遵循最小权限，不提供删除数据库或越界文件访问能力。
5. 秘密通过本地环境变量提供，不进入仓库、日志或 MCP 配置模板。
6. Schema 变更仍由仓库内迁移文件承担，MCP 不替代迁移系统。
7. 连接前有可验证备份，操作后运行完整性检查。

## RLS 说明

SQLite 不提供 PostgreSQL 式行级安全策略。当前阶段由服务层和 Repository 控制数据访问。未来迁移 PostgreSQL 并引入多用户时，再根据项目归属和角色设计 RLS；RLS 仍不能替代服务端授权检查。
