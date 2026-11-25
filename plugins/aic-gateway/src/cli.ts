import fs from 'node:fs';
import path from 'node:path';
import { login, logout, fetchBootstrap, fetchPublicCatalog, getAccessToken, getCredentialSummary } from './core/auth.js';
import { resolveProject } from './core/project.js';
import { queueDepth, flushTelemetry } from './core/telemetry.js';
import { runClaudeHook } from './core/approval.js';
import { loadBootstrapCache, loadConfig, updateConfig, aicHome, credentialsPath, configPath } from './core/store.js';
import { request, GatewayError } from './core/http.js';
import { launchCodex, installCodex } from './core/adapters/codex.js';
import { launchClaude, installClaude } from './core/adapters/claude.js';
import { launchCopilot, installCopilot } from './core/adapters/copilot.js';
import type { Bootstrap, MeUsage } from './core/types.js';

const VERSION = '1.0.0';

function help(): void {
  console.log(`AIControl CLI v${VERSION}

用法：
  aic login [--gateway URL] [--name DEVICE] [--no-browser]
  aic logout
  aic status
  aic models [--json]
  aic project <show|list|set <key>|clear> [--global]
  aic usage [--json]
  aic doctor [--json]
  aic install <pi|codex|claude|copilot> [--write]
  aic flush
  aic print-token
  aic hook claude|claude-post
  aic launch <codex|claude|copilot> [-- <args>]
  aic version

快捷启动：
  aic-codex         启动 Codex CLI（自动注入网关令牌与 profile）
  aic-claude        启动 Claude Code（自动注入 Base URL 与审批钩子环境）
  aic-copilot       启动 GitHub Copilot CLI（BYOK 环境变量）

环境变量：
  AIC_GATEWAY_URL   覆盖网关地址
  AIC_HOME          覆盖本地配置目录（默认 ~/.aic）
  AIC_PROJECT       覆盖当前项目 key
  AIC_SESSION_ID    覆盖会话 ID`);
}

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string | boolean> } {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const [key, inline] = arg.slice(2).split('=', 2);
      if (inline !== undefined) flags[key] = inline;
      else if (args[i + 1] && !args[i + 1].startsWith('--')) {
        flags[key] = args[i + 1];
        i++;
      } else flags[key] = true;
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

async function commandStatus(): Promise<void> {
  const config = loadConfig();
  const summary = getCredentialSummary();
  const cache = loadBootstrapCache();
  console.log('AIControl 状态');
  console.log('──────────────────────────────');
  console.log(`网关：    ${config.gateway_url}`);
  console.log(`设备：    ${config.device_name} (${config.device_id})`);
  console.log(`登录：    ${summary.loggedIn ? `已登录 · ${summary.user ?? '用户'}` : '未登录'}`);
  if (summary.loggedIn) {
    console.log(`令牌到期：${new Date(summary.expiresAt ?? '').toLocaleString()}`);
  }
  if (cache) {
    console.log(`目录：    ${cache.bootstrap.models.length} 个模型 · ${cache.bootstrap.projects.length} 个项目（更新于 ${new Date(cache.fetched_at).toLocaleString()}）`);
  } else {
    console.log('目录：    尚未缓存');
  }
  const project = resolveProject(process.cwd());
  console.log(`项目：    ${project.key ?? '未归因'}（${project.source}）`);
  console.log(`遥测队列：${queueDepth()} 条`);
  console.log(`配置目录：${aicHome()}`);
}

async function commandModels(json: boolean): Promise<void> {
  const bootstrap = await fetchBootstrap({ ttlSeconds: 300 });
  if (json) {
    console.log(JSON.stringify(bootstrap.models, null, 2));
    return;
  }
  console.log(`可用模型（${bootstrap.models.length}）`);
  console.log('──────────────────────────────────────────────────────────────');
  for (const model of bootstrap.models) {
    const reasoning = model.reasoning ? ' reasoning' : '';
    console.log(`${model.id.padEnd(32)} ${model.api.padEnd(22)} ctx=${model.context_window}${reasoning}`);
    console.log(`  ${model.display_name} · ${model.base_url}`);
  }
}

async function commandProject(action: string, key: string | undefined, global: boolean): Promise<void> {
  const cwd = process.cwd();
  if (action === 'show' || !action) {
    const project = resolveProject(cwd);
    console.log(`项目：${project.key ?? '未归因'}`);
    console.log(`来源：${project.source}`);
    if (project.repo_display) console.log(`仓库：${project.repo_display}`);
    console.log(`目录：${cwd}`);
    return;
  }
  if (action === 'list') {
    const bootstrap = await fetchBootstrap({ ttlSeconds: 300 });
    console.log('我可加入的项目：');
    for (const project of bootstrap.projects) {
      console.log(`  ${project.key.padEnd(28)} ${project.name}`);
    }
    return;
  }
  if (action === 'set') {
    if (!key) throw new Error('用法：aic project set <key>');
    let bootstrap: Bootstrap;
    try {
      bootstrap = await fetchBootstrap({ ttlSeconds: 300 });
    } catch (error) {
      if (!(error instanceof GatewayError)) throw error;
      throw new Error(`无法校验项目：${error.message}`);
    }
    if (!bootstrap.projects.some((project) => project.key === key)) {
      throw new Error(`项目 ${key} 不在你的项目列表中。执行 aic project list 查看。`);
    }
    if (global) {
      updateConfig({ default_project: key });
      console.log(`已设置全局默认项目：${key}`);
    } else {
      const dir = path.join(cwd, '.pi');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'aic.json'), JSON.stringify({ projectKey: key }, null, 2) + '\n', 'utf8');
      console.log(`已写入 ${path.join(dir, 'aic.json')}：${key}`);
    }
    return;
  }
  if (action === 'clear') {
    if (global) {
      updateConfig({ default_project: null });
      console.log('已清除全局默认项目。');
    } else {
      const file = path.join(cwd, '.pi', 'aic.json');
      try {
        fs.unlinkSync(file);
        console.log(`已删除 ${file}`);
      } catch {
        console.log('当前目录没有 .pi/aic.json。');
      }
    }
    return;
  }
  throw new Error(`未知项目命令：${action}`);
}

