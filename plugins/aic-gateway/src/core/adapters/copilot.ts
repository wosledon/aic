import { extractModelArg, prepareLaunch, printSessionHint, recordModelChanged, selectModel, spawnTracked } from './common.js';

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
  console.log('Copilot CLI 环境已注入：COPILOT_PROVIDER_TYPE / COPILOT_PROVIDER_BASE_URL / COPILOT_PROVIDER_API_KEY / COPILOT_MODEL');
  recordModelChanged(context, model, 'copilot-cli');

  return spawnTracked({
    client: 'copilot-cli',
    command: 'copilot',
    args: extracted.args,
    env: {
      COPILOT_PROVIDER_TYPE: 'openai',
      COPILOT_PROVIDER_BASE_URL: baseUrl,
      COPILOT_PROVIDER_API_KEY: context.token,
      COPILOT_MODEL: model.id,
    },
    context,
    model,
  });
}

export function installCopilot(): void {
  console.log('GitHub Copilot CLI 接入方式：');
  console.log('  1. 执行 aic login');
  console.log('  2. 使用 aic-copilot 启动，或手动设置以下环境变量后运行 copilot：');
  console.log('     COPILOT_PROVIDER_TYPE=openai');
  console.log('     COPILOT_PROVIDER_BASE_URL=<gateway>/gw/openai/v1');
  console.log('     COPILOT_PROVIDER_API_KEY=<短期网关令牌（aic print-token）>');
  console.log('     COPILOT_MODEL=<公共模型别名>');
  console.log('');
  console.log('说明：BYOK 需要较新版本的 Copilot CLI；老版本若不支持自定义 Provider，将回退到 GitHub 托管模型。');
  console.log('      令牌默认 15 分钟过期，推荐始终通过 aic-copilot 启动以获得自动刷新。');
}