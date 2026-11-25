/**
 * Pi coding agent extension for AIControl.
 *
 * Registers a gateway provider, device-code login, project attribution,
 * approval gate and metadata-only telemetry. The host injects `pi`; all
 * optional APIs are called defensively so minor Pi versions stay compatible.
 */
import { fileURLToPath } from 'node:url';
import { login, logout, fetchBootstrap, fetchPublicCatalog, getAccessToken, getCredentialSummary } from './core/auth.js';
import { resolveProject, readProjectConfig } from './core/project.js';
import { decideApproval, recordAndReport, hasInteractiveTty } from './core/approval.js';
import { classifyRisk, policyRule } from './core/policy.js';
import {
  enqueueEvent,
  flushTelemetry,
  queueDepth,
  recordSessionEnded,
  recordSessionStarted,
  recordToolDecision,
} from './core/telemetry.js';
import { loadBootstrapCache, loadConfig, updateConfig } from './core/store.js';
import { request } from './core/http.js';
import type { Bootstrap, BootstrapModel, MeUsage } from './core/types.js';

const PROVIDER = 'aic-gateway';
const PLUGIN_VERSION = '1.0.0';
const CLI_PATH = fileURLToPath(new URL('./bin-aic.js', import.meta.url));
const API_KEY_COMMAND = `!node ${JSON.stringify(CLI_PATH)} print-token`;

interface PiLike {
  registerProvider?: (id: string, config: unknown) => void;
  on?: (event: string, handler: (event: any, ctx: any) => unknown) => void;
  registerCommand?: (name: string, options: unknown) => void;
  addCommand?: (options: unknown) => void;
  appendEntry?: (type: string, data: unknown) => void;
}

let bootstrap: Bootstrap | null = null;
let sessionId: string | null = null;
let projectKey: string | null = null;
let currentModel: string | null = null;
let turnIndex = 0;
let startedAt = new Date().toISOString();
let lastProjectSource = 'unattributed';

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function notify(ctx: any, message: string, level: 'info' | 'warning' | 'error' = 'info'): void {
  try {
    if (ctx?.ui?.notify) {
      ctx.ui.notify(message, level);
      return;
    }
    if (ctx?.ui?.print) {
      ctx.ui.print(message);
      return;
    }
  } catch {
    // fall through
  }
  console.log(message);
}

function registerCommand(pi: PiLike, name: string, description: string, handler: (args: string, ctx: any) => Promise<void> | void): void {
  try {
    if (typeof pi.registerCommand === 'function') {
      pi.registerCommand(name, { description, handler });
    } else if (typeof pi.addCommand === 'function') {
      pi.addCommand({ name, description, handler });
    }
  } catch {
    // Ignore unsupported command APIs.
  }
}

function toPiModel(model: BootstrapModel): Record<string, unknown> {
  return {
    id: model.id,
    name: model.display_name,
    api: model.api,
    baseUrl: model.base_url,
    reasoning: model.reasoning,
    input: model.input,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: model.context_window,
    maxTokens: model.max_tokens,
    ...(model.thinking_level_map ? { thinkingLevelMap: model.thinking_level_map } : {}),
  };
}

function providerConfig(pi: PiLike, models: BootstrapModel[], gatewayUrl: string): Record<string, unknown> {
  return {
    name: 'AIC Gateway (Feishu)',
    baseUrl: gatewayUrl,
    api: models[0]?.api ?? 'anthropic-messages',
    apiKey: API_KEY_COMMAND,
    models: models.map(toPiModel),
    oauth: {
      name: 'AIC Gateway (Feishu)',
      async login(callbacks: any) {
        const credentials = await login({
          noBrowser: true,
          piVersion: process.env.PI_VERSION ?? 'unknown',
          onDeviceCode: async (info: any) => {
            try {
              callbacks?.onDeviceCode?.({
                userCode: info.user_code,
                verificationUri: info.verification_uri,
                expiresInSeconds: info.expires_in,
                intervalSeconds: info.interval,
                openBrowserOnConfirm: true,
                copyCodeOnConfirm: true,
              });
            } catch {
              // still poll
            }
          },
        });
        try {
          bootstrap = await fetchBootstrap({ force: true });
          registerProviderConfig(pi, bootstrap.models, loadConfig().gateway_url);
        } catch {
          // bootstrap is best-effort here
        }
        return {
          access: credentials.access_token,
          refresh: credentials.refresh_token,
          expires: Date.parse(credentials.expires_at),
        };
      },
      async refreshToken(credentials: any) {
        const config = loadConfig();
        const refreshed = await request<{ access_token: string; refresh_token: string; expires_in: number }>({
          gatewayUrl: config.gateway_url,
          path: '/api/v1/plugin/auth/refresh',
          method: 'POST',
          body: { refresh_token: credentials.refresh, device_id: config.device_id },
        });
        return {
          access: refreshed.access_token,
          refresh: refreshed.refresh_token,
          expires: Date.now() + refreshed.expires_in * 1000,
        };
      },
      getApiKey(credentials: any) {
        return credentials?.access;
      },
    },
  };
}

