#!/usr/bin/env node
import { launchCopilot } from './core/adapters/copilot.js';

launchCopilot(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`aic-copilot: ${(error as Error).message}`);
    console.error('提示：先执行 aic login；Copilot CLI 需支持 BYOK 自定义 Provider。');
    process.exitCode = 1;
  });