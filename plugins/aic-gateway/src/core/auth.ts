import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  clearCredentials,
  ensureHome,
  loadBootstrapCache,
  loadConfig,
  loadCredentials,
  saveBootstrapCache,
  saveConfig,
  saveCredentials,
  updateConfig,
  withFileLock,
} from './store.js';
import { GatewayError, request, sleep } from './http.js';
import type { Bootstrap, Credentials, DeviceStartResponse, DeviceTokenResponse } from './types.js';

export interface LoginOptions {
  gatewayUrl?: string;
  deviceName?: string;
  noBrowser?: boolean;
  client?: string;
  piVersion?: string;
  onDeviceCode?: (info: DeviceStartResponse) => void | Promise<void>;
}

function openBrowser(url: string): void {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    // Browser launch is best-effort; the URL is printed as well.
  }
}

export async function login(options: LoginOptions = {}): Promise<Credentials> {
  let config = loadConfig();
  if (options.gatewayUrl) {
    config = updateConfig({ gateway_url: options.gatewayUrl.replace(/\/+$/, '') });
  }
  if (options.deviceName) {
    config = updateConfig({ device_name: options.deviceName });
  }

  const start = await request<DeviceStartResponse>({
    gatewayUrl: config.gateway_url,
    path: '/api/v1/plugin/auth/device',
    method: 'POST',
    body: {
      device_id: config.device_id,
      device_name: config.device_name,
      os: process.platform,
      plugin_version: '1.0.0',
      pi_version: options.piVersion ?? 'n/a',
    },
  });

  if (!options.onDeviceCode) {
    console.log('');
    console.log('  浏览器授权');
    console.log('  ─────────────────────────────────────────');
    console.log(`  授权码：${start.user_code}`);
    console.log(`  地址：  ${start.verification_uri}`);
    console.log('  ─────────────────────────────────────────');
    console.log(`  授权码 ${Math.round(start.expires_in / 60)} 分钟内有效。`);
    console.log('');
  }

  if (!options.noBrowser) {
    openBrowser(start.verification_uri);
  }
  if (options.onDeviceCode) {
    await options.onDeviceCode(start);
  }

  const deadline = Date.now() + start.expires_in * 1000;
  let interval = Math.max(1, start.interval || 2);
  while (Date.now() < deadline) {
    await sleep(interval * 1000);
    let token: DeviceTokenResponse;
    try {
      token = await request<DeviceTokenResponse>({
        gatewayUrl: config.gateway_url,
        path: '/api/v1/plugin/auth/device/token',
        method: 'POST',
        body: { device_code: start.device_code },
        timeoutMs: 10_000,
      });
    } catch (error) {
      if (error instanceof GatewayError && error.status === 403) {
        throw new GatewayError('用户拒绝授权或账号已停用，请重试。', 403, 'login_denied');
      }
      if (error instanceof GatewayError && error.status === 400) {
        throw new GatewayError('授权码已过期，请重新执行 aic login。', 400, 'login_expired');
      }
      throw error;
    }

    if (token.status === 'pending') {
      interval = token.interval ?? interval;
      continue;
    }
    if (token.status === 'approved' && token.access_token && token.refresh_token) {
      const now = Date.now();
      const credentials: Credentials = {
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_at: new Date(now + (token.expires_in ?? 900) * 1000).toISOString(),
        refresh_expires_at: new Date(now + (token.refresh_expires_in ?? 30 * 86400) * 1000).toISOString(),
        user: token.user,
        device_id: token.device_id ?? config.device_id,
        gateway_url: config.gateway_url,
      };
      saveCredentials(credentials);
      saveConfig({ ...loadConfig(), device_id: credentials.device_id });
      try {
        const bootstrap = await fetchBootstrap({ force: true });
        if (!options.onDeviceCode) {
          console.log(`已登录：${bootstrap.user?.name ?? token.user?.name ?? '用户'} · ${bootstrap.models.length} 个可用模型 · ${bootstrap.projects.length} 个项目`);
        }
      } catch (error) {
        if (!options.onDeviceCode) {
          console.log(`登录成功，但加载模型目录失败：${(error as Error).message}`);
        }
      }
      return credentials;
    }
    throw new GatewayError(`登录未完成：${token.status}`, 400, token.status);
  }
  throw new GatewayError('授权码已过期，请重新执行 aic login。', 400, 'login_expired');
}