function registerProviderConfig(pi: PiLike, models: BootstrapModel[], gatewayUrl: string): void {
  try {
    pi.registerProvider?.(PROVIDER, providerConfig(pi, models, gatewayUrl));
  } catch (error) {
    console.error('[aic] registerProvider failed', error);
  }
}

async function registerProvider(pi: PiLike): Promise<void> {
  const config = loadConfig();
  const cached = loadBootstrapCache()?.bootstrap;
  if (cached) bootstrap = cached;

  // Await the public catalog in the async extension factory so models are
  // available to `pi --list-models` and startup model selection.
  const catalog = await fetchPublicCatalog(2000);
  const models = catalog && catalog.models.length > 0 ? catalog.models : bootstrap?.models ?? [];
  bootstrap = {
    ...(bootstrap ?? ({} as Bootstrap)),
    models,
    projects: bootstrap?.projects ?? [],
    repo_mappings: bootstrap?.repo_mappings ?? [],
    approval_policy: bootstrap?.approval_policy ?? { version: 'default', rules: [], no_ui: 'deny' },
    telemetry: bootstrap?.telemetry ?? { enabled: true, batch_size: 100, interval_seconds: 60 },
    config_version: catalog?.config_version ?? bootstrap?.config_version ?? 'none',
  } as Bootstrap;
  registerProviderConfig(pi, models, catalog?.gateway_base_url ?? config.gateway_url);
}

function restoreProject(ctx: any): void {
  try {
    const entries = ctx?.sessionManager?.getEntries?.() ?? ctx?.entries ?? [];
    for (const entry of [...entries].reverse()) {
      if (entry?.type === 'aic.session' && typeof entry?.data?.projectKey === 'string') {
        projectKey = entry.data.projectKey;
        lastProjectSource = entry.data.source ?? 'explicit';
        return;
      }
    }
  } catch {
    // ignore
  }
  const configProject = readProjectConfig(ctx?.cwd ?? process.cwd());
  if (configProject) {
    projectKey = configProject;
    lastProjectSource = 'project_config';
    return;
  }
  const resolved = resolveProject(ctx?.cwd ?? process.cwd());
  projectKey = resolved.key;
  lastProjectSource = resolved.source;
}

async function ensureBootstrap(force = false): Promise<Bootstrap | null> {
  try {
    bootstrap = await fetchBootstrap({ force, ttlSeconds: loadConfig().policy_cache_ttl_seconds });
    return bootstrap;
  } catch {
    return bootstrap ?? loadBootstrapCache()?.bootstrap ?? null;
  }
}

