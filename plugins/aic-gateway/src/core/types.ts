export interface AicConfig {
  gateway_url: string;
  device_id: string;
  device_name: string;
  default_project: string | null;
  default_model: string | null;
  telemetry: boolean;
  policy_cache_ttl_seconds: number;
  debug: boolean;
}

export interface Credentials {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  refresh_expires_at: string;
  user?: { id: string; name: string; role: string };
  device_id: string;
  gateway_url: string;
}

export interface BootstrapModel {
  id: string;
  display_name: string;
  api: string;
  base_url: string;
  reasoning: boolean;
  input: string[];
  context_window: number;
  max_tokens: number;
  reasoning_options?: unknown;
  thinking_level_map?: Record<string, string | null> | null;
}

export interface ApprovalRule {
  risk: string;
  action: string;
  paths?: string[];
}

export interface ApprovalPolicy {
  version: string;
  rules: ApprovalRule[];
  no_ui: string;
}

export interface Bootstrap {
  config_version: string;
  gateway?: { base_url: string };
  user?: { id: string; name: string; role: string };
  catalog_snapshot_id?: string;
  models: BootstrapModel[];
  projects: { key: string; name: string }[];
  repo_mappings: { repo_hash: string; repo_display: string; project_key: string }[];
  approval_policy: ApprovalPolicy;
  telemetry: { enabled: boolean; batch_size: number; interval_seconds: number };
  clients?: { supported: string[]; minimum_plugin_version: string };
}

export type ProjectSource = 'explicit' | 'project_config' | 'repo_mapping' | 'unattributed';

export interface ResolvedProject {
  key: string | null;
  source: ProjectSource;
  repo_hash?: string;
  repo_display?: string;
  cwd_basename?: string;
}

export type ToolRisk = 'read' | 'write' | 'exec' | 'network' | 'destructive' | 'unknown';
export type DecisionAction = 'approved' | 'rejected' | 'policy_denied' | 'auto_allowed';
export type DecisionSource = 'user' | 'policy' | 'policy_no_ui';

export interface Decision {
  action: DecisionAction;
  source: DecisionSource;
  risk: ToolRisk;
  latency_ms: number;
}

export interface TelemetryEvent {
  event_id: string;
  type: string;
  occurred_at: string;
  session_id: string | null;
  project_key: string | null;
  payload: Record<string, unknown>;
}

export interface DeviceStartResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface DeviceTokenResponse {
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'user_disabled';
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_expires_in?: number;
  user?: { id: string; name: string; role: string };
  device_id?: string;
  interval?: number;
}

export interface MeUsage {
  user_id: string;
  user_name: string;
  windows: {
    label: string;
    requests: number;
    total_tokens: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_write_tokens: number;
  }[];
  quotas: {
    scope: string;
    period: string;
    token_limit: number;
    request_limit: number;
    used_tokens: number;
    used_requests: number;
    token_percent: number;
    action: string;
  }[];
  models: { model_alias: string; tokens: number; requests: number }[];
}

export interface ClientName {
  id: 'pi' | 'codex' | 'claude-code' | 'copilot-cli';
  display: string;
}