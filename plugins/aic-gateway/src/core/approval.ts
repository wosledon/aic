import fs from 'node:fs';
import readline from 'node:readline';
import { fetchBootstrap } from './auth.js';
import { classifyRisk, policyRule, summarizeToolInput } from './policy.js';
import { recordToolDecision, flushTelemetry, ensureSessionStarted } from './telemetry.js';
import { loadBootstrapCache } from './store.js';
import { resolveProject } from './project.js';
import { randomId } from './http.js';
import type { Decision, ToolRisk } from './types.js';

export interface ApprovalInput {
  toolName: string;
  toolInput?: unknown;
  toolCallId?: string;
  sessionId?: string | null;
  projectKey?: string | null;
  cwd?: string;
  hasUI?: boolean;
  prompt?: (message: string) => Promise<boolean>;
}

async function ttyConfirm(message: string): Promise<boolean> {
  let input: fs.ReadStream;
  try {
    const fd = process.platform === 'win32' ? fs.openSync('CONIN$', 'r') : fs.openSync('/dev/tty', 'r');
    input = fs.createReadStream(null as unknown as string, { fd, autoClose: true });
  } catch {
    return false;
  }
  const output = process.stderr;
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input, output, terminal: true });
    rl.question(message, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
    rl.on('close', () => resolve(false));
  });
}

export function hasInteractiveTty(): boolean {
  if (process.stdin.isTTY && process.stdout.isTTY) return true;
  try {
    const fd = process.platform === 'win32' ? fs.openSync('CONIN$', 'r') : fs.openSync('/dev/tty', 'r');
    fs.closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

export async function decideApproval(input: ApprovalInput): Promise<{ decision: Decision; reason: string }> {
  const cached = loadBootstrapCache();
  let policy = cached?.bootstrap.approval_policy;
  try {
    const bootstrap = await fetchBootstrap({ ttlSeconds: 300 });
    policy = bootstrap.approval_policy;
  } catch {
    // Offline: cached policy, otherwise default (fail-closed for ask/deny).
  }

  const risk: ToolRisk = classifyRisk(input.toolName, input.toolInput);
  const rule = policyRule(policy, risk);
  const version = policy?.version ?? 'default';

  if (rule === 'allow') {
    return { decision: { action: 'auto_allowed', source: 'policy', risk, latency_ms: 0 }, reason: 'Allowed by AIC policy' };
  }
  if (rule === 'deny') {
    return { decision: { action: 'policy_denied', source: 'policy', risk, latency_ms: 0 }, reason: 'Blocked by AIC policy' };
  }

  const hasUI = input.hasUI ?? hasInteractiveTty();
  if (!hasUI) {
    return {
      decision: { action: 'policy_denied', source: 'policy_no_ui', risk, latency_ms: 0 },
      reason: 'Approval required, but no interactive UI is available',
    };
  }

  const summary = summarizeToolInput(input.toolInput);
  const message =
    `\n┌─ AIC 审批 ─────────────────────────────\n` +
    `│ 允许执行 ${input.toolName}？\n` +
    `│ 项目：${input.projectKey ?? '未归因'}\n` +
    `│ 风险：${risk}${summary ? `\n│ 摘要：${summary}` : ''}\n` +
    `│ [y] 允许一次   [N] 拒绝\n` +
    `└────────────────────────────────────────\n` +
    `> `;

  const started = Date.now();
  const prompt = input.prompt ?? ttyConfirm;
  const approved = await prompt(message);
  const latencyMs = Date.now() - started;
  return {
    decision: {
      action: approved ? 'approved' : 'rejected',
      source: 'user',
      risk,
      latency_ms: latencyMs,
    },
    reason: approved ? 'Approved by user' : 'User rejected this tool call',
  };
}

export async function recordAndReport(input: ApprovalInput, decision: Decision, policyVersion: string): Promise<void> {
  recordToolDecision({
    toolName: input.toolName,
    toolCallId: input.toolCallId ?? randomId('call'),
    risk: decision.risk,
    action: decision.action,
    source: decision.source,
    latencyMs: decision.latency_ms,
    policyVersion,
    projectKey: input.projectKey,
    sessionId: input.sessionId,
  });
  try {
    await flushTelemetry({ maxBatches: 1 });
  } catch {
    // Telemetry failure must not block tool execution.
  }
}

interface ClaudeHookPayload {
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_call_id?: string;
  session_id?: string;
  cwd?: string;
  tool_response?: unknown;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function runClaudeHook(): Promise<number> {
  const raw = await readStdin();
  let payload: ClaudeHookPayload = {};
  try {
    payload = raw ? (JSON.parse(raw) as ClaudeHookPayload) : {};
  } catch {
    return 0;
  }

  const eventName = payload.hook_event_name ?? 'PreToolUse';
  const toolName = payload.tool_name ?? 'unknown';
  const cwd = payload.cwd ?? process.cwd();
  const resolved = resolveProject(cwd);
  const projectKey = process.env.AIC_PROJECT ?? resolved.key ?? null;
  const sessionId = payload.session_id ?? process.env.AIC_SESSION_ID ?? randomId('sess');

  ensureSessionStarted({
    sessionId,
    client: 'claude-code',
    projectKey,
    projectName: loadBootstrapCache()?.bootstrap.projects.find((project) => project.key === projectKey)?.name ?? null,
    repoHash: resolved.repo_hash,
    repoDisplay: resolved.repo_display,
    cwdBasename: resolved.cwd_basename,
  });

  if (eventName === 'PostToolUse') {
    // Metadata only: never record tool arguments or output.
    const { enqueueEvent, flushTelemetry: flush } = await import('./telemetry.js');
    enqueueEvent({
      type: 'tool_executed',
      session_id: sessionId,
      project_key: projectKey,
      payload: {
        tool_name: toolName,
        risk: classifyRisk(toolName, payload.tool_input),
        ok: true,
        client: 'claude-code',
      },
    });
    try {
      await flush({ maxBatches: 1 });
    } catch {
      // ignore
    }
    return 0;
  }

  const { decision, reason } = await decideApproval({
    toolName,
    toolInput: payload.tool_input,
    toolCallId: payload.tool_call_id,
    sessionId,
    projectKey,
    cwd,
    hasUI: hasInteractiveTty() || process.env.AIC_HOOK_HAS_UI === '1',
  });

  const policyVersion = loadBootstrapCache()?.bootstrap.approval_policy.version ?? 'default';
  await recordAndReport(
    {
      toolName,
      toolInput: payload.tool_input,
      toolCallId: payload.tool_call_id,
      sessionId,
      projectKey,
      cwd,
    },
    decision,
    policyVersion,
  );

  const output = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision.action === 'approved' || decision.action === 'auto_allowed' ? 'allow' : 'deny',
      permissionDecisionReason: reason,
    },
  };
  process.stdout.write(JSON.stringify(output) + '\n');
  return 0;
}

export function riskLabel(risk: ToolRisk): string {
  const labels: Record<ToolRisk, string> = {
    read: '读取',
    write: '写入',
    exec: '执行命令',
    network: '网络访问',
    destructive: '高风险破坏性操作',
    unknown: '未知工具',
  };
  return labels[risk];
}