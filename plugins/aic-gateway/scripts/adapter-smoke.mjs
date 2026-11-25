#!/usr/bin/env node
/**
 * Adapter smoke test: uses fake `claude`, `codex`, `copilot` executables to
 * verify environment/profile injection without launching the real CLIs.
 * Requires a completed `scripts/smoke.mjs` run (credentials in .smoke-aic).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const home = path.join(root, '.smoke-aic');
const bin = path.join(root, '.smoke-bin');
const codexHome = path.join(root, '.smoke-codex');
const node = process.execPath;
const win = process.platform === 'win32';

if (!fs.existsSync(path.join(home, 'credentials.json'))) {
  console.error('Run scripts/smoke.mjs first to create credentials.');
  process.exit(1);
}
fs.rmSync(bin, { recursive: true, force: true });
fs.rmSync(codexHome, { recursive: true, force: true });
fs.mkdirSync(bin, { recursive: true });
fs.mkdirSync(codexHome, { recursive: true });

function fake(name, lines) {
  if (win) {
    fs.writeFileSync(path.join(bin, `${name}.cmd`), ['@echo off', ...lines, 'exit /b 0'].join('\r\n') + '\r\n');
  } else {
    const file = path.join(bin, name);
    fs.writeFileSync(file, ['#!/bin/sh', ...lines.map((line) => line.replace(/%([A-Z_]+):~0,16%/g, (_, key) => '$(echo "$' + key + '" | cut -c1-16)'))].join('\n') + '\n');
    fs.chmodSync(file, 0o755);
  }
}

fake('claude', [
  'echo BASE=%ANTHROPIC_BASE_URL%',
  'echo MODEL=%ANTHROPIC_MODEL%',
  'echo TOKEN=%ANTHROPIC_AUTH_TOKEN:~0,16%',
  'echo HEADERS=%ANTHROPIC_CUSTOM_HEADERS:~0,160%',
]);
fake('codex', ['echo ARGS=%*', 'echo TOKEN=%AIC_GATEWAY_TOKEN:~0,16%', 'echo DEVICE=%AIC_DEVICE_ID%']);
fake('copilot', [
  'echo TYPE=%COPILOT_PROVIDER_TYPE%',
  'echo BASE=%COPILOT_PROVIDER_BASE_URL%',
  'echo MODEL=%COPILOT_MODEL%',
  'echo TOKEN=%COPILOT_PROVIDER_API_KEY:~0,16%',
]);

function runWrapper(script, extraEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(node, [path.join(root, 'dist', script)], {
      env: {
        ...process.env,
        AIC_HOME: home,
        CODEX_HOME: codexHome,
        PATH: bin + path.delimiter + process.env.PATH,
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => (out += chunk.toString()));
    child.stderr.on('data', (chunk) => (err += chunk.toString()));
    child.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(`${script} exited ${code}\n${out}\n${err}`))));
  });
}

function assertIncludes(text, needle, label) {
  if (!text.includes(needle)) throw new Error(`${label}: expected to find ${needle}\n--- output ---\n${text}`);
}

const claudeOut = await runWrapper('bin-claude.js', { AIC_PROJECT: 'payments-api' });
assertIncludes(claudeOut, '/gw/anthropic', 'claude base url');
assertIncludes(claudeOut, 'TOKEN=eyJ', 'claude gateway token');
assertIncludes(claudeOut, 'X-AIC-Project: payments-api', 'claude project header');
console.log('✓ claude wrapper env injection');

const codexOut = await runWrapper('bin-codex.js', { AIC_PROJECT: 'payments-api' });
assertIncludes(codexOut, '--profile aic', 'codex profile argument');
assertIncludes(codexOut, 'TOKEN=eyJ', 'codex gateway token');
const config = fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8');
assertIncludes(config, '[profiles.aic]', 'codex config profile');
assertIncludes(config, 'env_key = "AIC_GATEWAY_TOKEN"', 'codex env key');
assertIncludes(config, '"X-AIC-Project" = "payments-api"', 'codex project header');
console.log('✓ codex wrapper profile injection');

const copilotOut = await runWrapper('bin-copilot.js', { AIC_PROJECT: 'payments-api' });
const gatewayUrl = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8')).gateway_url;
assertIncludes(copilotOut, 'TYPE=openai', 'copilot provider type');
assertIncludes(copilotOut, `BASE=${gatewayUrl}/gw/openai/v1`, 'copilot base url');
assertIncludes(copilotOut, 'TOKEN=eyJ', 'copilot gateway token');
console.log('✓ copilot wrapper env injection');

console.log('\n✓ adapter smoke test passed');