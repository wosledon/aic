export class GatewayError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 0, code = 'request_failed') {
    super(message);
    this.name = 'GatewayError';
    this.status = status;
    this.code = code;
  }
}

export interface RequestOptions {
  gatewayUrl: string;
  path: string;
  method?: string;
  token?: string | null;
  body?: unknown;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export async function request<T>(options: RequestOptions): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(options.headers ?? {}),
    };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.token) headers.Authorization = `Bearer ${options.token}`;

    let response: Response;
    try {
      response = await fetch(options.gatewayUrl.replace(/\/+$/, '') + options.path, {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new GatewayError('网关请求超时，请检查网络或网关地址。', 0, 'timeout');
      }
      throw new GatewayError(`无法连接网关：${(error as Error).message}`, 0, 'network_error');
    }

    if (response.status === 204) return undefined as T;
    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }
    if (!response.ok) {
      const envelope = payload as { error?: { code?: string; message?: string } } | null;
      const message =
        envelope?.error?.message ??
        (typeof payload === 'string' && payload.length < 300 ? payload : null) ??
        `网关返回 HTTP ${response.status}`;
      throw new GatewayError(message, response.status, envelope?.error?.code ?? 'request_failed');
    }
    return payload as T;
  } finally {
    clearTimeout(timeout);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function randomId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${random}`;
}