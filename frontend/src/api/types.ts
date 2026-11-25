export type Role = 'admin' | 'user';
export type Status = 'active' | 'disabled' | 'archived';

export interface UserDto {
  id: string;
  name: string;
  email: string | null;
  avatar_url: string | null;
  role: Role;
  status: Status;
  last_login_at: string | null;
  created_at: string;
}

export interface LoginConfig {
  feishu_enabled: boolean;
  feishu_configured: boolean;
  console_sso_enabled: boolean;
  device_flow_enabled: boolean;
  dev_login_enabled: boolean;
  default_role: Role;
}

export interface MeResponse {
  user: UserDto;
  is_admin: boolean;
}

export interface OverviewSummary {
  active_users: number;
  requests: number;
  success_requests: number;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  error_rate: number;
  approved: number;
  rejected: number;
  policy_denied: number;
  auto_allowed: number;
  approval_rate: number;
  sessions: number;
  turns: number;
  tool_calls: number;
}

export interface TrendPoint {
  day: string;
  tokens: number;
  requests: number;
  active_users: number;
}

export interface ModelShare {
  model_alias: string;
  tokens: number;
  requests: number;
  share: number;
}

export interface ProjectShare {
  project_id: string | null;
  project_key: string;
  project_name: string;
  tokens: number;
  requests: number;
}

export interface UserShare {
  user_id: string;
  user_name: string;
  tokens: number;
  requests: number;
}

export interface AnomalyItem {
  kind: string;
  message: string;
  count: number;
  last_occurred_at: string;
}

export interface OverviewResponse {
  from: string;
  to: string;
  summary: OverviewSummary;
  trend: TrendPoint[];
  models: ModelShare[];
  projects: ProjectShare[];
  users: UserShare[];
  anomalies: AnomalyItem[];
  generated_at: string;
}

export interface UsageRow {
  group_key: string;
  day: string | null;
  project_id: string | null;
  project_key: string | null;
  project_name: string | null;
  user_id: string | null;
  user_name: string | null;
  model_id: string | null;
  model_alias: string | null;
  protocol: string | null;
  device_id: string | null;
  requests: number;
  errors: number;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  avg_latency_ms: number;
  p95_latency_ms: number;
}

export interface UsageResponse {
  from: string;
  to: string;
  group_by: string[];
  rows: UsageRow[];
  row_count: number;
  note: string | null;
}

export interface ApprovalSummary {
  total: number;
  approved: number;
  rejected: number;
  policy_denied: number;
  auto_allowed: number;
  approval_rate: number;
  latency_p50: number;
  latency_p95: number;
}

export interface ApprovalToolRow {
  tool_name: string;
  risk: string;
  approved: number;
  rejected: number;
  policy_denied: number;
  auto_allowed: number;
}

export interface ApprovalTrendPoint {
  day: string;
  approved: number;
  rejected: number;
  policy_denied: number;
  auto_allowed: number;
}

export interface RiskRow {
  risk: string;
  approved: number;
  rejected: number;
  policy_denied: number;
}

export interface ApprovalUserRow {
  user_id: string;
  user_name: string;
  approved: number;
  rejected: number;
  policy_denied: number;
  auto_allowed: number;
  approval_rate: number;
  latency_p95: number;
}

export interface ApprovalsResponse {
  from: string;
  to: string;
  summary: ApprovalSummary;
  tools: ApprovalToolRow[];
  trend: ApprovalTrendPoint[];
  risks: RiskRow[];
  users: ApprovalUserRow[];
}

export interface SessionRow {
  id: string;
  session_id: string;
  user_id: string;
  user_name: string;
  project_key: string | null;
  project_name: string | null;
  client: string;
  repo_display: string | null;
  cwd_basename: string | null;
  started_at: string;
  ended_at: string | null;
  turn_count: number;
  tool_call_count: number;
  tokens: number;
  status: string;
}

