# 设计与原型入口

本目录保存当前有效的交互原型、截图和设计说明。代码实现前，复杂界面应先形成最小可验证原型。

## 目录

- `prototypes/`：当前原型截图及其说明。
- `references/`：用户提供的外部产品截图及参考边界。
- 功能交互规则仍以对应需求文档和 `../06-canvas-design.md` 为准。

## 当前最新原型

- [视频拆帧节点 V01](prototypes/video-frame-node-v01.md)：当前有效，动画/拍摄分支、直接生成与超限后选择，复用共用结果组；截图见同目录 PNG。

- [视频拆帧设计与实施计划](video-frame-extraction.md)：当前有效，复用动图的结果组、编辑和拼接，分阶段实施。

- [视频片段剪辑设计书](video-cutting-design.md)：**当前有效设计，按步骤实施**。定义源帧与成片双时间坐标、预览状态、片段操作及进度目标。

- [Concat 时间轴参考与简化改造记录](video-cutting-concat-reference.md)：记录参考项目 UI、手势、代码分层、MOWO 取舍及实际验收流程。

- [资产栏按来源整理 V01](asset-source-view-v01.md)：**首版代码已接入，待浏览器和旧项目验收**。记录来源批次、手动文件夹、原始素材与多源产物的展示规则。

- [视频编辑页技术设计](video-editor-architecture.md)：**现行技术边界**，覆盖时间轴、源帧定位和分镜任务。已接入范围与尚待验证项可从[视频编辑 PRD](../requirements/features/video-editor.md)进入。

- [B 站视频下载与入库 V01 设计书](video-download-v01.md)：**精简首版 A—D 已完成实现与交付验证，待用户体验验收**。证据见[实施进度](video-download-progress.md)，环境/许可见[运行材料](video-runtime-notices.md)，按需增强见[后续清单](video-download-backlog.md)。

- [图片裁切 V01 设计](prototypes/image-crop-v01-candidate.md)：**已确认并接入**。涵盖网格设置、裁切结果卡片与单张调整窗口。

- [对话输入操作栏 V01](prototypes/chat-composer-v01-preview.md)：**当前最新候选**，功能菜单仅上传文件；文件当前为本地预览，其他模式/模型能力尚未接入。

- [提问卡片 V01](prototypes/clarification-card-v01-preview.md)：**当前最新候选**，只实现样式和本地交互预览，尚未接入助手追问。

- [动图拆帧 V03 原型](prototypes/animated-frame-extraction-v03.md)：**当前最新且已确认的实现基线**。V01、V02 已被替代，只通过 Git 历史追溯。

## 原型规则

1. 截图文件使用 `主题-vNN-简述.png`，例如 `canvas-v01-empty-state.png`。
2. 每组截图配套同名 Markdown，记录目标、已确认交互和待确认问题。
3. 截图只表达当前候选，不自动成为最终需求；用户确认后再同步 PRD。
4. 新版本替换旧版本时，当前目录只保留有效版本；需要追溯时依靠 Git 或隔离归档。
5. 不把真实用户数据、密钥或私人文件放入原型截图。
6. 每份原型说明必须明确写出“当前最新候选”“当前有效”或“已被替代”，设计入口只链接当前最新版本。
