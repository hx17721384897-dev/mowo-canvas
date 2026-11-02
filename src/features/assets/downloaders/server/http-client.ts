import "server-only";

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Agent, ProxyAgent, request, type Dispatcher } from "undici";

const DEFAULT_HEADERS = {
  "accept": "*/*",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
};

export class DownloadHttpError extends Error {
  constructor(readonly code: "network" | "http_status" | "too_large" | "invalid_response", message: string) {
    super(message);
  }
}

const execFileAsync = promisify(execFile);

async function detectWindowsProxy() {
  if (process.platform !== "win32") return undefined;
  try {
    const key = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";
    const [{ stdout: enabledOutput }, { stdout: serverOutput }] = await Promise.all([
      execFileAsync("reg.exe", ["query", key, "/v", "ProxyEnable"], { windowsHide: true, timeout: 3_000 }),
      execFileAsync("reg.exe", ["query", key, "/v", "ProxyServer"], { windowsHide: true, timeout: 3_000 }),
    ]);
    if (!/ProxyEnable\s+REG_DWORD\s+0x1/i.test(enabledOutput)) return undefined;
    const raw = serverOutput.match(/ProxyServer\s+REG_SZ\s+([^\r\n]+)/i)?.[1]?.trim();
    if (!raw) return undefined;
    const entries = Object.fromEntries(raw.split(";").map((value) => value.split("=", 2)).filter((value) => value.length === 2));
    const server = entries.https || entries.http || raw;
    return server.includes("://") ? server : `http://${server}`;
  } catch {
    return undefined;
  }
}

async function createDispatcher(): Promise<Dispatcher> {
  const proxy = process.env.MOWO_HTTP_PROXY?.trim() || await detectWindowsProxy();
  if (!proxy) return new Agent({ connect: { timeout: 10_000 } });

  const parsed = new URL(proxy);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new DownloadHttpError("network", "下载代理只支持 HTTP 或 HTTPS 地址");
  }
  return new ProxyAgent({ uri: parsed.toString() });
}

export async function createDownloadHttpClient() {
  const dispatcher = await createDispatcher();

  const getBytes = async (url: URL, maxBytes: number, signal: AbortSignal) => {
    let response;
    try {
      response = await request(url, {
        dispatcher,
        headers: DEFAULT_HEADERS,
        headersTimeout: 12_000,
        bodyTimeout: 20_000,
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new DownloadHttpError("network", "无法连接资源服务器，请检查网络或代理设置");
    }

    if (response.statusCode !== 200) {
      await response.body.dump();
      throw new DownloadHttpError("http_status", `资源服务器返回 ${response.statusCode}`);
    }

    const declaredLength = Number(response.headers["content-length"] ?? 0);
    if (declaredLength > maxBytes) {
      await response.body.dump();
      throw new DownloadHttpError("too_large", "下载内容超过允许大小");
    }

    const chunks: Buffer[] = [];
    let received = 0;
    for await (const chunk of response.body) {
      const buffer = Buffer.from(chunk);
      received += buffer.length;
      if (received > maxBytes) {
        response.body.destroy();
        throw new DownloadHttpError("too_large", "下载内容超过允许大小");
      }
      chunks.push(buffer);
    }
    return Buffer.concat(chunks, received);
  };

  return {
    getBytes,
    async getJson<T>(url: URL, maxBytes: number, signal: AbortSignal): Promise<T> {
      const data = await getBytes(url, maxBytes, signal);
      try {
        return JSON.parse(data.toString("utf8")) as T;
      } catch {
        throw new DownloadHttpError("invalid_response", "平台返回了无法识别的数据");
      }
    },
    async close() {
      await dispatcher.destroy();
    },
  };
}