export async function refreshAccessToken(): Promise<Credentials> {
  const config = loadConfig();
  const credentials = loadCredentials();
  if (!credentials) {
    throw new GatewayError('尚未登录，请先执行 aic login。', 401, 'not_logged_in');
  }
  if (credentials.gateway_url !== config.gateway_url) {
    throw new GatewayError('网关地址已变更，请重新执行 aic login。', 401, 'gateway_changed');
  }
  if (new Date(credentials.refresh_expires_at).getTime() < Date.now()) {
    throw new GatewayError('登录已过期，请重新执行 aic login。', 401, 'refresh_expired');
  }

  const result = await request<DeviceTokenResponse>({
    gatewayUrl: config.gateway_url,
    path: '/api/v1/plugin/auth/refresh',
    method: 'POST',
    body: { refresh_token: credentials.refresh_token, device_id: credentials.device_id },
    timeoutMs: 15_000,
  });
  if (!result.access_token || !result.refresh_token) {
    throw new GatewayError('刷新令牌失败，请重新执行 aic login。', 401, 'refresh_failed');
  }
  const now = Date.now();
  const next: Credentials = {
    access_token: result.access_token,
    refresh_token: result.refresh_token,
    expires_at: new Date(now + (result.expires_in ?? 900) * 1000).toISOString(),
    refresh_expires_at: new Date(now + (result.refresh_expires_in ?? 30 * 86400) * 1000).toISOString(),
    user: result.user ?? credentials.user,
    device_id: result.device_id ?? credentials.device_id,
    gateway_url: config.gateway_url,
  };
  saveCredentials(next);
  return next;
}

export async function getAccessToken(options: { forceRefresh?: boolean } = {}): Promise<string> {
  let credentials = loadCredentials();
  if (!credentials) throw new GatewayError('尚未登录，请先执行 aic login。', 401, 'not_logged_in');

  const expiresAt = new Date(credentials.expires_at).getTime();
  if (!options.forceRefresh && expiresAt - 60_000 > Date.now()) {
    return credentials.access_token;
  }

  return withFileLock('token-refresh', async () => {
    credentials = loadCredentials();
    if (!credentials) throw new GatewayError('尚未登录，请先执行 aic login。', 401, 'not_logged_in');
    if (!options.forceRefresh && new Date(credentials.expires_at).getTime() - 60_000 > Date.now()) {
      return credentials.access_token;
    }
    const refreshed = await refreshAccessToken();
    return refreshed.access_token;
  });
}

export async function fetchBootstrap(options: { force?: boolean; ttlSeconds?: number } = {}): Promise<Bootstrap> {
  const config = loadConfig();
  const cache = loadBootstrapCache();
  const ttl = (options.ttlSeconds ?? 300) * 1000;
  if (!options.force && cache && Date.now() - new Date(cache.fetched_at).getTime() < ttl) {
    return cache.bootstrap;
  }

  const call = async (forceRefresh = false) => {
    const token = await getAccessToken({ forceRefresh });
    try {
      return await request<Bootstrap>({
        gatewayUrl: config.gateway_url,
        path: '/api/v1/plugin/bootstrap',
        token,
        timeoutMs: 15_000,
      });
    } catch (error) {
      if (error instanceof GatewayError && error.status === 401 && !forceRefresh) {
        return call(true);
      }
      throw error;
    }
  };

  const bootstrap = await call(false);
  saveBootstrapCache(bootstrap);
  return bootstrap;
}

export async function logout(): Promise<void> {
  const config = loadConfig();
  const credentials = loadCredentials();
  if (credentials) {
    try {
      const token = await getAccessToken();
      await request({
        gatewayUrl: config.gateway_url,
        path: '/api/v1/plugin/auth/logout',
        method: 'POST',
        token,
        body: { refresh_token: credentials.refresh_token },
        timeoutMs: 10_000,
      });
    } catch {
      // Local logout still proceeds if the gateway is unreachable.
    }
  }
  clearCredentials();
  try {
    fs.unlinkSync(path.join(ensureHome(), 'bootstrap.json'));
  } catch {
    // ignore
  }
}

export interface PublicCatalog {
  config_version: string;
  gateway_base_url: string;
  catalog_snapshot_id?: string;
  models: Bootstrap['models'];
}

export async function fetchPublicCatalog(timeoutMs = 2000): Promise<PublicCatalog | null> {
  const config = loadConfig();
  const cachePath = path.join(ensureHome(), 'catalog.json');
  try {
    const catalog = await request<PublicCatalog>({
      gatewayUrl: config.gateway_url,
      path: '/api/v1/plugin/catalog',
      timeoutMs,
    });
    try {
      fs.writeFileSync(cachePath, JSON.stringify(catalog, null, 2) + '\n');
    } catch {
      // cache is best-effort
    }
    return catalog;
  } catch {
    try {
      return JSON.parse(fs.readFileSync(cachePath, 'utf8')) as PublicCatalog;
    } catch {
      return null;
    }
  }
}

export function getCredentialSummary(): { loggedIn: boolean; user?: string; expiresAt?: string; gateway?: string; deviceId?: string } {
  const credentials = loadCredentials();
  const config = loadConfig();
  if (!credentials) return { loggedIn: false, gateway: config.gateway_url, deviceId: config.device_id };
  return {
    loggedIn: true,
    user: credentials.user?.name,
    expiresAt: credentials.expires_at,
    gateway: credentials.gateway_url,
    deviceId: credentials.device_id,
  };
}