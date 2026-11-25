#!/usr/bin/env node
import { launchCodex } from './core/adapters/codex.js';

launchCodex(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`aic-codex: ${(error as Error).message}`);
    console.error('提示：先执行 aic login；若未安装 Codex，请先安装 @openai/codex。');
    process.exitCode = 1;
  });