import type { ApprovalPolicy, ToolRisk } from './types.js';

export const defaultPolicy: ApprovalPolicy = {
  version: '3',
  rules: [
    { risk: 'read', action: 'allow' },
    { risk: 'write', action: 'ask' },
    { risk: 'exec', action: 'ask' },
    { risk: 'network', action: 'ask' },
    { risk: 'destructive', action: 'ask' },
    { risk: 'unknown', action: 'deny' },
  ],
  no_ui: 'deny',
};

export function policyRule(policy: ApprovalPolicy | null | undefined, risk: ToolRisk): string {
  const active = policy ?? defaultPolicy;
  return active.rules.find((rule) => rule.risk === risk)?.action ?? (active.rules.find((rule) => rule.risk === 'unknown')?.action ?? 'deny');
}

const destructivePatterns = [
  /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b/i,
  /\bgit\s+push\b[^\n]*--force/i,
  /\bgit\s+push\b[^\n]*\s-f(\s|$)/i,
  /\bdrop\s+(database|table|schema)\b/i,
  /\btruncate\s+table\b/i,
  /\bkubectl\s+delete\b/i,
  /\bterraform\s+destroy\b/i,
  /\bdel\s+\/[a-z]*[sq]\b/i,
  /\brmdir\s+\/[a-z]*s\b/i,
  /\bformat\s+[a-z]:/i,
  /\bmkfs(\.|\s)/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  />\s*\/dev\/sd[a-z]/i,
];

export function classifyRisk(toolName: string, toolInput?: unknown): ToolRisk {
  const name = (toolName || '').toLowerCase();
  const input = toolInput && typeof toolInput === 'object' ? (toolInput as Record<string, unknown>) : {};
  const command = [input.command, input.cmd, input.script]
    .filter((value): value is string => typeof value === 'string')
    .join('\n');

  if (command && destructivePatterns.some((pattern) => pattern.test(command))) return 'destructive';
  if (/bash|shell|exec|terminal|powershell|command/.test(name)) return 'exec';
  if (/write|edit|patch|apply|create|delete|move|rename/.test(name)) return 'write';
  if (/webfetch|web_fetch|fetch|http|network|browser|search/.test(name)) return 'network';
  if (/read|view|cat|grep|glob|list/.test(name)) return 'read';
  return 'unknown';
}

/** Redacts credentials and truncates a command for local display only (never uploaded). */
export function summarizeToolInput(toolInput: unknown, maxLength = 80): string | null {
  if (!toolInput || typeof toolInput !== 'object') return null;
  const input = toolInput as Record<string, unknown>;
  const candidate = input.command ?? input.cmd ?? input.path ?? input.file_path ?? input.query;
  if (typeof candidate !== 'string' || !candidate.trim()) return null;
  const redacted = candidate
    .replace(/(token|password|secret|api[_-]?key)\s*=\s*\S+/gi, '$1=***')
    .replace(/Bearer\s+\S+/gi, 'Bearer ***')
    .replace(/\s+/g, ' ')
    .trim();
  return redacted.length > maxLength ? redacted.slice(0, maxLength) + '…' : redacted;
}