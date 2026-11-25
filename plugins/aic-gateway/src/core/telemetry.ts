import fs from 'node:fs';
import path from 'node:path';
import { queueDir, loadConfig, loadCredentials, withFileLock, ensureHome } from './store.js';
import { getAccessToken } from './auth.js';
import { GatewayError, randomId, request } from './http.js';
import type { TelemetryEvent } from './types.js';

function queueFile(): string {
  return path.join(queueDir(), 'events.jsonl');
}

export function enqueueEvent(event: Omit<TelemetryEvent, 'event_id' | 'occurred_at'> & { event_id?: string; occurred_at?: string }): TelemetryEvent {
  const full: TelemetryEvent = {
    event_id: event.event_id ?? randomId('evt'),
    occurred_at: event.occurred_at ?? new Date().toISOString(),
    type: event.type,
    session_id: event.session_id ?? process.env.AIC_SESSION_ID ?? null,
    project_key: event.project_key ?? process.env.AIC_PROJECT ?? null,
    payload: event.payload,
  };
  const file = queueFile();
  fs.appendFileSync(file, JSON.stringify(full) + '\n', { mode: 0o600 });
  trimQueue(file);
  return full;
}

function trimQueue(file: string): void {
  try {
    const stat = fs.statSync(file);
    if (stat.size <= 10 * 1024 * 1024) return;
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n').slice(-5000);
    fs.writeFileSync(file, lines.join('\n') + '\n', { mode: 0o600 });
  } catch {
    // ignore
  }
}

export function queueDepth(): number {
  try {
    const content = fs.readFileSync(queueFile(), 'utf8').trim();
    return content ? content.split('\n').length : 0;
  } catch {
    return 0;
  }
}

export interface FlushResult {
  accepted: number;
  duplicates: number;
  remaining: number;
}

export async function flushTelemetry(options: { maxBatches?: number } = {}): Promise<FlushResult> {
  const config = loadConfig();
  if (!config.telemetry) return { accepted: 0, duplicates: 0, remaining: queueDepth() };

  return withFileLock('telemetry-flush', async () => {
    const file = queueFile();
    let lines: string[];
    try {
      lines = fs.readFileSync(file, 'utf8').split('\n').filter((line) => line.trim());
    } catch {
      return { accepted: 0, duplicates: 0, remaining: 0 };
    }
    if (lines.length === 0) return { accepted: 0, duplicates: 0, remaining: 0 };

    let accepted = 0;
    let duplicates = 0;
    let sent = 0;
    const maxBatches = options.maxBatches ?? 5;

    for (let batchIndex = 0; batchIndex < maxBatches; batchIndex++) {
      const batchLines = lines.slice(0, 100);
      if (batchLines.length === 0) break;
      const events: TelemetryEvent[] = [];
      for (const line of batchLines) {
        try {
          events.push(JSON.parse(line) as TelemetryEvent);
        } catch {
          // Drop malformed lines by advancing the offset.
        }
      }

const credentials = loadCredentials();
    if (!credentials) return { accepted: 0, duplicates: 0, remaining: lines.length };
    const deviceId = credentials.device_id;
    const attempt = async (forceRefresh = false) => {
      const token = await getAccessToken({ forceRefresh });
      return request<{ accepted: number; duplicates: number }>({
        gatewayUrl: config.gateway_url,
        path: '/api/v1/plugin/telemetry/batch',
        method: 'POST',
        token,
        timeoutMs: 15_000,
        body: {
          batch_id: randomId('batch'),
          device_id: deviceId,
            plugin_version: '1.0.0',
            events,
          },
        });
      };

      try {
        let result;
        try {
          result = await attempt(false);
        } catch (error) {
          if (error instanceof GatewayError && error.status === 401) {
            result = await attempt(true);
          } else {
            throw error;
          }
        }
        accepted += result.accepted;
        duplicates += result.duplicates;
        sent += batchLines.length;
        lines = lines.slice(batchLines.length);
      } catch {
        break;
      }
    }

    if (sent > 0) {
      const remaining = lines.join('\n');
      const temp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(temp, remaining ? remaining + '\n' : '', { mode: 0o600 });
      fs.renameSync(temp, file);
    }

    return { accepted, duplicates, remaining: lines.length };
  });
}

export function recordToolDecision(options: {
  toolName: string;
  toolCallId: string;
  risk: string;
  action: string;
  source: string;
  latencyMs: number;
  policyVersion: string;
  projectKey?: string | null;
  sessionId?: string | null;
}): TelemetryEvent {
  return enqueueEvent({
    type: 'tool_decision',
    project_key: options.projectKey ?? null,
    session_id: options.sessionId ?? null,
    payload: {
      tool_call_id: options.toolCallId,
      tool_name: options.toolName,
      risk: options.risk,
      action: options.action,
      source: options.source,
      latency_ms: options.latencyMs,
      policy_version: options.policyVersion,
    },
  });
}

export function recordSessionStarted(options: {
  sessionId: string;
  client: string;
  projectKey: string | null;
  projectName?: string | null;
  repoHash?: string;
  repoDisplay?: string;
  cwdBasename?: string;
  model?: string;
}): TelemetryEvent {
  return enqueueEvent({
    type: 'session_started',
    session_id: options.sessionId,
    project_key: options.projectKey,
    payload: {
      client: options.client,
      project_name: options.projectName,
      cwd_basename: options.cwdBasename,
      repo_hash: options.repoHash,
      repo_display: options.repoDisplay,
      model: options.model,
    },
  });
}

export function recordSessionEnded(options: { sessionId: string; projectKey: string | null; turns: number; toolCalls: number }): TelemetryEvent {
  return enqueueEvent({
    type: 'session_ended',
    session_id: options.sessionId,
    project_key: options.projectKey,
    payload: {
      turns: options.turns,
      tool_calls: options.toolCalls,
    },
  });
}

/**
 * Ensures a session_started event exists for hook-only flows (Claude Code hooks
 * can run without the wrapper). The marker is local metadata only.
 */
export function ensureSessionStarted(options: {
  sessionId: string;
  client: string;
  projectKey: string | null;
  projectName?: string | null;
  repoHash?: string;
  repoDisplay?: string;
  cwdBasename?: string;
  model?: string;
}): TelemetryEvent | null {
  const dir = path.join(ensureHome(), 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  const safe = options.sessionId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  const marker = path.join(dir, `${safe}.json`);
  try {
    const stat = fs.statSync(marker);
    if (Date.now() - stat.mtimeMs < 24 * 3600_000) return null;
  } catch {
    // create below
  }
  const event = recordSessionStarted(options);
  try {
    fs.writeFileSync(marker, JSON.stringify({ session_id: options.sessionId, started_at: new Date().toISOString(), client: options.client }) + '\n', {
      mode: 0o600,
    });
  } catch {
    // ignore
  }
  return event;
}