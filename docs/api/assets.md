# 资产接口

当前接口仅供本机 MOWO Canvas 页面调用，不是公开 API。所有接口使用 Node.js 运行时，文件路径不会返回浏览器。

## 查询项目资产

- 方法：`GET /api/projects/:id/assets`
- 成功：`200 { assets: AssetSummary[] }`
- 数据范围：指定本地项目已经关联且未进入回收站的资产。
- 缓存：不缓存。

## 本地导入图片

- 方法：`POST /api/projects/:id/assets`
- 请求：`multipart/form-data`，字段 `files` 可以重复。
- 第一版格式：PNG、JPEG、WebP、GIF。
- 限制：单张 50MB，单批 500 张。
- 成功：`201 { assets: AssetSummary[], importedIds: string[] }`
- 失败：`400 { error: string }`
- 幂等性：按文件内容指纹去重；重复导入复用资产和物理文件。

## 查询历史项目

- 方法：`GET /api/projects?exclude=:projectId`
- 成功：`200 { projects: AssetProjectSummary[] }`
- 用途：历史画布选择器。

## 引用历史资产

- 方法：`POST /api/projects/:id/assets/reference`
- 请求：`{ assetIds: string[] }`
- 成功：`200 { assets: AssetSummary[] }`
- 失败：`400 { error: string }`
- 幂等性：`projectId + assetId` 唯一，重复引用不会新增记录或复制文件。

## 读取资产内容

- 方法：`GET /api/assets/:id/content`
- 成功：原始文件内容及真实 MIME。
- 失败：`404`。
- 安全：服务端验证资产存在且路径位于数据根目录内；响应使用 `nosniff`。
