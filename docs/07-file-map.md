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

通用加载 UI：`src/components/loading-progress.tsx` 与同名 CSS Module 支持行内、整页和覆盖层样式，以及真实百分比/未知进度两种模式；`navigation-progress.tsx` 在路由切换期间提供即时反馈。观察页的 `src/app/video-editor/loading.tsx` 处理路由加载，播放器内沿用同一展示组件。

视频下载技术验证：`scripts/video/` 包含独立引擎、Node 调用端、扫码与加密凭据、媒体工具准备及测试。`guardian.py`、`managed-worker.py`、`winjob.py` 管理执行槽和 Windows 进程树；`run-app.mjs` 为尚未切换正式 npm 入口的启动原型。当前不承载正式持久队列。协议见 `docs/api/video-engine.md`，证据见 `docs/design/video-download-progress.md` 与 `docs/design/video-process-lifecycle.md`。

输入操作栏：`src/features/ai/chat-composer.tsx` 与同名 CSS Module 管理输入、底部菜单和本地文件选择预览；正式聊天发送仍由 `ChatSession` 承担，不在组件里直连模型。

提问卡片：`src/features/ai/clarification-card.tsx` 与同名 CSS Module 为可复用 UI；`clarification-preview.tsx` 仅承载固定示例和本地摘要。最新样式与验证见 `docs/design/prototypes/clarification-card-v01-preview.md`。

AI 对话：`src/features/ai/` 保存类型、聊天组件/图标/样式、客户端恢复状态、会话/运行/消息/事件表、事务存储及调度；`src/app/api/ai/` 与 `src/app/api/projects/[id]/ai/` 提供运行与当前画布会话接口。`scripts/ai-run-worker.ts` 为正式独立工作进程；`ai-run-test-worker.ts` 仅用于离线测试；`verify-ai-runs-http.mjs` 和 `verify-ai-chat-browser.mjs` 分别验证 HTTP 与真实浏览器链路。接口契约见 `docs/api/ai-runs.md`，交付证据见 `docs/ai/v1-progress.md`。

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
    ├── server/draft-retention.ts         仅清理没有任务记录的旧解码目录
    └── server/                           APNG 合成、GIF 解码、草稿与提交模块
