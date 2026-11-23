# 项目状态

## 当前工作

本地版本已接入画布、素材库、视频处理和 AI 对话。文档入口、计划与收尾规范已整理。按下表选取对应专题和代码入口。开发、计划收尾和复核按[开发指南](docs/08-development-guide.md#任务收尾检查)执行。

## 功能与接手入口

| 功能 | 当前状态与代码入口 | 按需读 |
|---|---|---|
| 项目与画布 | 项目列表、节点与组、自动保存和浏览器草稿恢复已接入。交互从 `src/features/canvas/canvas-surface.tsx` 开始，文档保存从 `src/app/components/canvas-workspace.tsx` 开始。 | [画布需求](docs/requirements/features/canvas-workspace.md) · [保存策略](docs/05-data-design.md#保存策略) · [项目生命周期](docs/requirements/features/project-lifecycle.md) |
| 素材管理 | 资产栏支持平铺、按来源浏览、手动文件夹和派生关系。界面入口是 `src/features/assets/asset-panel.tsx`。来源视图的实际旧项目验收仍待做。 | [资产库需求](docs/requirements/features/asset-library.md) · [来源视图设计](docs/design/asset-source-view-v01.md) |
| 下载与导入 | LINE 图片和 B 站视频下载、本地视频导入已接入。B 站真实使用体验仍待用户验收。 | [下载需求](docs/requirements/features/video-download.md) · [本地视频导入](docs/requirements/features/local-video-import.md) |
| 视频编辑 | 视频观察、分镜、人工校正、剪辑和成片交付已接入。用户确认分镜与剪辑四项真实素材操作正常。长片与复杂时间戳、跨电脑分镜仍待专项确认。 | [视频编辑需求](docs/requirements/features/video-editor.md) · [剪辑验收](docs/design/video-cutting-design.md#真实素材验收) |
| 拆帧与拼接 | 动图和视频拆帧接入项目流程，复用结果组和帧编辑。视频拆帧用户体验反馈正常，大型素材组合的设备验收仍待做。 | [动图拆帧](docs/requirements/features/animated-frame-extraction.md) · [视频拆帧设计](docs/design/video-frame-extraction.md) |
| AI 对话 | V1 文字对话、多会话和流式恢复已接入。模型设置、安全密钥存储和图像生成仍列在后续规划。 | [功能需求](docs/requirements/features/settings-and-models.md) · [V1 进度](docs/ai/v1-progress.md) · [AI 长期路线](docs/ai/agent-implementation-plan.md) |

## 计划与阻塞

- 新增跨会话任务的计划放在 [docs/plans](docs/plans/README.md)。当前没有在该目录登记的功能计划。
- 已按画布与素材两个样例复核交接与收尾规则。后续任务按开发指南开工和收尾，未合并的剪辑旧测试入口单独跟踪。
- 未记录项目范围内的当前阻塞。待验事项随功能专题维护。

最后更新：2026-11-23