export default async function activate(pi: PiLike): Promise<void> {
  if (process.env.AIC_EXTENSION_DEBUG === '1') {
    console.error('[aic] Pi extension activating');
  }
  await registerProvider(pi);
  if (process.env.AIC_EXTENSION_DEBUG === '1') {
    console.error(`[aic] provider registered with ${bootstrap?.models.length ?? 0} models`);
  }

  pi.on?.('session_start', async (_event: any, ctx: any) => {
    sessionId = textOf(ctx?.sessionId) ?? textOf(ctx?.session?.id) ?? `pi_${Date.now()}`;
    turnIndex = 0;
    startedAt = new Date().toISOString();
    restoreProject(ctx);
    await ensureBootstrap();
    recordSessionStarted({
      sessionId,
      client: 'pi',
      projectKey,
      projectName: bootstrap?.projects.find((project) => project.key === projectKey)?.name ?? null,
      repoHash: resolveProject(ctx?.cwd ?? process.cwd()).repo_hash,
      repoDisplay: resolveProject(ctx?.cwd ?? process.cwd()).repo_display,
      cwdBasename: ctx?.cwd ? String(ctx.cwd).split(/[\\/]/).pop() : undefined,
      model: currentModel ?? undefined,
    });
  });

  pi.on?.('before_provider_headers', async (event: any, ctx: any) => {
    const provider = ctx?.model?.provider ?? event?.provider?.id ?? event?.provider ?? event?.providerId;
    if (provider !== PROVIDER) return;
    const headers: Record<string, string> =
      event?.headers && typeof event.headers === 'object' && !Array.isArray(event.headers) ? event.headers : {};
    if (projectKey) headers['X-AIC-Project'] = projectKey;
    if (sessionId) headers['X-AIC-Session'] = sessionId;
    headers['X-AIC-Turn'] = String(turnIndex);
    headers['X-AIC-Device'] = loadConfig().device_id;
    headers['X-AIC-Plugin-Version'] = PLUGIN_VERSION;
    headers['X-AIC-Client'] = 'pi';
    if (event?.headers) return;
    return { headers };
  });

  pi.on?.('tool_call', async (event: any, ctx: any) => {
    if ((ctx?.model?.provider ?? event?.provider) !== PROVIDER) return;
    const toolName = String(event?.toolName ?? event?.tool?.name ?? event?.name ?? 'unknown');
    const policy = (await ensureBootstrap(true))?.approval_policy;
    const risk = classifyRisk(toolName, event?.args ?? event?.input);
    const rule = policyRule(policy, risk);

    if (rule === 'allow') {
      recordToolDecision({
        toolName,
        toolCallId: String(event?.toolCallId ?? `call_${Date.now()}`),
        risk,
        action: 'auto_allowed',
        source: 'policy',
        latencyMs: 0,
        policyVersion: policy?.version ?? 'default',
        projectKey,
        sessionId,
      });
      return;
    }
    if (rule === 'deny') {
      recordToolDecision({
        toolName,
        toolCallId: String(event?.toolCallId ?? `call_${Date.now()}`),
        risk,
        action: 'policy_denied',
        source: 'policy',
        latencyMs: 0,
        policyVersion: policy?.version ?? 'default',
        projectKey,
        sessionId,
      });
      return { block: true, reason: 'Blocked by AIC policy' };
    }

    const hasUI = Boolean(ctx?.hasUI ?? hasInteractiveTty());
    if (!hasUI || typeof ctx?.ui?.confirm !== 'function') {
      recordToolDecision({
        toolName,
        toolCallId: String(event?.toolCallId ?? `call_${Date.now()}`),
        risk,
        action: 'policy_denied',
        source: 'policy_no_ui',
        latencyMs: 0,
        policyVersion: policy?.version ?? 'default',
        projectKey,
        sessionId,
      });
      return { block: true, reason: 'Approval required, but no interactive UI is available' };
    }

    const started = Date.now();
    const approved = await ctx.ui.confirm(
      'AIC 审批',
      `允许执行 ${toolName}？\n风险：${risk}\n项目：${projectKey ?? '未归因'}`,
    );
    recordToolDecision({
      toolName,
      toolCallId: String(event?.toolCallId ?? `call_${Date.now()}`),
      risk,
      action: approved ? 'approved' : 'rejected',
      source: 'user',
      latencyMs: Date.now() - started,
      policyVersion: policy?.version ?? 'default',
      projectKey,
      sessionId,
    });
    void flushTelemetry({ maxBatches: 1 });
    if (!approved) return { block: true, reason: 'User rejected this tool call' };
  });

  pi.on?.('turn_end', async (event: any, ctx: any) => {
    turnIndex++;
    const usage = event?.usage ?? event?.message?.usage ?? event?.result?.usage ?? {};
    currentModel = textOf(ctx?.model?.id) ?? textOf(event?.model) ?? currentModel;
    enqueueEvent({
      type: 'turn_completed',
      session_id: sessionId,
      project_key: projectKey,
      payload: {
        turn_index: turnIndex,
        model: currentModel,
        client: 'pi',
        request_id: textOf(event?.requestId) ?? textOf(ctx?.lastRequestId),
        latency_ms: Number(event?.durationMs ?? event?.latencyMs ?? 0),
        outcome: textOf(event?.outcome) ?? 'completed',
        usage: {
          input_tokens: Number(usage.input_tokens ?? usage.inputTokens ?? 0),
          output_tokens: Number(usage.output_tokens ?? usage.outputTokens ?? 0),
          cache_read_tokens: Number(usage.cache_read_tokens ?? usage.cacheReadTokens ?? 0),
          cache_write_tokens: Number(usage.cache_write_tokens ?? usage.cacheWriteTokens ?? 0),
        },
      },
    });
  });

  pi.on?.('tool_execution_end', async (event: any) => {
    enqueueEvent({
      type: 'tool_executed',
      session_id: sessionId,
      project_key: projectKey,
      payload: {
        tool_name: String(event?.toolName ?? event?.tool?.name ?? 'unknown'),
        risk: classifyRisk(String(event?.toolName ?? ''), event?.args),
        ok: !event?.error,
        duration_ms: Number(event?.durationMs ?? 0),
        client: 'pi',
      },
    });
  });

  pi.on?.('model_select', async (event: any) => {
    currentModel = textOf(event?.model?.id) ?? textOf(event?.modelId) ?? currentModel;
    enqueueEvent({
      type: 'model_changed',
      session_id: sessionId,
      project_key: projectKey,
      payload: { model: currentModel, client: 'pi' },
    });
  });

  pi.on?.('agent_settled', async () => {
    void flushTelemetry({ maxBatches: 2 });
  });

  pi.on?.('session_shutdown', async () => {
    if (sessionId) {
      recordSessionEnded({ sessionId, projectKey, turns: turnIndex, toolCalls: 0 });
    }
    await flushTelemetry({ maxBatches: 5 });
    void startedAt;
  });

  registerCommand(pi, 'aic-login', '登录 AIC Gateway（飞书设备码）', async (_args, ctx) => {
    try {
      notify(ctx, '正在请求设备授权码…');
      await login({
        noBrowser: false,
        piVersion: process.env.PI_VERSION ?? 'unknown',
        onDeviceCode: async (info: any) => {
          notify(ctx, `请在浏览器打开 ${info.verification_uri} 并输入授权码 ${info.user_code}`, 'warning');
        },
      });
      await ensureBootstrap(true);
      if (bootstrap) {
        registerProviderConfig(pi, bootstrap.models, loadConfig().gateway_url);
      }
      notify(ctx, `已登录 AIC Gateway，可用模型 ${bootstrap?.models.length ?? 0} 个。`);
    } catch (error) {
      notify(ctx, `登录失败：${(error as Error).message}`, 'error');
    }
  });

  registerCommand(pi, 'aic-logout', '吊销当前设备令牌并退出', async (_args, ctx) => {
    await logout();
    notify(ctx, '已退出 AIC Gateway。');
  });

  registerCommand(pi, 'aic-status', '显示登录、项目、模型和遥测状态', async (_args, ctx) => {
    const summary = getCredentialSummary();
    const lines = [
      `登录：${summary.loggedIn ? summary.user ?? '已登录' : '未登录'}`,
      `网关：${summary.gateway ?? loadConfig().gateway_url}`,
      `项目：${projectKey ?? '未归因'}（${lastProjectSource}）`,
      `模型：${currentModel ?? '未选择'} · 可用 ${bootstrap?.models.length ?? 0}`,
      `遥测队列：${queueDepth()} 条`,
      `插件：v${PLUGIN_VERSION}`,
    ];
    notify(ctx, lines.join('\n'));
  });

  registerCommand(pi, 'aic-project', '查看或切换当前会话项目：list / set <key> / show / clear', async (args, ctx) => {
    const [action = 'show', key] = (args ?? '').trim().split(/\s+/);
    if (action === 'list') {
      const data = await ensureBootstrap(false);
      notify(ctx, (data?.projects ?? []).map((item) => `${item.key}  ${item.name}`).join('\n') || '没有可加入的项目');
      return;
    }
    if (action === 'set' && key) {
      const data = await ensureBootstrap(false);
      if (!data?.projects.some((item) => item.key === key)) {
        notify(ctx, `项目 ${key} 不在你的项目列表中。`, 'error');
        return;
      }
      projectKey = key;
      lastProjectSource = 'explicit';
      try {
        pi.appendEntry?.('aic.session', { projectKey, source: 'explicit' });
      } catch {
        // ignore
      }
      notify(ctx, `当前会话项目已切换为 ${key}`);
      return;
    }
    if (action === 'clear') {
      projectKey = null;
      lastProjectSource = 'unattributed';
      try {
        pi.appendEntry?.('aic.session', { projectKey: null, source: 'unattributed' });
      } catch {
        // ignore
      }
      notify(ctx, '已清除当前会话项目归属。');
      return;
    }
    notify(ctx, `当前项目：${projectKey ?? '未归因'}（${lastProjectSource}）`);
  });

  registerCommand(pi, 'aic-usage', '查询本人今日 / 7 天 / 30 天用量', async (_args, ctx) => {
    try {
      const token = await getAccessToken();
      const usage = await request<MeUsage>({
        gatewayUrl: loadConfig().gateway_url,
        path: '/api/v1/me/usage',
        token,
      });
      const lines = usage.windows.map((window) => `${window.label}：${window.total_tokens.toLocaleString()} Token / ${window.requests} 请求`);
      notify(ctx, lines.join('\n'));
    } catch (error) {
      notify(ctx, `查询失败：${(error as Error).message}`, 'error');
    }
  });

  registerCommand(pi, 'aic-doctor', '检查登录、网关、目录和遥测连通性', async (_args, ctx) => {
    const lines: string[] = [];
    lines.push(`网关：${loadConfig().gateway_url}`);
    lines.push(`凭据：${getCredentialSummary().loggedIn ? '已登录' : '未登录'}`);
    lines.push(`目录：${bootstrap?.models.length ?? 0} 个模型`);
    lines.push(`遥测队列：${queueDepth()} 条`);
    try {
      const data = await fetchBootstrap({ force: true });
      lines.push(`Bootstrap：正常（${data.models.length} 模型 / ${data.projects.length} 项目）`);
    } catch (error) {
      lines.push(`Bootstrap：失败（${(error as Error).message}）`);
    }
    notify(ctx, lines.join('\n'));
  });
}