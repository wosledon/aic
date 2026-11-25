import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addProjectHeaders, extractModelArg, prepareLaunch, printSessionHint, recordModelChanged, selectModel, spawnTracked } from './common.js';

// dist/core/adapters/copilot.js → dist/bin-aic.js（上两级）
// Copilot 会用不同 shell 执行 API_KEY_COMMAND，统一用正斜杠避免 Windows 反斜杠被解释。
const CLI_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../bin-aic.js').replace(/\\/g, '/');

export async function launchCopilot(args: string[]): Promise<number> {
  const extracted = extractModelArg(args);
  const context = await prepareLaunch('copilot-cli');
  const model = selectModel(context.bootstrap, extracted.model, [
    'openai-completions',
    'openai-responses',
    'azure-openai-completions',
  ]);
  const baseUrl = model.base_url.replace(/\/+$/, '');

  printSessionHint(context, model);
  console.log('Copilot CLI 环境已注入：COPILOT_PROVIDER_TYPE / COPILOT_PROVIDER_BASE_URL / COPILOT_PROVIDER_API_KEY_COMMAND / COPILOT_MODEL');
  recordModelChanged(context, model, 'copilot-cli');

  const attributionHeaders: Record<string, string> = {};
  addProjectHeaders(attributionHeaders, context, 'copilot-cli');

  return spawnTracked({
    client: 'copilot-cli',
    command: 'copilot',
    args: extracted.args,
    env: {
      COPILOT_PROVIDER_TYPE: 'openai',
      COPILOT_PROVIDER_BASE_URL: baseUrl,
      // 每条请求执行一次 print-token，自动刷新短期网关令牌，长会话不会因 15 分钟过期而 401。
      // 注意：openai 类型下静态 API_KEY 会被 Copilot 忽略并带上 GitHub 凭据，必须用 COMMAND。
      COPILOT_PROVIDER_API_KEY_COMMAND: `node "${CLI_PATH}" print-token`,
      COPILOT_MODEL: model.id,
      // Copilot 不会转发进程环境，需要通过 Provider 自定义头携带项目/会话归因。
      COPILOT_PROVIDER_HEADERS: Object.entries(attributionHeaders)
        .map(([name, value]) => `${name}: ${value}`)
        .join('\n'),
    },
    context,
    model,
  });
}

export function installCopilot(): void {
  console.log('GitHub Copilot CLI 接入方式：');
  console.log('  1. 执行 aic login（首次运行 aic-copilot 也会自动发起设备码登录）');
  console.log('  2. 可选：aic model set <alias> 记住默认模型');
  console.log('  3. 直接运行 aic-copilot');
  console.log('');
  console.log('如需手动配置 copilot，可设置以下环境变量：');
  console.log('     COPILOT_PROVIDER_TYPE=openai');
  console.log('     COPILOT_PROVIDER_BASE_URL=<gateway>/gw/openai/v1');
  console.log('     COPILOT_PROVIDER_API_KEY_COMMAND=aic print-token');
  console.log('     COPILOT_MODEL=<公共模型别名>');
  console.log('');
  console.log('说明：BYOK 需要较新版本的 Copilot CLI；老版本若不支持自定义 Provider，将回退到 GitHub 托管模型。');
  console.log('      令牌默认 15 分钟过期，推荐始终通过 aic-copilot 启动以获得自动刷新。');
}