```

`drizzle.config.ts` 负责生成迁移；`MOWO_DATA_ROOT` 只控制运行数据位置，不改变迁移文件位置。

有序组的自动网格、插入位置计算和成员检查集中在 `src/features/canvas/ordered-group.ts`。
节点通用快捷工具的合并及移动规则位于 `src/features/canvas/quick-actions.ts`，本机偏好订阅与保存位于 `quick-action-preferences.ts`，共享工具栏及配置弹窗位于 `node-quick-toolbar.tsx` 与 `quick-action-dialog.tsx`。原 `group-quick-actions.ts` 保留组操作清单及旧画布配置兼容校验。
组导出清单与嵌套顺序在 `src/features/canvas/group-export.ts`；弹窗在 `group-export-dialog.tsx`；服务端项目归属、路径验证和 ZIP 流位于 `src/features/assets/server/group-export.ts`、`src/features/assets/group-export-zip.ts` 与 `src/app/api/projects/[id]/group-export/route.ts`。

## 可扩展文档目录

scripts/check-ai-ui.mjs 验证聊天组件 SSR，scripts/verify-ai-stage0.mjs 与 ai-stage0-worker.mjs 验证隔离后台流式执行。检查范围与状态见 [阶段 0 清单](ai/stage-0-checklist.md)。

[AI 与 Agent 接入工作区](ai/README.md)集中管理模型接入想法、供应商资料和待讨论事项。

```text
docs/
├── requirements/    当前 PRD、功能需求与开放问题
├── api/             当前接口契约
├── design/          原型说明与当前截图
├── decisions/       已接受的重要决策原因
├── logs/            当前迭代日志
└── archive/         默认不读取的隔离历史
```
# 图片裁切 V01

- `src/features/canvas/image-crop.ts`：裁切方案、网格展开、校验与浏览器渲染。
- `src/features/canvas/image-crop-ui.tsx`、`image-crop.module.css`：网格设置、单张调整与草稿预览。
- `src/features/canvas/nodes/crop-result-node-body.tsx`：结果卡片、图片生成与有序组建立。
- `src/features/canvas/image-crop.test.ts`：特殊多网格及方案校验。

## 本地视频导入

- `src/features/assets/video-policy.ts`：本地视频格式与超限门槛。
- `src/features/assets/server/video-import.ts`、`video-metadata.ts`：流式接收、元数据核查与资产入库。
- `src/features/assets/server/byte-range.ts`：资产流式读取的字节范围校验。
- `src/app/api/projects/[id]/videos/route.ts`：原片上传接口。
- `src/features/canvas/video-import.tsx`、`video.module.css`：导入预检与超限询问；视频节点主体继续位于 `nodes/module-node.tsx`。
- `src/features/canvas/video-player.tsx`：画布视频播放与独立控制条，画面保留节点拖动手势。
- `src/features/assets/server/video-import.test.ts`：容器、阈值和 Range 回归验证。

## 视频拆帧底层

- `src/features/frame-extraction/video-frame-policy.ts`、`video-frame-result.ts`：视频提帧限制、N/K 规划与执行结果校验。
- `src/features/frame-extraction/server/video-frame-input.ts`、`video-frame-runtime.ts`：项目原片/片段解析、受控媒体进程、取消及临时文件交接。
- `src/features/frame-extraction/server/video-frame-source.ts`、`video-frame-job-store.ts`、`video-frame-executor.ts`：共用来源解析、持久任务及现有视频执行进程调度；`video-frame-jobs.ts` 定义输入与状态。
- `src/app/api/projects/[id]/video-frame-jobs/`、`server/video-frame-job-http.ts`：本机任务创建、查询、取消及重试。
- `scripts/video/frame_sequence.py`、`test_frame_sequence.py`：实际源帧读取、节奏分析、PNG 提取与隔离媒体测试。
- `scripts/video/verify-frame-sequence.ts`、`verify-frame-sequence-tests.mjs`：真实样本验证及专项测试入口。
- `scripts/video/verify-frame-jobs-http.mjs`：隔离受监护应用的任务、共用编辑/拼接/保存与重启验证。

## 视频观察与片段

- `src/app/video-editor/[projectId]/[assetId]/page.tsx`、`src/features/video-editor/`：项目视频观察页、源帧时间轴、逐帧与片段选择；`cutting-strip.tsx` 展示下方编辑区，`cutting-model.ts` 负责成片时间与源帧映射，`editor-history.ts` 组织分镜与剪辑共用的撤销/重做历史。
- `src/features/video-editor/server/frame-index.ts`、`scripts/video/frame_index.py`、`frame_image.py`：源显示帧索引、按需精确解码与缓存校验。
- `src/features/video-editor/server/clips.ts`、`preview.ts`：片段正式保存和兼容预览生成；`drizzle/0008_*.sql` 与 `0009_*.sql` 增加片段与草稿表。
- `src/features/video-editor/server/render-composition.ts`、`deliver-composition.ts`：按剪辑工程源帧范围渲染/校验 MP4，交付下载或保存并放入画布；`drizzle/0015_*.sql` 记录工程版本对应的成片资产。
- `src/app/api/projects/[id]/video-editor/[assetId]/`：帧索引、源帧图、片段、选区草稿、剪辑工程与预览状态接口；工程数据表由迁移 0013 建立。
- `scripts/video/verify-editor-entry.mjs`、`check-editor-browser.mjs`：隔离数据目录中的视频编辑链路与浏览器验收。

## B 站视频下载

- `src/features/video-downloads/types.ts`：任务摘要、输入与引擎事件校验。
- `src/features/video-downloads/server/`：独立视频任务存储、状态转换、本机请求校验和边界测试。
- `src/features/video-downloads/server/import-video.ts`：文件式确认入库、原子发布、内容去重与资产缓存关联。
- `src/features/video-downloads/server/maintenance.ts`、`space-policy.ts`：安全手动清理、恢复文件检查与阶段空间底线。
- `src/features/assets/server/video-content.ts`、`serve-media.ts`：资产预览/封面与流式 Range 响应。
- `src/features/video-downloads/video-download-modal.tsx`、`video-download.module.css`：独立扫码、解析、格式选择、下载进度与当前项目历史弹窗。
- `src/app/api/projects/[id]/video-downloads/` 与 `src/app/api/video-downloads/auth/`：解析、任务和登录接口；契约见 [视频任务接口](api/video-downloads.md)。
- `scripts/video/service.ts`：单任务独立执行者；`run-app.mjs --video` 在守护链中启动它和 Next，Python 引擎、扫码加密与媒体工具同目录维护。
- `scripts/video/python-runtime.json`、`media-runtime.json`：受版本控制的工具来源与哈希；`verify-launch.mjs` 验证普通启动入口。
