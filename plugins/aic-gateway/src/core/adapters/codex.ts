import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractModelArg, prepareLaunch, printSessionHint, recordModelChanged, selectModel, spawnTracked } from './common.js';
import { readGitRemote, normalizeRepoUrl } from '../project.js';
import { loadConfig } from '../store.js';

const markerStart = '# >>> aicontrol managed profile (do not edit this block manually)';
const markerEnd = '# <<< aicontrol managed profile';

function codexHome(): string {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

export function writeCodexProfile(options: {
  gatewayUrl: string;
  modelId: string;
  baseUrl: string;
  wireApi: 'responses' | 'chat';
  projectKey: string | null;
  deviceId: string;
}): string {
  const dir = codexHome();
  fs.mkdirSync(dir, { recursive: true });
  const configFile = path.join(dir, 'config.toml');
  let existing = '';
  try {
    existing = fs.readFileSync(configFile, 'utf8');
  } catch {
    existing = '';
  }
  const withoutBlock = existing.replace(new RegExp(`\\n?${escapeRegExp(markerStart)}[\\s\\S]*?${escapeRegExp(markerEnd)}\\n?`, 'g'), '\n').trimEnd();
  const headerEntries = [
    `"X-AIC-Client" = "codex"`,
    `"X-AIC-Device" = "${escapeToml(options.deviceId)}"`,
    `"X-AIC-Plugin-Version" = "1.0.0"`,
  ];
  if (options.projectKey) headerEntries.unshift(`"X-AIC-Project" = "${escapeToml(options.projectKey)}"`);

  const block = [
    '',
    markerStart,
    '[profiles.aic]',
    'model_provider = "aic"',
    `model = "${escapeToml(options.modelId)}"`,
    '',
    '[model_providers.aic]',
    'name = "AIC Gateway"',
    `base_url = "${escapeToml(options.baseUrl)}"`,
    `wire_api = "${options.wireApi}"`,
    'env_key = "AIC_GATEWAY_TOKEN"',
    'env_key_instructions = "Run aic login, then launch via aic-codex so the short-lived token is injected."',
    `http_headers = { ${headerEntries.join(', ')} }`,
    markerEnd,
    '',
  ].join('\n');
  fs.writeFileSync(configFile, (withoutBlock ? withoutBlock + '\n' : '') + block, 'utf8');
  return configFile;
}

function escapeToml(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function launchCodex(args: string[]): Promise<number> {
  const extracted = extractModelArg(args);
  const context = await prepareLaunch('codex');
  const model = selectModel(context.bootstrap, extracted.model, [
    'openai-responses',
    'openai-completions',
    'azure-openai-responses',
    'azure-openai-completions',
  ]);
  const wireApi = model.api.includes('completions') ? 'chat' : 'responses';
  const baseUrl = model.base_url.replace(/\/+$/, '');
  const configFile = writeCodexProfile({
    gatewayUrl: context.gatewayUrl,
    modelId: model.id,
    baseUrl,
    wireApi,
    projectKey: context.project.key,
    deviceId: loadConfig().device_id,
  });
  printSessionHint(context, model);
  console.log(`Codex profile: ${configFile}`);
  recordModelChanged(context, model, 'codex');

  return spawnTracked({
    client: 'codex',
    command: 'codex',
    args: ['--profile', 'aic', ...extracted.args],
    env: { AIC_GATEWAY_TOKEN: context.token },
    context,
    model,
  });
}

export function installCodex(): void {
  const cwd = process.cwd();
  const remote = readGitRemote(cwd);
  const normalized = remote ? normalizeRepoUrl(remote) : null;
  console.log('Codex 接入方式：');
  console.log('  1. 执行 aic login 完成设备授权');
  console.log('  2. 使用 aic-codex 启动（会自动刷新令牌并写入 ~/.codex/config.toml 的 [profiles.aic]）');
  console.log('  3. 也可以手动执行：codex --profile aic');
  console.log('');
  console.log('说明：Codex 的 notify 能力只能接收 turn 结束事件，无法拦截工具调用；');
  console.log('      工具审批由 Codex 原生 approval 机制执行，AIC 记录会话与模型元数据。');
  if (normalized) {
    console.log(`当前仓库：${normalized.display}`);
    console.log(`若需自动归因，请在管理后台把该仓库绑定到项目；当前目录也可创建 .pi/aic.json。`);
  }
}