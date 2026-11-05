# DeepSeek 官方 API 接入笔记

核对日期为 2026-11-05。资料来自官方文档，用户已在本机验证 deepseek-flash 的短文本非流式调用，返回输入 10、输出 2、总计 12 tokens。流式及运行恢复尚待验证。模型、价格和限额可能变化，编码前重新核对。当前实施范围见 [已确认计划](agent-implementation-plan.md)。

## 对话接入

OpenAI 兼容地址为 https://api.deepseek.com，对话端点为 POST /chat/completions，使用 Authorization Bearer 密钥鉴权，消息通过 messages 提交。stream=true 开启流式输出。密钥仅由本机服务端读取。

当前文档列出 deepseek-flash 与 deepseek-v4-pro。Flash 对应 DeepSeek-V4.1-Flash-1017，官方建议使用 deepseek-flash 名称。先将 Flash 作为首期验证候选，最终默认模型在真实调用后确定。[首次调用](https://api-docs.deepseek.com/zh-cn/)

Chat Completions 不替应用保存对话上下文，每轮需提交所需历史。因此本项目在 SQLite 保存会话，后端按预算组装消息历史。[多轮对话](https://api-docs.deepseek.com/zh-cn/guides/multi_round_chat/)

## 能力与费用

官方能力表列出两款模型支持 JSON 输出、工具调用和思考模式，Flash 支持图像理解而 Pro 不支持。官方上下文上限为 1M，输出上限为 384K；本项目将设更小的运行预算。

按百万 token 计价，Flash 的高峰时段缓存命中输入为 0.04 元，未命中输入为 2 元，输出为 8 元；空闲时段各减半。官方按北京时间工作日特定时段区分高峰，实际价格以页面为准。连接测试也可能产生调用费用。[模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)

图像理解可输入 JPEG、PNG、GIF、WebP，支持内联图片、外部 URL 或 Files API 引用。后续 V3 对本地素材优先验证服务端内联输入，浏览器的 localhost 预览地址不能供远端直接读取。图片支持列表不能证明其可理解完整动画时序，APNG/GIF 的取帧行为需单独验证。看图能力与 V2 的图像生成接口分别评估。[图像理解](https://api-docs.deepseek.com/zh-cn/guides/vision/)

## 错误、等待与恢复

400、422 分别检查格式与参数，401 检查密钥，402 提示余额不足；这些错误修正前不自动反复调用。429、500、503 分别对应限流、内部错误、繁忙，应按受控退避及运行重试约定处理。网络失败可能发生在供应商接受请求之后，需要记录不确定状态。[错误码](https://api-docs.deepseek.com/zh-cn/quick_start/error_codes/)

等待响应期间，流式请求可能收到 SSE keep-alive 注释，解析时跳过注释，不把它当作回复或完成事件。官方说明等待 10 分钟仍未开始推理会关闭连接。并发按账号计算，应用自行设置更保守的并发与超时预算。[限速与隔离](https://api-docs.deepseek.com/zh-cn/quick_start/rate_limit/)

## 后续搜索能力

官方已提供独立 Search 与 Fetch 接口，分别为 POST /v1/tools/search、POST /v1/tools/fetch。Search 返回结构化网页结果，Fetch 获取 Markdown 正文，使用相同 Bearer 鉴权。

搜索参数包括 query、count 和 need_content。两类接口按成功且产生内容的请求次数计费，当前各为 5 元每千次；无结果搜索不计费。可作为 V4 搜索供应商候选，接口调用和结果引用仍由应用组织。[网页搜索与抓取](https://api-docs.deepseek.com/zh-cn/guides/search/)

## 阶段 0 仍需核实

- 本次读取思考模式专页超时，待重新阅读完整参数说明，再验证普通与思考输出、使用量和结束原因。
- assistant-ui、AI SDK 与当前 Next.js/React 版本兼容性，以及 DeepSeek 适配器对当前模型和自定义参数的支持。
- 真实流式调用、独立执行器、重复提交、断流恢复、主动停止、鉴权失败与余额不足路径。
- 后端密钥存储方案、默认模型、输出预算及首期界面。
- V2 图像生成供应商另行选定，不能从 DeepSeek 图像理解文档推定生图能力。