async function commandUsage(json: boolean): Promise<void> {
  const token = await getAccessToken();
  const config = loadConfig();
  const usage = await request<MeUsage>({
    gatewayUrl: config.gateway_url,
    path: '/api/v1/me/usage',
    token,
    timeoutMs: 15_000,
  });
  if (json) {
    console.log(JSON.stringify(usage, null, 2));
    return;
  }
  console.log(`我的用量 · ${usage.user_name}`);
  console.log('────────────────────────────────────────────');
  for (const window of usage.windows) {
    console.log(`${window.label.padEnd(8)} ${String(window.requests).padStart(6)} 请求  ${window.total_tokens.toLocaleString().padStart(12)} Token`);
  }
  if (usage.quotas.length > 0) {
    console.log('\n配额：');
    for (const quota of usage.quotas) {
      console.log(`  ${quota.period}  ${quota.used_tokens.toLocaleString()} / ${quota.token_limit === 0 ? '不限' : quota.token_limit.toLocaleString()}（${quota.token_percent}%）`);
    }
  }
  if (usage.models.length > 0) {
    console.log('\n近 7 天模型：');
    for (const model of usage.models) {
      console.log(`  ${model.model_alias.padEnd(32)} ${model.tokens.toLocaleString().padStart(12)} Token`);
    }
  }
}

async function commandDoctor(json: boolean): Promise<void> {
  const config = loadConfig();
  const checks: { name: string; ok: boolean; detail: string }[] = [];
  checks.push({ name: '配置目录', ok: true, detail: aicHome() });
  checks.push({ name: '配置文件', ok: fs.existsSync(configPath()), detail: configPath() });
  checks.push({ name: '凭据文件', ok: fs.existsSync(credentialsPath()), detail: fs.existsSync(credentialsPath()) ? '已保存' : '未登录' });
  checks.push({ name: '项目识别', ok: true, detail: `${resolveProject(process.cwd()).key ?? '未归因'}` });
  checks.push({ name: '遥测队列', ok: true, detail: `${queueDepth()} 条待上报` });

  try {
    const catalog = await fetchPublicCatalog(3000);
    checks.push({ name: '公共目录', ok: Boolean(catalog), detail: catalog ? `${catalog.models.length} 个模型` : '不可达（可使用缓存）' });
  } catch (error) {
    checks.push({ name: '公共目录', ok: false, detail: (error as Error).message });
  }

  try {
    const token = await getAccessToken();
    checks.push({ name: '令牌', ok: Boolean(token), detail: `长度 ${token.length}` });
    const bootstrap = await fetchBootstrap({ force: true });
    checks.push({ name: 'Bootstrap', ok: true, detail: `${bootstrap.models.length} 模型 / ${bootstrap.projects.length} 项目 / 策略 v${bootstrap.approval_policy.version}` });
  } catch (error) {
    checks.push({ name: '认证', ok: false, detail: (error as Error).message });
  }

  if (json) {
    console.log(JSON.stringify({ gateway: config.gateway_url, checks }, null, 2));
  } else {
    console.log(`AIC Doctor · ${config.gateway_url}`);
    console.log('────────────────────────────────────────────');
    for (const check of checks) {
      console.log(`${check.ok ? '✓' : '✗'} ${check.name.padEnd(12)} ${check.detail}`);
    }
  }
  if (checks.some((check) => !check.ok)) process.exitCode = 1;
}

