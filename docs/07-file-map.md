# 文件地图

本文件只记录人工维护且影响项目理解的目录与关键文件。`node_modules`、`.next`、构建产物、缓存和实际用户数据不纳入地图。

## 当前结构

```text
MOWO Canvas/
├── .agents/skills/mowo-project/   项目级 AI 工作入口
├── src/app/                       Next.js App Router 页面与全局样式
├── docs/                          当前设计、需求、API、规则与隔离历史
├── data/                          本地运行数据说明；实际数据不进 Git
├── AGENTS.md                      对进入项目的 AI 强制入口
├── README.md                      人类项目入口
├── PROJECT_STATUS.md              当前阶段与下一步
├── CHANGELOG.md                   已进入稳定主线的版本变化
├── package.json                   依赖、运行时约束与工程命令
├── package-lock.json              npm 锁定依赖
├── next.config.ts                 Next.js 配置
├── tsconfig.json                  TypeScript 严格模式与路径别名
├── eslint.config.mjs              ESLint 与 Next.js 规则
├── .env.example                   环境变量占位说明
└── .gitignore                     排除依赖、构建、秘密和本地数据
```

## 代码目录约定

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

当前只有 `src/app/`。其他目录在出现真实职责时再创建，不预建空模块。

## 可扩展文档目录

```text
docs/
├── requirements/    当前 PRD、功能需求与开放问题
├── api/             当前接口契约
├── design/          原型说明与当前截图
├── decisions/       已接受的重要决策原因
├── logs/            当前迭代日志
└── archive/         默认不读取的隔离历史
```
