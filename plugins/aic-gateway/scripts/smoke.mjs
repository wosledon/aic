#!/usr/bin/env node
/**
 * End-to-end smoke test for the AIControl CLI against a running server.
 *
 * Prerequisites:
 *   - backend on AIC_GATEWAY_URL (default http://localhost:5080) with dev login enabled
 *   - `npm run build` in this package
 *
 * It performs real device-code login, approves via the browser API,
 * calls the gateway, runs a Claude approval hook and flushes telemetry.
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const gateway = (process.env.AIC_GATEWAY_URL ?? 'http://localhost:5080').replace(/\/+$/, '');
const home = path.join(root, '.smoke-aic');
const cli = path.join(root, 'dist', 'bin-aic.js');
const node = process.execPath;

function log(step, message) {
  console.log(`\n▶ ${step}\n  ${message}`);
}

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exitCode = 1;
}

function runCli(args, extraEnv = {}) {
  return execFileSync(node, [cli, ...args], {
    encoding: 'utf8',
    env: { ...process.env, AIC_HOME: home, ...extraEnv },
    timeout: 30_000,
  });
}

async function devLoginCookies() {
  const response = await fetch(`${gateway}/api/v1/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@aic.local' }),
  });
  if (!response.ok) throw new Error(`dev-login failed: HTTP ${response.status}`);
  const body = await response.json();
  const cookies = response.headers.getSetCookie().map((value) => value.split(';')[0]);
  return { csrf: body.csrf_token, cookie: cookies.join('; ') };
}

async function approveDevice(userCode, session) {
  const response = await fetch(`${gateway}/api/v1/plugin/auth/device/approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: session.cookie,
      'X-CSRF-Token': session.csrf,
    },
    body: JSON.stringify({ user_code: userCode }),
  });
  if (!response.ok) throw new Error(`device approve failed: HTTP ${response.status} ${await response.text()}`);
}

async function loginWithDeviceCode() {
  fs.rmSync(home, { recursive: true, force: true });
  const child = spawn(node, [cli, 'login', '--gateway', gateway, '--name', 'aic-smoke', '--no-browser'], {
    env: { ...process.env, AIC_HOME: home },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let errorOutput = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    errorOutput += chunk.toString();
  });

  const userCode = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`login did not print a user code:\n${output}\n${errorOutput}`)), 15_000);
    child.stdout.on('data', () => {
      const match = /授权码：([A-Z0-9-]+)/.exec(output);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`login exited early (${code}):\n${output}\n${errorOutput}`));
    });
  });

  log('device login', `user_code=${userCode}`);
  const session = await devLoginCookies();
  await approveDevice(userCode, session);

  const exitCode = await new Promise((resolve) => child.on('exit', resolve));
  if (exitCode !== 0) throw new Error(`login failed with ${exitCode}:\n${output}\n${errorOutput}`);
  console.log(output.trim());
  return session;
}

function assert(condition, message) {
  if (!condition) throw new Error(`assertion failed: ${message}`);
}

async function main() {
  console.log(`AIControl CLI smoke test → ${gateway}`);
  const admin = await loginWithDeviceCode();
  assert(fs.existsSync(path.join(home, 'credentials.json')), 'credentials.json should exist');
  assert(fs.existsSync(path.join(home, 'bootstrap.json')), 'bootstrap.json should exist');

  const status = runCli(['status']);
  log('status', status.trim());

  const modelsJson = runCli(['models', '--json']);
  const models = JSON.parse(modelsJson);
  assert(Array.isArray(models) && models.length > 0, 'bootstrap should return models');
  const anthropicModel = models.find((model) => model.api === 'anthropic-messages');
  const openAiModel = models.find((model) => model.api === 'openai-completions' || model.api === 'openai-responses');
  assert(anthropicModel || openAiModel, 'at least one supported model should exist');
  const model = anthropicModel ?? openAiModel;
  log('models', `${models.length} models, using ${model.id} (${model.api})`);

  const token = runCli(['print-token']).trim();
  assert(token.split('.').length === 3, 'print-token should emit a JWT');
  const deviceId = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8')).device_id;

  const callGateway = async (projectKey, sessionId) => {
    if (model.api === 'anthropic-messages') {
      return fetch(`${gateway}/gw/anthropic/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'X-AIC-Project': projectKey,
          'X-AIC-Session': sessionId,
          'X-AIC-Device': deviceId,
          'X-AIC-Client': 'smoke',
        },
        body: JSON.stringify({ model: model.id, max_tokens: 32, messages: [{ role: 'user', content: 'ping' }] }),
      });
    }
    return fetch(`${gateway}/gw/openai/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-AIC-Project': projectKey,
        'X-AIC-Session': sessionId,
        'X-AIC-Device': deviceId,
        'X-AIC-Client': 'smoke',
      },
      body: JSON.stringify({ model: model.id, max_tokens: 32, messages: [{ role: 'user', content: 'ping' }] }),
    });
  };

  const projectJson = runCli(['project', 'show'], { AIC_PROJECT: 'payments-api' });
  log('project', projectJson.trim());

  const gatewayResponse = await callGateway('payments-api', 'smoke_session_1');
  const gatewayBody = await gatewayResponse.text();
  assert(gatewayResponse.ok, `gateway returned HTTP ${gatewayResponse.status}: ${gatewayBody.slice(0, 200)}`);
  log('gateway', `HTTP ${gatewayResponse.status} request_id=${gatewayResponse.headers.get('x-aic-request-id') ?? '-'}`);

  const hookPayload = {
    hook_event_name: 'PreToolUse',
    tool_name: 'bash',
    tool_input: { command: 'npm test' },
    tool_call_id: 'smoke_tool_1',
    session_id: 'smoke_session_1',
    cwd: process.cwd(),
  };
  const hookOutput = execFileSync(node, [cli, 'hook', 'claude'], {
    input: JSON.stringify(hookPayload),
    encoding: 'utf8',
    env: { ...process.env, AIC_HOME: home, AIC_PROJECT: 'payments-api', AIC_SESSION_ID: 'smoke_session_1' },
    timeout: 20_000,
  });
  const hookResult = JSON.parse(hookOutput);
  log('claude hook', JSON.stringify(hookResult));
  assert(hookResult.hookSpecificOutput?.permissionDecision === 'allow' || hookResult.hookSpecificOutput?.permissionDecision === 'deny', 'hook should return a decision');

  const flush = runCli(['flush']);
  log('telemetry', flush.trim());

  const doctor = runCli(['doctor']);
  log('doctor', doctor.trim());

  const now = new Date();
  const from = new Date(now.getTime() - 3600_000).toISOString();
  const analytics = await fetch(`${gateway}/api/v1/admin/analytics/sessions?from=${encodeURIComponent(from)}&to=${encodeURIComponent(now.toISOString())}&limit=20`, {
    headers: { Cookie: admin.cookie },
  });
  assert(analytics.ok, `admin analytics returned HTTP ${analytics.status}`);
  const sessions = await analytics.json();
  const smokeSession = sessions.find((session) => session.session_id === 'smoke_session_1');
  assert(smokeSession, 'telemetry session should be visible to admin analytics');
  log('analytics', `session=${smokeSession.session_id} client=${smokeSession.client} project=${smokeSession.project_key ?? 'unattributed'}`);

  const approvalsResponse = await fetch(`${gateway}/api/v1/admin/analytics/approvals?from=${encodeURIComponent(from)}&to=${encodeURIComponent(now.toISOString())}`, {
    headers: { Cookie: admin.cookie },
  });
  assert(approvalsResponse.ok, `approvals analytics returned HTTP ${approvalsResponse.status}`);
  const approvals = await approvalsResponse.json();
  assert(approvals.summary.total >= 1, 'at least one approval decision should be recorded');
  assert(approvals.summary.policy_denied >= 1, 'no-UI hook should record a policy denial');
  assert(Array.isArray(approvals.users) && approvals.users.length >= 1, 'approvals should aggregate by user');
  log('approvals', `total=${approvals.summary.total} policy_denied=${approvals.summary.policy_denied} users=${approvals.users.length} tools=${approvals.tools.length}`);

  // Approval filter by user must narrow the summary to that user's decisions.
  const usersResponse = await fetch(`${gateway}/api/v1/admin/users`, { headers: { Cookie: admin.cookie } });
  assert(usersResponse.ok, `admin users returned HTTP ${usersResponse.status}`);
  const adminUsers = await usersResponse.json();
  const approvalUser = approvals.users[0];
  const adminUser = adminUsers.find((user) => user.name === approvalUser.user_name);
  assert(adminUser, 'approval user should exist in admin user list');
  const filteredApprovalsResponse = await fetch(
    `${gateway}/api/v1/admin/analytics/approvals?from=${encodeURIComponent(from)}&to=${encodeURIComponent(now.toISOString())}&user_id=${encodeURIComponent(adminUser.id)}`,
    { headers: { Cookie: admin.cookie } },
  );
  assert(filteredApprovalsResponse.ok, `filtered approvals returned HTTP ${filteredApprovalsResponse.status}`);
  const filteredApprovals = await filteredApprovalsResponse.json();
  assert(filteredApprovals.users.length === 1, 'user-filtered approvals should return exactly one user row');
  assert(filteredApprovals.users[0].user_id === adminUser.id, 'user-filtered approvals should match requested user');
  log('approvals by user', `${adminUser.name} total=${filteredApprovals.summary.total} approved=${filteredApprovals.summary.approved} rejected=${filteredApprovals.summary.rejected}`);

  // Projects are auto-created from telemetry, including member and repo attribution.
  const config = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8'));
  const autoProjectKey = `smoke-auto-project-${Date.now()}`;
  const autoSessionId = `smoke_auto_session_${Date.now()}`;
  const telemetryResponse = await fetch(`${gateway}/api/v1/plugin/telemetry/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      batch_id: `batch_auto_${Date.now()}`,
      device_id: config.device_id,
      plugin_version: '1.0.0',
      events: [
        {
          event_id: `evt_auto_${Date.now()}`,
          type: 'session_started',
          occurred_at: new Date().toISOString(),
          session_id: autoSessionId,
          project_key: autoProjectKey,
          payload: {
            client: 'codex',
            project_name: '自动上报项目',
            cwd_basename: 'smoke-repo',
            repo_hash: `sha256:${autoProjectKey}`,
            repo_display: `git.example.com/smoke/${autoProjectKey}`,
          },
        },
      ],
    }),
  });
  assert(telemetryResponse.status === 202, `auto project telemetry returned HTTP ${telemetryResponse.status}`);
  const projectsResponse = await fetch(`${gateway}/api/v1/admin/projects`, { headers: { Cookie: admin.cookie } });
  assert(projectsResponse.ok, `admin projects returned HTTP ${projectsResponse.status}`);
  const projects = await projectsResponse.json();
  const autoProject = projects.find((project) => project.key === autoProjectKey);
  assert(autoProject, 'telemetry should auto-create a project');
  assert(autoProject.name === '自动上报项目', 'auto-created project should use reported name');
  assert(autoProject.member_count >= 1, 'auto-created project should record the reporting member');
  assert(autoProject.repo_count >= 1, 'auto-created project should record the reported repo');
  log('auto project', `key=${autoProject.key} name=${autoProject.name} members=${autoProject.member_count} repos=${autoProject.repo_count}`);

  // Gateway requests with an unknown project key auto-create it as well.
  const gatewayProjectKey = `smoke-gateway-project-${Date.now()}`;
  const gatewayResponseWithProject = await callGateway(gatewayProjectKey, 'smoke_gateway_project_session');
  assert(gatewayResponseWithProject.ok, `gateway auto-project request returned HTTP ${gatewayResponseWithProject.status}`);
  const projectsAfterGateway = await (
    await fetch(`${gateway}/api/v1/admin/projects`, { headers: { Cookie: admin.cookie } })
  ).json();
  assert(projectsAfterGateway.some((project) => project.key === gatewayProjectKey), 'gateway should auto-create unknown project keys');
  log('gateway auto project', gatewayProjectKey);

  console.log('\n✓ CLI smoke test passed');
}

main().catch((error) => {
  fail(error.stack ?? String(error));
  process.exitCode = 1;
});