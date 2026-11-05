const key = process.env.DEEPSEEK_API_KEY?.trim();

if (!key) {
  console.error("未配置 DEEPSEEK_API_KEY，请在本机 .env.local 中填写。");
  process.exitCode = 1;
} else if (!process.argv.includes("--live")) {
  console.log("密钥已配置。执行 --live 才会发起一次可能计费的 API 请求。");
} else {
  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek-flash",
        messages: [{ role: "user", content: "请只回复：连接成功" }],
        thinking: { type: "disabled" },
        max_tokens: 64,
        stream: false,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    const errors = {
      400: "请求格式无效",
      401: "密钥无效",
      402: "API 余额不足",
      422: "模型或参数无效",
      429: "请求限流",
      500: "供应商内部错误",
      503: "供应商繁忙",
    };
    if (!response.ok) {
      console.error(`连接检查失败，HTTP ${response.status}：${errors[response.status] ?? "请核对官方错误说明"}`);
      process.exitCode = 1;
    } else {
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) {
        console.error("HTTP 请求成功，但未获得有效文本回复，需要核对模型输出。");
        process.exitCode = 1;
      } else {
        console.log("已收到有效模型回复，基本调用成功。");
        console.log(JSON.stringify({ model: data.model, usage: data.usage }));
      }
    }
  } catch (error) {
    console.error(error?.name === "TimeoutError" ? "连接检查超时，未自动重试。" : "连接检查异常，请检查网络或代理，未自动重试。");
    process.exitCode = 1;
  }
}
