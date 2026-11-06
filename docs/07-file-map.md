# 文件地图

本文件只记录人工维护且影响项目理解的目录与关键文件。`node_modules`、`.next`、构建产物、缓存和实际用户数据不纳入地图。

## 当前结构

```text
MOWO Canvas/
├── .agents/skills/mowo-project/   项目级 AI 工作入口
├── src/app/                       Next.js App Router 页面与全局样式
├── drizzle/                       受版本控制的 SQLite 迁移
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

## 当前代码结构

AI 对话：`src/features/ai/` 保存类型、右侧聊天组件与样式、客户端恢复状态、运行/消息/事件表、事务存储及调度；`src/app/api/ai/` 与 `src/app/api/projects/[id]/ai/runs/` 提供接口。`scripts/ai-run-worker.ts` 为正式独立工作进程；`ai-run-test-worker.ts` 仅用于离线测试；`verify-ai-runs-http.mjs` 和 `verify-ai-chat-browser.mjs` 分别验证 HTTP 与真实浏览器链路。接口契约见 `docs/api/ai-runs.md`，交付证据见 `docs/ai/v1-progress.md`。

```text
src/
├── app/
│   ├── page.tsx                         首页画布项目中心
│   ├── canvas/[id]/page.tsx             动态画布项目路由
│   ├── components/canvas-workspace.tsx  可折叠工作流编辑器与左侧页签
│   ├── api/                              资产查询、导入、引用与内容接口
│   └── ui-shell.module.css               首页与编辑器组件样式
├── features/canvas/
│   ├── canvas-surface.tsx                React Flow 状态、连线与资产拖入
│   ├── module-registry.tsx               模块名称、主体和端口注册表
│   └── nodes/                            模块卡片主体与通用节点外壳
└── features/assets/
    ├── asset-panel.tsx                   当前项目资产、本地添加与历史引用
    ├── image-download-modal.tsx          LINE 下载、预览、选择与导入弹窗
    ├── downloaders/types.ts              下载任务的浏览器契约
    ├── downloaders/server/               下载任务执行器、网络客户端与 LINE 适配器
    ├── types.ts                          资产类型与浏览器拖拽协议
    └── server/                           SQLite、文件路径与资产目录服务
└── features/frame-extraction/
    ├── frame-sequence-viewer.tsx         逐帧播放、组切换与帧定位窗口
    ├── types.ts                          拆帧任务、草稿组和正式序列契约
    └── server/                           APNG 合成、GIF 解码、草稿与提交模块
```

`drizzle.config.ts` 负责生成迁移；`MOWO_DATA_ROOT` 只控制运行数据位置，不改变迁移文件位置。

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
