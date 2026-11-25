import { Fragment, useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
  alpha,
} from '@mui/material';
import SaveRoundedIcon from '@mui/icons-material/SaveRounded';
import BoltRoundedIcon from '@mui/icons-material/BoltRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import ErrorRoundedIcon from '@mui/icons-material/ErrorRounded';
import { api, ApiError } from '../api/client';
import type { FeishuSettings, SystemHealth } from '../api/types';
import { PageHeader, SectionCard } from '../components/PageHeader';
import { ErrorAlert } from '../components/DataTable';
import { formatDateTime } from '../utils/format';

interface FeishuForm {
  enabled: boolean;
  app_id: string;
  app_secret: string;
  redirect_uri: string;
  scopes: string;
  default_role: 'admin' | 'user';
  auto_provision: boolean;
  console_sso_enabled: boolean;
  device_flow_enabled: boolean;
  session_hours: number;
}

interface FeishuDiagnostics {
  ok: boolean;
  message: string;
  app_name?: string;
  scene_type_text?: string;
  status?: string;
  online_version_id?: string;
  unaudit_version_id?: string;
  redirect_urls?: string[];
  redirect_match?: boolean;
  scopes?: { scope: string; description?: string; level?: string; token_types?: string[] }[];
  has_identity_scope?: boolean | null;
  has_email_scope?: boolean | null;
  partial?: boolean;
  feishu_code?: string;
  feishu_msg?: string;
  hint?: string;
}

