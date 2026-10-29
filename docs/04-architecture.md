# 技术架构

## 当前目标架构

```text
浏览器
  ↓ localhost
Next.js
  ├── React Flow 画布
  ├── 项目与素材页面
  └── 本地数据接口
        ├── SQLite
        └── data/assets 本地文件
```

## 技术选择

- 语言：TypeScript
- Web 框架：Next.js App Router
- 画布：`@xyflow/react`
- 样式：Tailwind CSS
- 数据库：SQLite
- ORM：进入阶段 1/2 前比较 Prisma 与 Drizzle 后确定
- 素材存储：项目外观可访问、但与源代码隔离的本地数据目录

## 架构边界

- React Flow 组件只负责交互与前端状态，不直接操作数据库。
- 页面通过服务层或 Route Handler 调用数据能力。
- 数据访问通过 Repository/Service 封装，避免绑定 SQLite 实现。
- 画布 JSON 不包含图片、视频的 Base64 内容，只保存 `assetId`。
- 本地数据目录不进入 Git。
- 当前不引入 Redis、消息队列、容器编排或独立微服务。
- 当前不接入数据库 MCP；AI 通过仓库内的类型、Repository、迁移和验证脚本参与数据库开发。

## 未来替换点

```text
SQLite              → PostgreSQL
data/assets         → 国内对象存储
本地单用户           → 账户与项目成员
localhost           → 国内云服务器、域名、HTTPS
单进程               → 按真实负载拆分后台任务
```

替换通过存储接口和数据库迁移完成，画布组件不应感知具体存储位置。
