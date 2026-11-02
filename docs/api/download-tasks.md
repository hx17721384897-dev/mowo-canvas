# 图片下载任务接口

以下接口仅供本机 MOWO 页面使用，不是公开 API。第一版平台仅为 LINE。

## 创建任务

- 方法：`POST /api/download-tasks`
- 请求：`{ projectId: string, url: string }`
- 成功：`202 { task: DownloadTaskSummary }`
- 失败：`400 { error: string }`
- 验证：只接受 HTTPS 的 `store.line.me` 商品链接或 `line.me/S/sticker/...` 链接。
- 幂等性：每次提交创建独立临时任务；正式资产仍按内容指纹去重。

## 查询与取消

- 查询：`GET /api/download-tasks/:id`
- 取消：`DELETE /api/download-tasks/:id`
- 成功：`200 { task: DownloadTaskSummary }`
- 不存在：`404 { error: string }`
- 状态：`queued`、`resolving`、`downloading`、`ready`、`importing`、`completed`、`failed`、`cancelled`。
- 恢复：查询未完成任务时，本地执行器会尝试恢复；已完成下载结果由 SQLite 与临时文件共同保存。

## 预览下载项

- 方法：`GET /api/download-items/:id/content`
- 成功：原始 PNG/APNG 字节，响应 MIME 为 `image/png`。
- 失败：`404`。
- 安全：文件路径必须位于 MOWO 数据根目录；响应使用 `nosniff`。

## 导入选择结果

- 方法：`POST /api/download-tasks/:id/import`
- 请求：`{ itemIds: string[], discardUnselected: boolean }`
- 成功：`200 { assets, importedIds }`
- 失败：`400 { error: string }`
- 行为：选中项进入资产模块并形成有顺序的集合；未选项按参数删除或移动至 `storage/download-archive/line/:taskId`。
- 幂等性：同一任务只能成功导入一次；资产文件按 SHA-256 去重。

## 网络与限制

- 默认读取 Windows 已启用的系统代理；`MOWO_HTTP_PROXY` 可显式覆盖。
- 元数据最大 2MB，单图最大 10MB，ZIP 最大 25MB，解压后最大 100MB，单任务最多 500 项。
- 网络、HTTP 状态、超限、平台响应与取消使用分类错误；响应不返回代理凭据、本机文件路径或堆栈。