async function commandInstall(client: string, write: boolean): Promise<void> {
  switch (client) {
    case 'claude':
    case 'claude-code':
      installClaude({ write });
      break;
    case 'codex':
      installCodex();
      break;
    case 'copilot':
    case 'copilot-cli':
      installCopilot();
      break;
    case 'pi':
      console.log('Pi coding agent 接入方式：');
      console.log('  1. 安装插件：pi install npm:@aicontrol/cli');
      console.log('  2. 启动 Pi，在登录入口选择 “AIC Gateway (Feishu)”');
      console.log('  3. 或执行 /aic-login，随后用 /aic-project set <key> 选择项目');
      console.log('  4. /aic-status、/aic-usage、/aic-doctor 可检查状态');
      break;
    default:
      throw new Error(`不支持的客户端：${client}。可选 pi、codex、claude、copilot。`);
  }
}

export async function main(argv: string[]): Promise<number> {
  const [command = 'help', ...rest] = argv;
  const { positional, flags } = parseFlags(rest);

  try {
    switch (command) {
      case 'login':
        await login({
          gatewayUrl: typeof flags.gateway === 'string' ? flags.gateway : undefined,
          deviceName: typeof flags.name === 'string' ? flags.name : undefined,
          noBrowser: flags['no-browser'] === true,
        });
        return 0;
      case 'logout':
        await logout();
        console.log('已退出登录并吊销当前设备刷新令牌。');
        return 0;
      case 'status':
        await commandStatus();
        return 0;
      case 'models':
        await commandModels(flags.json === true);
        return 0;
      case 'project':
        await commandProject(positional[0] ?? 'show', positional[1], flags.global === true);
        return 0;
      case 'usage':
        await commandUsage(flags.json === true);
        return 0;
      case 'doctor':
        await commandDoctor(flags.json === true);
        return 0;
      case 'install':
        if (!positional[0]) throw new Error('用法：aic install <pi|codex|claude|copilot>');
        await commandInstall(positional[0], flags.write === true);
        return 0;
      case 'flush': {
        const result = await flushTelemetry({ maxBatches: 20 });
        console.log(`遥测上报完成：accepted=${result.accepted} duplicates=${result.duplicates} remaining=${result.remaining}`);
        return 0;
      }
      case 'print-token':
        process.stdout.write((await getAccessToken()) + '\n');
        return 0;
      case 'hook':
        return await runClaudeHook();
      case 'launch': {
        const client = positional[0];
        const clientArgs = rest.slice(rest.indexOf(client) + 1);
        if (client === 'codex') return await launchCodex(clientArgs);
        if (client === 'claude') return await launchClaude(clientArgs);
        if (client === 'copilot') return await launchCopilot(clientArgs);
        throw new Error('用法：aic launch <codex|claude|copilot> [args...]');
      }
      case 'version':
      case '--version':
      case '-v':
        console.log(VERSION);
        return 0;
      case 'help':
      case '--help':
      case '-h':
        help();
        return 0;
      default:
        console.error(`未知命令：${command}\n`);
        help();
        return 1;
    }
  } catch (error) {
    if (error instanceof GatewayError) {
      console.error(`错误：${error.message}`);
      if (error.code === 'not_logged_in' || error.code === 'refresh_expired') {
        console.error('请执行 aic login 重新登录。');
      }
    } else {
      console.error(`错误：${(error as Error).message}`);
    }
    if (loadConfig().debug) console.error(error);
    return 1;
  }
}