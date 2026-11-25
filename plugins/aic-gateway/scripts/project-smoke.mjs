import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aic-project-'));
process.env.AIC_HOME = path.join(tempRoot, 'home');
fs.mkdirSync(process.env.AIC_HOME, { recursive: true });
delete process.env.AIC_PROJECT;

const { resolveProject } = await import('../dist/core/project.js');

const log = (name, value) => console.log(`${name}: key=${value.key ?? 'null'} source=${value.source}`);

// 1) 非 Git 目录：用目录名兜底
const workspace = path.join(tempRoot, 'demo-workspace');
fs.mkdirSync(workspace, { recursive: true });
let resolved = resolveProject(workspace);
log('cwd fallback', resolved);
assert.equal(resolved.key, 'demo-workspace');
assert.equal(resolved.source, 'cwd');

// 2) AIC_PROJECT 显式覆盖
process.env.AIC_PROJECT = 'explicit-project';
resolved = resolveProject(workspace);
log('explicit override', resolved);
assert.equal(resolved.key, 'explicit-project');
assert.equal(resolved.source, 'explicit');
delete process.env.AIC_PROJECT;

// 3) 目录内 .aic.json
fs.writeFileSync(path.join(workspace, '.aic.json'), JSON.stringify({ projectKey: 'from-config' }));
resolved = resolveProject(workspace);
log('project config', resolved);
assert.equal(resolved.key, 'from-config');
assert.equal(resolved.source, 'project_config');
fs.rmSync(path.join(workspace, '.aic.json'));

// 4) Git 仓库：首次无映射时用仓库名自动建档
const repo = path.join(tempRoot, 'payments-api');
fs.mkdirSync(repo, { recursive: true });
try {
  execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', 'git@git.example.com:Payments/Payments-API.git'], {
    stdio: 'ignore',
  });
  resolved = resolveProject(repo);
  log('repo fallback', resolved);
  assert.equal(resolved.key, 'payments-api');
  assert.equal(resolved.source, 'repo');
  assert.ok(resolved.repo_hash?.startsWith('sha256:'));
} catch (error) {
  console.log(`skip git case: ${error.message}`);
}

// 5) 用户主目录等通用目录：保持未归因
const generic = path.join(tempRoot, 'Administrator');
fs.mkdirSync(generic, { recursive: true });
resolved = resolveProject(generic);
log('generic dir', resolved);
assert.equal(resolved.key, null);
assert.equal(resolved.source, 'unattributed');

fs.rmSync(tempRoot, { recursive: true, force: true });
console.log('project smoke ok');