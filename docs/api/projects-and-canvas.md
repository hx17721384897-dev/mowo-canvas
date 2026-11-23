# 项目与画布文档接口

## 项目列表与创建

- `GET /api/projects`：按最近更新时间返回本机项目；可用 `exclude` 排除当前项目。
- `POST /api/projects`：创建项目和空白画布文档。请求可带 `{ "name": string }`，未提供时暂用“未命名画布”。成功返回 `201` 与稳定项目 ID。
- 当前为本机单用户接口，不涉及账户权限；项目 ID 由服务端生成，一次请求只创建一项。
- `DELETE /api/projects/:id` 或批量 `DELETE /api/projects`（`{ids: string[]}`）：视频/LINE 仍有活动或待处理任务时返回 409，提示先导入或明确放弃。批量中任一项目受阻，整批不删除；检查与删除在同一 SQLite 事务内完成。

## 画布读取与保存

- `GET /api/projects/:id/canvas`：读取项目的画布文档；旧项目尚无文档时返回 `null`。
- `PUT /api/projects/:id/canvas`：保存 `schemaVersion`、节点、连线、视口和可选的全画布普通组内容缩放开关 `groupContentScaleEnabled`，同时更新项目时间。旧文档缺少该字段时默认关闭；非布尔值返回 `400`。
- 普通组节点的旧字段 `data.quickActionLayout` 继续兼容，包含 `toolbar` 和 `more` 两个有序操作 ID 数组；六个基础操作必须各出现一次，额外支持 `toggle-scale` 与 `export`。重复、缺少基础操作或未知 ID 返回 `400`。旧画布缺少新增操作时允许读取，前端补入默认位置。该字段用于首次迁移，新的快捷工具偏好按节点类型保存在本机浏览器，详见数据设计。
- 请求上限为 5 MiB，文档最多 5000 个节点和 10000 条连线。超限返回 `413`。
- 非法 JSON、未知版本、无效节点、分组、连线、端口或视口返回 `400`，保留上一次保存。结构错误包含 `code`、`field` 和简短的 `error`。
- 数据库中已有的文档损坏或版本不兼容时，读取返回 `409`；画布页面显示错误并保留原始记录。
- 当前单用户版本采用整份文档覆盖并由前端防抖；未来出现多窗口并发编辑时再启用 revision 冲突控制。

## 验证

用 `node --no-warnings --experimental-strip-types --test src/features/projects/canvas-document.test.ts` 验证画布文档结构与兼容字段。改动自动保存或草稿恢复时，用隔离项目另验保存失败、排序及重开后的草稿选择。

## 导出画布组

`POST /api/projects/:id/group-export` 接收 `{ name, entries: [{ assetId, directories, order? }] }`，返回 `application/zip` 附件。`name` 仅用于本次文件名；有序项的 `order` 生成零填充序号并保留资产扩展名，普通项使用原文件名，路径重名自动加后缀。服务端逐项验证资产属于当前项目、文件存在且为图片或视频，最多 1000 项、总原始文件大小不超过 2 GB、嵌套目录最多 8 层。清单无效、文件缺失或超限返回 `400` 或 `413`，不修改资产或画布。ZIP 逐文件流式生成；同一请求可重复导出相同内容。测试覆盖顺序、同名处理和 ZIP 字节内容。

- 创建项目后首页能够查询到该项目。
- 保存包含资产引用的图片节点后，重新进入项目能够恢复节点、尺寸、位置和视口。
- 画布 JSON 只保存 `assetId` 与预览 URL，不保存图片 Base64 或本机绝对路径。
# 裁切方案

画布的 `crop-result` 模块节点可保存 `data.cropPlan`。文档校验逐项检查网格、裁切项、输出规格和可选的多来源列表；未知或畸形方案拒绝写入，不静默修复。
