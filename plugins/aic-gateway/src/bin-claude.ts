#!/usr/bin/env node
import { launchClaude } from './core/adapters/claude.js';

launchClaude(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`aic-claude: ${(error as Error).message}`);
    console.error('提示：先执行 aic login，再执行 aic install claude --write 配置审批钩子。');
    process.exitCode = 1;
  });