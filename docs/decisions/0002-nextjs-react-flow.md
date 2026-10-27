---
status: Accepted
date: 2026-10-27
---

# ADR-0002：采用 Next.js 与 React Flow

## 决定

使用 Next.js App Router 构建应用，用 React Flow 实现节点与连线型无限画布。

## 原因

产品核心是节点、连线和视口交互，React Flow 与该模型匹配。Next.js 可以同时承担本地页面和数据接口，并保留未来转为线上 Web 产品的路径。

## 影响

React Flow 相关组件是客户端交互边界；数据访问留在服务端或存储层。产品不把自由矢量绘制作为当前目标。