export interface ProjectListItem {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: Status;
  member_count: number;
  repo_count: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectDetail {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: Status;
  members: { user_id: string; name: string | null; email: string | null; source: string }[];
  repos: { id: string; repo_hash: string; repo_display: string }[];
  quotas: { id: string; period: string; token_limit: number; request_limit: number; action: string }[];
}

export interface AdminUser {
  id: string;
  feishu_open_id: string | null;
  union_id: string | null;
  name: string;
  email: string | null;
  role: Role;
  status: Status;
  last_login_at: string | null;
  created_at: string;
  device_count: number;
  projects: string[];
}

export interface Device {
  id: string;
  user_id: string;
  user_name: string | null;
  name: string;
  os: string | null;
  plugin_version: string | null;
  pi_version: string | null;
  status: string;
  last_seen_at: string;
  created_at: string;
}

export interface Channel {
  id: string;
  name: string;
  provider_key: string | null;
  provider_template_id: string | null;
  protocol: string;
  base_url: string;
  api_key_masked: string;
  has_headers: boolean;
  status: string;
  max_concurrency: number;
  model_count: number;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublicModel {
  id: string;
  alias: string;
  display_name: string;
  api: string;
  provider_key: string | null;
  channel_id: string | null;
  channel_name: string | null;
  channel_provider_key: string | null;
  upstream_model: string | null;
  bound: boolean;
  context_window: number;
  max_tokens: number;
  reasoning: boolean;
  thinking_level_map: unknown;
  capabilities: unknown;
  status: string;
  catalog_snapshot_id: string | null;
}

export interface QuotaRow {
  id: string;
  scope_type: 'user' | 'project';
  scope_id: string;
  scope_name: string;
  period: 'day' | 'month';
  token_limit: number;
  request_limit: number;
  action: string;
  enabled: boolean;
  used_tokens: number;
  used_requests: number;
  token_percent: number;
}

export interface PolicyRow {
  id: string;
  scope_type: string;
  scope_id: string | null;
  type: string;
  config: unknown;
  config_json: string;
  version: number;
  enabled: boolean;
  updated_at: string;
}

export interface CatalogSnapshot {
  id: string;
  fetched_at: string;
  status: string;
  content_hash: string;
  schema_version: string;
  error: string | null;
  providers: number;
  models: number;
  is_current: boolean;
}

export interface ProviderTemplate {
  id: string;
  provider_key: string;
  name: string;
  npm: string | null;
  protocol_suggestion: string | null;
  base_url: string | null;
  doc_url: string | null;
  env_names: string[];
  model_count: number;
  imported_model_count: number;
  channel_count: number;
  channels: {
    id: string;
    name: string;
    status: string;
    has_api_key: boolean;
  }[];
  snapshot_id: string;
}

export interface ModelTemplate {
  id: string;
  model_key: string;
  canonical_model_id: string | null;
  name: string;
  family: string | null;
  description: string | null;
  context_limit: number | null;
  output_limit: number | null;
  reasoning: boolean;
  reasoning_options: unknown;
  modalities: unknown;
  status: string | null;
  release_date: string | null;
}

export interface AuditLogRow {
  id: number;
  actor_user_id: string | null;
  actor_name: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  detail: unknown;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface FeishuSettings {
  enabled: boolean;
  app_id: string;
  app_secret_masked: string;
  redirect_uri: string;
  scopes: string;
  default_role: Role;
  auto_provision: boolean;
  console_sso_enabled: boolean;
  device_flow_enabled: boolean;
  session_hours: number;
  configured: boolean;
}

export interface SystemHealth {
  gateway_base_url: string;
  database: string;
  catalog: { snapshot_id: string; fetched_at: string; status: string } | null;
  counts: {
    users: number;
    active_users: number;
    projects: number;
    channels: number;
    public_models: number;
    sessions: number;
  };
  channels: {
    id: string;
    name: string;
    protocol: string;
    status: string;
    last_test_at: string | null;
    last_test_ok: boolean | null;
    last_error: string | null;
  }[];
  secrets: { encrypted_at_rest: boolean; storage: string };
}

export interface MeUsageResponse {
  user_id: string;
  user_name: string;
  windows: {
    label: string;
    from: string;
    to: string;
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
  generated_at: string;
}

export interface DevicePending {
  user_code: string;
  device_name: string;
  os: string | null;
  plugin_version: string | null;
  status: string;
  expires_at: string;
}