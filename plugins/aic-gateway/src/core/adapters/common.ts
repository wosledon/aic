import { spawn, type SpawnOptions } from 'node:child_process';
import { getAccessToken, fetchBootstrap, getCredentialSummary } from '../auth.js';
import { resolveProject } from '../project.js';
import { loadConfig, debugLog } from '../store.js';
import { randomId } from '../http.js';
import { enqueueEvent, flushTelemetry, recordSessionEnded, recordSessionStarted } from '../telemetry.js';
import type { Bootstrap, BootstrapModel, ResolvedProject } from '../types.js';

export interface LaunchContext {
  bootstrap: Bootstrap;
  model: BootstrapModel;
  token: string;
  project: ResolvedProject;
  sessionId: string;
  gatewayUrl: string;
}

export function extractModelArg(args: string[]): { args: string[]; model: string | null } {
  const copy = [...args];
  for (let i = 0; i < copy.length; i++) {
    const arg = copy[i];
    if (arg === '--model' || arg === '-m') {
      const value = copy[i + 1] ?? null;
      if (value) copy.splice(i, 2);
      return { args: copy, model: value };
    }
    if (arg.startsWith('--model=')) {
      copy.splice(i, 1);
      return { args: copy, model: arg.slice('--model='.length) };
    }
  }
  return { args: copy, model: null };
}

export function selectModel(bootstrap: Bootstrap, requested: string | null, allowedApis: string[]): BootstrapModel {
  const config = loadConfig();
  const alias = requested ?? config.default_model;
  if (alias) {
    const match = bootstrap.models.find((model) => model.id === alias);
    if (!match) {
      throw new Error(`模型 ${alias} 不在当前账号可用目录中。执行 aic models 查看可用模型。`);
    }
    return match;
  }
  const match = bootstrap.models.find((model) => allowedApis.includes(model.api));
  if (!match) {
    throw new Error(`当前账号没有兼容的模型（需要 ${allowedApis.join(' / ')}）。请联系管理员发布模型。`);
  }
  return match;
}

export async function prepareLaunch(client: 'codex' | 'claude-code' | 'copilot-cli', cwd = process.cwd()): Promise<LaunchContext> {
  const summary = getCredentialSummary();
  if (!summary.loggedIn) {
    throw new Error('尚未登录。请先执行 aic login。');
  }
  const config = loadConfig();
  const bootstrap = await fetchBootstrap({ ttlSeconds: 300 });
  const project = resolveProject(cwd);
  const sessionId = process.env.AIC_SESSION_ID || randomId('sess');
  const token = await getAccessToken();
  return {
    bootstrap,
    // The caller replaces this with a protocol-specific model.
    model: bootstrap.models[0],
    token,
    project,
    sessionId,
    gatewayUrl: config.gateway_url,
  };
}

export interface SpawnTrackedOptions {
  client: string;
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  context: LaunchContext;
  model: BootstrapModel;
}

export function spawnTracked(options: SpawnTrackedOptions): Promise<number> {
  const { context, model, client, command, args, env } = options;
  recordSessionStarted({
    sessionId: context.sessionId,
    client,
    projectKey: context.project.key,
    projectName: context.bootstrap.projects.find((project) => project.key === context.project.key)?.name ?? null,
    repoHash: context.project.repo_hash,
    repoDisplay: context.project.repo_display,
    cwdBasename: context.project.cwd_basename,
    model: model.id,
  });
  debugLog(`launch ${client}: command=${command} model=${model.id} project=${context.project.key ?? 'unattributed'}`);

  const spawnOptions: SpawnOptions = {
    stdio: 'inherit',
    env: {
      ...process.env,
      ...env,
      AIC_SESSION_ID: context.sessionId,
      AIC_DEVICE_ID: loadConfig().device_id,
      ...(context.project.key ? { AIC_PROJECT: context.project.key } : {}),
    },
    shell: process.platform === 'win32',
  };

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, spawnOptions);
    child.on('error', (error) => {
      reject(new Error(`无法启动 ${command}：${error.message}。请确认已安装并位于 PATH 中。`));
    });
    child.on('exit', async (code, signal) => {
      recordSessionEnded({ sessionId: context.sessionId, projectKey: context.project.key, turns: 0, toolCalls: 0 });
      try {
        await flushTelemetry({ maxBatches: 2 });
      } catch {
        // telemetry is best-effort
      }
      if (signal) resolve(1);
      else resolve(code ?? 0);
    });
  });
}

export function addProjectHeaders(headers: Record<string, string>, context: LaunchContext, client: string): Record<string, string> {
  if (context.project.key) headers['X-AIC-Project'] = context.project.key;
  headers['X-AIC-Session'] = context.sessionId;
  headers['X-AIC-Device'] = loadConfig().device_id;
  headers['X-AIC-Plugin-Version'] = '1.0.0';
  headers['X-AIC-Client'] = client;
  return headers;
}

export function recordModelChanged(context: LaunchContext, model: BootstrapModel, client: string): void {
  enqueueEvent({
    type: 'model_changed',
    session_id: context.sessionId,
    project_key: context.project.key,
    payload: { model: model.id, client },
  });
}

export function printSessionHint(context: LaunchContext, model: BootstrapModel): void {
  const project = context.project.key ?? '未归因';
  console.log(`AIC · ${project} · ${model.id} · ${model.api}`);
  if (!context.project.key) {
    console.log('提示：当前目录未匹配项目。可在项目根目录创建 .pi/aic.json {"projectKey":"..."} 或执行 aic project set <key>。');
  }
}