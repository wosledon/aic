import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type { AicConfig, Bootstrap, Credentials } from './types.js';

const DEFAULT_GATEWAY = 'http://localhost:5080';

export function aicHome(): string {
  return process.env.AIC_HOME ? path.resolve(process.env.AIC_HOME) : path.join(os.homedir(), '.aic');
}

export function ensureHome(): string {
  const home = aicHome();
  fs.mkdirSync(home, { recursive: true });
  return home;
}

export function configPath(): string {
  return path.join(ensureHome(), 'config.json');
}

export function credentialsPath(): string {
  return path.join(ensureHome(), 'credentials.json');
}

export function bootstrapPath(): string {
  return path.join(ensureHome(), 'bootstrap.json');
}

export function queueDir(): string {
  const dir = path.join(ensureHome(), 'queue');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

function writeJsonAtomic(file: string, value: unknown, mode = 0o600): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode });
  fs.renameSync(temp, file);
  try {
    fs.chmodSync(file, mode);
  } catch {
    // Windows may ignore POSIX modes.
  }
}

export function createDeviceId(): string {
  return 'dev_' + crypto.randomBytes(12).toString('hex');
}

export function loadConfig(): AicConfig {
  const saved = readJson<Partial<AicConfig>>(configPath()) ?? {};
  const gateway = process.env.AIC_GATEWAY_URL ?? saved.gateway_url ?? DEFAULT_GATEWAY;
  const config: AicConfig = {
    gateway_url: gateway.replace(/\/+$/, ''),
    device_id: saved.device_id ?? createDeviceId(),
    device_name: saved.device_name ?? os.hostname(),
    default_project: saved.default_project ?? null,
    default_model: saved.default_model ?? null,
    telemetry: saved.telemetry ?? true,
    policy_cache_ttl_seconds: saved.policy_cache_ttl_seconds ?? 300,
    debug: saved.debug ?? false,
  };
  if (!saved.device_id) saveConfig(config);
  return config;
}

export function saveConfig(config: AicConfig): void {
  writeJsonAtomic(configPath(), config);
}

export function updateConfig(patch: Partial<AicConfig>): AicConfig {
  const next = { ...loadConfig(), ...patch };
  saveConfig(next);
  return next;
}

export function loadCredentials(): Credentials | null {
  return readJson<Credentials>(credentialsPath());
}

export function saveCredentials(credentials: Credentials): void {
  writeJsonAtomic(credentialsPath(), credentials);
}

export function clearCredentials(): void {
  try {
    fs.unlinkSync(credentialsPath());
  } catch {
    // already absent
  }
}

export function loadBootstrapCache(): { fetched_at: string; bootstrap: Bootstrap } | null {
  return readJson<{ fetched_at: string; bootstrap: Bootstrap }>(bootstrapPath());
}

export function saveBootstrapCache(bootstrap: Bootstrap): void {
  writeJsonAtomic(bootstrapPath(), { fetched_at: new Date().toISOString(), bootstrap });
}

export function debugLog(message: string, ...args: unknown[]): void {
  if (loadConfig().debug) {
    console.error(`[aic] ${message}`, ...args);
  }
}

/** Atomically writes a file only used by this process family. */
export function withFileLock<T>(name: string, fn: () => Promise<T>, staleMs = 30_000): Promise<T> {
  const lockPath = path.join(ensureHome(), name + '.lock');
  const started = Date.now();
  const attempt = (): Promise<T> => {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(fd, String(process.pid));
      fs.closeSync(fd);
      return Promise.resolve(fn()).finally(() => {
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // ignore
        }
      });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') {
        try {
          const stat = fs.statSync(lockPath);
          if (Date.now() - stat.mtimeMs > staleMs) {
            fs.unlinkSync(lockPath);
            return attempt();
          }
        } catch {
          // ignore
        }
        if (Date.now() - started > staleMs) {
          return Promise.reject(new Error('等待本地令牌锁超时，请重试。'));
        }
        return new Promise((resolve) => setTimeout(resolve, 100)).then(attempt);
      }
      return Promise.reject(error);
    }
  };
  return attempt();
}