# 文件地图

本文件只记录人工维护且影响项目理解的目录与关键文件。`node_modules`、`.next`、构建产物、缓存和实际用户数据不纳入地图。

## 当前结构

```text
MOWO Canvas/
├── .agents/skills/mowo-project/   项目级 AI 工作入口
├── docs/                          当前设计、流程、决策与隔离历史
├── data/                          本地运行数据说明；实际数据不进 Git
├── AGENTS.md                      对进入项目的 AI 强制入口
├── README.md                      人类项目入口
├── PROJECT_STATUS.md              当前阶段与下一步
├── CHANGELOG.md                   已进入稳定主线的版本变化
└── .gitignore                     排除依赖、构建、秘密和本地数据
```

## 未来代码目录约定

创建 Next.js 项目后，预计使用：

```text
src/
├── app/            页面与服务器路由
├── components/     通用 UI 与画布组件
├── features/       按业务能力组织的功能
├── lib/            数据库、存储和通用基础设施
├── repositories/   可替换的数据访问层
└── types/          跨模块共享类型
```

实际脚手架创建后，应以真实目录更新本文件，删除不再采用的预计结构。
