export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;

  constructor(message: string, status: number, code = 'request_failed', requestId: string | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

const base = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

function cookie(name: string): string | null {
  const entry = document.cookie.split('; ').find((item) => item.startsWith(name + '='));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : null;
}

function ensureCsrfCookie(): Promise<void> {
  if (cookie('aic_csrf')) return Promise.resolve();
  return fetch(`${base}/api/v1/auth/csrf`, { credentials: 'include' }).then(() => undefined).catch(() => undefined);
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (method !== 'GET' && method !== 'HEAD') {
    await ensureCsrfCookie();
    const token = cookie('aic_csrf');
    if (token) headers.set('X-CSRF-Token', token);
  }

  const response = await fetch(`${base}${path}`, {
    ...init,
    method,
    headers,
    credentials: 'include',
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    const envelope = body as { error?: { code?: string; message?: string; request_id?: string } } | null;
    const message =
      envelope?.error?.message ??
      (typeof body === 'string' && body.length < 300 ? body : null) ??
      `请求失败（HTTP ${response.status}）`;
    throw new ApiError(message, response.status, envelope?.error?.code ?? 'request_failed', envelope?.error?.request_id ?? null);
  }

  return body as T;
}

export function apiUrl(path: string): string {
  return `${base}${path}`;
}

export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const response = await fetch(`${base}${path}`, { credentials: 'include' });
  if (!response.ok) {
    throw new ApiError('导出失败，请稍后重试。', response.status);
  }
  const blob = await response.blob();
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  const name = match?.[1] ? decodeURIComponent(match[1]) : fallbackName;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}