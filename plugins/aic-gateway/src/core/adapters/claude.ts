import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractModelArg, addProjectHeaders, prepareLaunch, printSessionHint, recordModelChanged, selectModel, spawnTracked } from './common.js';
import { loadConfig } from '../store.js';

function claudeSettingsPath(): string {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

export async function launchClaude(args: string[]): Promise<number> {
  const extracted = extractModelArg(args);
  const context = await prepareLaunch('claude-code');
  const model = selectModel(context.bootstrap, extracted.model, ['anthropic-messages']);
  const baseUrl = model.base_url.replace(/\/+$/, '');
  const headers = addProjectHeaders({}, context, 'claude-code');
  const customHeaders = Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');

  printSessionHint(context, model);
  console.log('Claude Code 环境已注入：ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_CUSTOM_HEADERS');
  recordModelChanged(context, model, 'claude-code');

  return spawnTracked({
    client: 'claude-code',
    command: 'claude',
    args: extracted.args,
    env: {
      ANTHROPIC_BASE_URL: baseUrl,
      ANTHROPIC_AUTH_TOKEN: context.token,
      ANTHROPIC_MODEL: model.id,
      ANTHROPIC_CUSTOM_HEADERS: customHeaders,
    },
    context,
    model,
  });
}

export function installClaude(options: { write?: boolean } = {}): void {
  const settingsFile = claudeSettingsPath();
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8')) as Record<string, unknown>;
  } catch {
    settings = {};
  }

  const env = (settings.env as Record<string, string> | undefined) ?? {};
  const gateway = loadConfig().gateway_url;
  env.ANTHROPIC_BASE_URL = `${gateway}/gw/anthropic`;
  env.ANTHROPIC_CUSTOM_HEADERS = 'X-AIC-Client: claude-code';
  settings.env = env;
  settings.apiKeyHelper = 'aic print-token';

  const hooks = (settings.hooks as Record<string, unknown> | undefined) ?? {};
  const preToolUse = ensureHook(hooks, 'PreToolUse');
  const postToolUse = ensureHook(hooks, 'PostToolUse');
  settings.hooks = hooks;

  if (options.write) {
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n', 'utf8');
    console.log(`已写入 Claude Code 设置：${settingsFile}`);
    console.log('已配置 apiKeyHelper=aic print-token，并注册 PreToolUse / PostToolUse 审批与遥测钩子。');
  } else {
    console.log('将合并以下 Claude Code 设置（使用 --write 实际写入）：');
    console.log(JSON.stringify({ env, apiKeyHelper: settings.apiKeyHelper, hooks: { PreToolUse: preToolUse, PostToolUse: postToolUse } }, null, 2));
  }
  console.log('');
  console.log('使用方式：直接运行 claude（apiKeyHelper 自动刷新令牌），或运行 aic-claude 以获得项目/会话请求头。');
}

function ensureHook(hooks: Record<string, unknown>, event: string): unknown[] {
  const existing = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
  const command = event === 'PostToolUse' ? 'aic hook claude-post' : 'aic hook claude';
  const already = JSON.stringify(existing).includes(command);
  if (!already) {
    existing.push({
      matcher: '*',
      hooks: [{ type: 'command', command, timeout: event === 'PostToolUse' ? 10 : 600 }],
    });
  }
  hooks[event] = existing;
  return existing;
}