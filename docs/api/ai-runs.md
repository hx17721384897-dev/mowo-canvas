# AI 对话运行接口

2026-11-05：V1 后端基础接口已实现，右侧 UI 与正式密钥设置尚未接入。业务范围以 [Agent 计划](../ai/agent-implementation-plan.md) 为准，验证证据见 [V1 进度](../ai/v1-progress.md)。

## 创建与查询

POST `/api/projects/{projectId}/ai/runs` 接收 JSON `{clientRequestId, message}`，不接受其他字段。消息非空，最多 8000 个 JS 字符；请求标识为 8–100 个英文字母、数字、下划线或连字符，建议使用 UUID。请求体最多 40000 字节。当前固定使用 `deepseek-flash`、关闭思考、最多输出 2048 tokens，密钥仅从服务端 `DEEPSEEK_API_KEY` 读取。

服务端为每个真实项目提供一个会话，保存独立用户消息、助手消息和运行输入快照。新建或未结束的重复请求返回 202 `{run, created}`；已结束的重复请求返回 200。`run.id` 为后续查询和停止使用的运行 ID。相同项目与请求 ID 唯一；同输入返回已有运行，同 ID 不同输入返回 409。重复请求即使密钥暂时缺失也能查询已有结果。重试不得换 ID；用户明确重新生成才使用新 ID。

输入摘要包含原始消息与固定模型；后端只在第一次创建时组装历史。上下文从最新完整成功的问答对向前截取，最多 40 轮、累计 16000 字符（含当前消息），不切断问答对。中断或失败的回复保存在历史，但不自动加入后续模型上下文。UI 接入时需展示这一截取策略。

GET `/api/projects/{projectId}/ai/runs?clientRequestId=...` 返回 `{run}`，用于创建响应丢失后的查询。不带查询参数返回 `{messages}`，按运行创建顺序、用户在助手前排序；消息包含 id、runId、role、content、status、createdAt。

GET `/api/ai/runs/{runId}` 返回 `{run}`。运行包含 id、projectId、clientRequestId、model、status、output、sequence、errorCode、usage、createdAt、updatedAt。时间为毫秒。状态为 queued、running、completed、stopped、failed、interrupted。配置值与内部输入快照不返回客户端。

## 订阅与停止

GET `/api/ai/runs/{runId}/events?after={sequence}` 返回 SSE，每条包含 `id: sequence` 与 JSON `data`。支持 `status`（状态、错误分类及用量）和 `delta`（text）事件。不带 after 时先发送 `{type: 'snapshot', run}`，再补发该快照序号之后的所有持久事件；带 after 时严格重放序号更大的事件，也支持 Last-Event-ID。客户端按序号去重，after 优先于请求头。无效、负数或大于当前序号的游标返回 409。

事件写入与消息更新在同一事务内，终态且重放完成后关闭订阅；传输关闭本身不表示成功，前端仍查询终态确认。浏览器断线只结束订阅，不停止后台执行。

POST `/api/ai/runs/{runId}/stop` 幂等返回 `{run}`。服务器原子提交 stopped 后，工作进程最多约 250ms 后检查到状态变化并中断上游，部分回复保留。成功或其他终态已经提交时保持原状态；迟到的输出及完成不能覆盖停止。停止供应商计费的能力仍取决于供应商。

## 执行与限制

Next.js 请求只负责创建、查询与订阅；每个运行启动一个独立 Node 子进程，原子领取后才调用供应商。运行领取与所有输出、完成写入校验随机租约令牌和 15 秒有效期，每 250ms 检查及续约。重复调度的进程无法重复领取。页面关闭不影响进程；本机休眠或进程结束不保证继续。

每次 AI 接口请求都会核对过期运行，将其标记 interrupted / WORKER_LOST，保留部分回复，不自动重新付费提交。排队中的未领取运行在创建、历史/状态查询或订阅时重新调度；当前未提供常驻队列守护服务。子进程启动或导入失败记 WORKER_START_FAILED。每个画布最多一个活动运行，全局最多三个；单次运行超时 120 秒。供应商请求不自动重试。

所有接口限制为本机 localhost / 127.0.0.1 / IPv6 loopback 地址，拒绝不匹配的 Origin 与跨站浏览器请求。当前是本地单用户接口，无账户认证；不得据此作为公网部署方案。项目必须已存在，不为 AI 调用静默创建项目。项目删除时级联清除其对话、运行和事件，旧进程随后失去写入资格。

HTTP 错误返回 `{code,error}`，不泄露密钥、请求头、堆栈或供应商原始错误。

| 状态码 | code |
| --- | --- |
| 400 / 413 | INVALID_INPUT |
| 403 | LOCAL_ONLY |
| 404 | PROJECT_NOT_FOUND / RUN_NOT_FOUND |
| 409 | REQUEST_CONFLICT / RUN_ACTIVE / INVALID_CURSOR |
| 429 | CAPACITY_LIMIT |
| 503 | CONFIG_MISSING |
| 500 | INTERNAL_ERROR |

异步运行失败通过 errorCode 返回 CONFIG_MISSING、PROVIDER_AUTH、PROVIDER_BALANCE、PROVIDER_LIMIT、PROVIDER_INPUT、PROVIDER_ERROR、RUN_TIMEOUT、WORKER_LOST、WORKER_START_FAILED。网络及未识别的供应商异常当前归为 PROVIDER_ERROR，不打印原始 SDK 错误。

## 验证与实现位置

核心：`src/features/ai/server/run-store.ts`；调度：`run-service.ts`；供应商执行：`scripts/ai-run-worker.ts`；迁移：`drizzle/0004_flat_fixer.sql`。实际生产工作进程依赖项目内 TS 源文件与 scripts 目录，本地运行须保留源码，不能仅复制 .next 目录。

七项核心测试与真实 HTTP 离线集成检查已通过。新接口到真实 DeepSeek 的完整链路、真实进程强杀后的租约过期、超时及错误分类的供应商实测仍待补充，不视为 V1 整体验收完成。