export function SettingsPage() {
  const [settings, setSettings] = useState<FeishuSettings | null>(null);
  const [form, setForm] = useState<FeishuForm | null>(null);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnostics, setDiagnostics] = useState<FeishuDiagnostics | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [feishu, systemHealth] = await Promise.all([
        api<FeishuSettings>('/api/v1/admin/settings/feishu'),
        api<SystemHealth>('/api/v1/admin/system/health'),
      ]);
      setSettings(feishu);
      setForm({
        enabled: feishu.enabled,
        app_id: feishu.app_id,
        app_secret: feishu.app_secret_masked,
        redirect_uri: feishu.redirect_uri,
        scopes: feishu.scopes,
        default_role: feishu.default_role,
        auto_provision: feishu.auto_provision,
        console_sso_enabled: feishu.console_sso_enabled,
        device_flow_enabled: feishu.device_flow_enabled,
        session_hours: feishu.session_hours,
      });
      setHealth(systemHealth);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '加载设置失败。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!form) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await api('/api/v1/admin/settings/feishu', { method: 'PUT', body: JSON.stringify(form) });
      setNotice('飞书登录配置已保存，已写入审计日志。');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '保存设置失败。');
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api<{ ok: boolean; message: string }>('/api/v1/admin/settings/feishu/test', { method: 'POST' });
      if (result.ok) setNotice(result.message);
      else setError(result.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '测试失败。');
    } finally {
      setTesting(false);
    }
  };

  const diagnose = async () => {
    setDiagnosing(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api<FeishuDiagnostics>('/api/v1/admin/settings/feishu/diagnostics');
      setDiagnostics(result);
      setDiagnosticsOpen(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '权限自检失败。');
    } finally {
      setDiagnosing(false);
    }
  };

  const copyRedirect = async () => {
    if (!form?.redirect_uri) return;
    try {
      await navigator.clipboard.writeText(form.redirect_uri);
      setNotice('回调地址已复制。');
    } catch {
      setError('复制失败，请手动选择文本复制。');
    }
  };

  return (
    <>
      <PageHeader
        title="系统设置"
        subtitle="飞书应用、网关安全与系统健康；Secret 只写不读。"
        actions={
          <Button variant="outlined" startIcon={<CheckCircleRoundedIcon />} onClick={() => void load()} disabled={loading}>
            刷新
          </Button>
        }
      />
      <ErrorAlert error={error} />
      {notice && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1.5fr 1fr' }, gap: 3 }}>
        <SectionCard title="飞书登录" subtitle="控制台 SSO 与插件设备码共用同一飞书应用">
          {loading && <Typography color="text.secondary">加载中…</Typography>}
          {form && (
            <Stack spacing={2}>
              <FormControlLabel
                control={<Switch checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />}
                label="启用飞书登录（总开关）"
              />
              <TextField label="App ID" value={form.app_id} onChange={(event) => setForm({ ...form, app_id: event.target.value })} fullWidth />
              <TextField
                label="App Secret"
                type="password"
                value={form.app_secret}
                onChange={(event) => setForm({ ...form, app_secret: event.target.value })}
                helperText="加密存储，只写不读；保留掩码表示不修改"
                fullWidth
                autoComplete="new-password"
              />
              <TextField
                label="回调地址"
                value={form.redirect_uri}
                onChange={(event) => setForm({ ...form, redirect_uri: event.target.value })}
                helperText="需与飞书开放平台「重定向 URL」完全一致"
                fullWidth
                InputProps={{
                  endAdornment: (
                    <Button size="small" startIcon={<ContentCopyRoundedIcon />} onClick={() => void copyRedirect()}>
                      复制
                    </Button>
                  ),
                }}
              />
              <TextField
                label="Scope"
                value={form.scopes}
                onChange={(event) => setForm({ ...form, scopes: event.target.value })}
                helperText="留空 = 只拿 open_id/姓名/头像（无需任何审核权限，推荐）。需要邮箱时填 contact:user.email:readonly，并先在开放平台开通该权限、发布版本。不要填 auth:user_access_token:read 或 contact:user.base:readonly。"
                fullWidth
              />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  select
                  label="新用户默认角色"
                  value={form.default_role}
                  onChange={(event) => setForm({ ...form, default_role: event.target.value as 'admin' | 'user' })}
                  fullWidth
                >
                  <MenuItem value="user">用户</MenuItem>
                  <MenuItem value="admin">管理员</MenuItem>
                </TextField>
                <TextField
                  label="会话有效期（小时）"
                  type="number"
                  value={form.session_hours}
                  onChange={(event) => setForm({ ...form, session_hours: Number(event.target.value) })}
                  fullWidth
                />
              </Stack>
              <Stack spacing={0.5}>
                <FormControlLabel
                  control={<Switch checked={form.auto_provision} onChange={(event) => setForm({ ...form, auto_provision: event.target.checked })} />}
                  label="首次登录自动开通用户"
                />
                <FormControlLabel
                  control={<Switch checked={form.console_sso_enabled} onChange={(event) => setForm({ ...form, console_sso_enabled: event.target.checked })} />}
                  label="允许控制台 SSO 登录"
                />
                <FormControlLabel
                  control={<Switch checked={form.device_flow_enabled} onChange={(event) => setForm({ ...form, device_flow_enabled: event.target.checked })} />}
                  label="允许插件设备码登录"
                />
              </Stack>
              <Stack direction="row" spacing={1.25} justifyContent="flex-end" flexWrap="wrap" useFlexGap>
                <Button variant="outlined" startIcon={<CheckCircleRoundedIcon />} onClick={() => void diagnose()} disabled={diagnosing || !settings?.configured}>
                  {diagnosing ? '检查中…' : '权限自检'}
                </Button>
                <Button variant="outlined" startIcon={<BoltRoundedIcon />} onClick={() => void test()} disabled={testing || !settings?.configured}>
                  {testing ? '测试中…' : '测试应用凭据'}
                </Button>
                <Button variant="contained" startIcon={<SaveRoundedIcon />} onClick={() => void save()} disabled={saving}>
                  {saving ? '保存中…' : '保存设置'}
                </Button>
              </Stack>
              <Alert severity="info" variant="outlined">
                仅在<strong>企业飞书租户</strong>下创建的自建应用可用于登录：个人版（豆包）租户会返回 21001，授权页也会提示「无法授予的权限」。修改权限或可用范围后，需创建版本并发布才会生效。
              </Alert>
            </Stack>
          )}
        </SectionCard>

        <Stack spacing={3}>
          <SectionCard title="系统健康" subtitle="单实例 SQLite Demo 部署">
            {health ? (
              <Stack spacing={2}>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
                  {[
                    ['用户', health.counts.users],
                    ['活跃用户', health.counts.active_users],
                    ['项目', health.counts.projects],
                    ['连接', health.counts.channels],
                    ['公共模型', health.counts.public_models],
                    ['会话', health.counts.sessions],
                  ].map(([label, value]) => (
                    <Box key={String(label)} sx={{ p: 1.5, borderRadius: 2, bgcolor: 'action.hover' }}>
                      <Typography variant="caption" color="text.secondary">
                        {label}
                      </Typography>
                      <Typography variant="h4">{value}</Typography>
                    </Box>
                  ))}
                </Box>
                <Divider />
                <Stack spacing={0.75}>
                  <Typography variant="body2">
                    网关地址：<Typography component="span" variant="body2" sx={{ fontFamily: 'ui-monospace, monospace' }}>{health.gateway_base_url}</Typography>
                  </Typography>
                  <Typography variant="body2">数据库：{health.database}</Typography>
                  <Typography variant="body2">
                    models.dev 快照：{health.catalog ? `${health.catalog.snapshot_id}（${formatDateTime(health.catalog.fetched_at)}）` : '尚未同步'}
                  </Typography>
                  <Typography variant="body2">
                    密钥存储：{health.secrets.storage} · {health.secrets.encrypted_at_rest ? '静态加密已启用' : '未启用'}
                  </Typography>
                </Stack>
              </Stack>
            ) : (
              <Typography color="text.secondary">加载中…</Typography>
            )}
          </SectionCard>

          <SectionCard title="供应商连接健康" subtitle="最近一次测试结果">
            <Stack spacing={1.25}>
              {health?.channels.length === 0 && <Typography variant="body2" color="text.secondary">暂无连接。</Typography>}
              {health?.channels.map((channel) => (
                <Box key={channel.id} sx={{ p: 1.5, borderRadius: 2, border: 1, borderColor: 'divider' }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Box>
                      <Typography variant="body2" fontWeight={650}>
                        {channel.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {channel.protocol} · {channel.status}
                      </Typography>
                    </Box>
                    <Box sx={{ textAlign: 'right' }}>
                      {channel.last_test_ok === null ? (
                        <Chip size="small" label="未测试" variant="outlined" />
                      ) : (
                        <Chip
                          size="small"
                          icon={channel.last_test_ok ? <CheckCircleRoundedIcon /> : <ErrorRoundedIcon />}
                          label={channel.last_test_ok ? '正常' : '异常'}
                          color={channel.last_test_ok ? 'success' : 'error'}
                          variant="outlined"
                        />
                      )}
                      <Typography variant="caption" color="text.secondary" display="block">
                        {channel.last_test_at ? formatDateTime(channel.last_test_at) : '-'}
                      </Typography>
                    </Box>
                  </Stack>
                  {channel.last_error && (
                    <Typography variant="caption" color="error.main" display="block" sx={{ mt: 1 }}>
                      {channel.last_error}
                    </Typography>
                  )}
                </Box>
              ))}
            </Stack>
          </SectionCard>

          <SectionCard title="安全与保留策略" subtitle="Demo 默认值">
            <Stack spacing={1.25}>
              {[
                ['上游密钥', 'AES-GCM 加密存储，只写不读，列表仅返回掩码'],
                ['网关令牌', 'Access 15 分钟 / Refresh 30 天，轮换与重用检测'],
                ['管理会话', 'HttpOnly Cookie + CSRF 双提交校验'],
                ['数据保留', '用量 13 个月 / 遥测 90 天 / 审计 3 年（默认）'],
                ['内容采集', '默认不采集 Prompt、代码、命令原文'],
              ].map(([title, desc]) => (
                <Box key={title} sx={{ p: 1.5, borderRadius: 2, bgcolor: alpha('#4f6ef7', 0.05) }}>
                  <Typography variant="body2" fontWeight={650}>
                    {title}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {desc}
                  </Typography>
                </Box>
              ))}
            </Stack>
          </SectionCard>
        </Stack>
      </Box>

      <Dialog open={diagnosticsOpen} onClose={() => setDiagnosticsOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>飞书应用权限自检</DialogTitle>
        <DialogContent dividers>
          {diagnostics && (
            <Stack spacing={2}>
              {!diagnostics.ok ? (
                <>
                  <Alert severity="error">{diagnostics.message}</Alert>
                  {diagnostics.feishu_code && (
                    <Typography variant="body2" color="text.secondary">
                      飞书错误码：{diagnostics.feishu_code} {diagnostics.feishu_msg ?? ''}
                    </Typography>
                  )}
                  {diagnostics.hint && <Alert severity="warning">{diagnostics.hint}</Alert>}
                </>
              ) : diagnostics.partial ? (
                <>
                  <Alert severity="info">{diagnostics.message}</Alert>
                  {diagnostics.feishu_code && (
                    <Typography variant="body2" color="text.secondary">
                      飞书错误码：{diagnostics.feishu_code}
                    </Typography>
                  )}
                  {diagnostics.hint && <Alert severity="success">{diagnostics.hint}</Alert>}
                </>
              ) : (
                <>
                  <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 1, columnGap: 2 }}>
                    {[
                      ['应用名称', diagnostics.app_name ?? '-'],
                      ['应用类型', diagnostics.scene_type_text ?? '-'],
                      ['应用状态', diagnostics.status === '1' ? '已启用' : diagnostics.status === '0' ? '已停用' : '未启用'],
                      ['线上版本', diagnostics.online_version_id || '尚未发布'],
                      ['审核中版本', diagnostics.unaudit_version_id || '无'],
                      ['回调地址', diagnostics.redirect_match ? '已匹配' : '未匹配'],
                    ].map(([label, value]) => (
                      <Fragment key={label}>
                        <Typography variant="body2" color="text.secondary">
                          {label}
                        </Typography>
                        <Typography variant="body2" sx={{ fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' }}>
                          {value}
                        </Typography>
                      </Fragment>
                    ))}
                  </Box>
                  <Divider />
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    <Chip
                      size="small"
                      label={diagnostics.has_identity_scope ? '用户身份权限已开通' : '缺少用户身份权限'}
                      color={diagnostics.has_identity_scope ? 'success' : 'error'}
                      variant="outlined"
                    />
                    <Chip
                      size="small"
                      label={diagnostics.has_email_scope ? '邮箱权限已开通' : '邮箱权限未开通（可选）'}
                      color={diagnostics.has_email_scope ? 'success' : 'default'}
                      variant="outlined"
                    />
                  </Stack>
                  {diagnostics.has_identity_scope === false && (
                    <Alert severity="warning">
                      请在开发者后台 → 权限管理 → API 权限 搜索「获取用户身份标识」并开通，然后创建版本发布。
                    </Alert>
                  )}
                  {diagnostics.status !== '1' && (
                    <Alert severity="warning">应用当前未启用，需要创建版本并发布后才能用于登录。</Alert>
                  )}
                  {!diagnostics.redirect_match && (
                    <Alert severity="warning">
                      回调地址未匹配。请在「安全设置 → 重定向 URL」添加：{form?.redirect_uri}
                    </Alert>
                  )}
                  <Box>
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>
                      已开通权限（{diagnostics.scopes?.length ?? 0}）
                    </Typography>
                    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                      {(diagnostics.scopes ?? []).map((scope) => (
                        <Chip key={scope.scope} size="small" variant="outlined" label={scope.description ?? scope.scope} title={scope.scope} />
                      ))}
                      {(diagnostics.scopes?.length ?? 0) === 0 && (
                        <Typography variant="body2" color="text.secondary">
                          未返回已开通权限。
                        </Typography>
                      )}
                    </Stack>
                  </Box>
                </>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDiagnosticsOpen(false)}>关闭</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}