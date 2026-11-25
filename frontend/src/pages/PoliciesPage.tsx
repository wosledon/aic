import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  LinearProgress,
  MenuItem,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import SaveRoundedIcon from '@mui/icons-material/SaveRounded';
import { api, ApiError } from '../api/client';
import type { AdminUser, PolicyRow, ProjectListItem, QuotaRow } from '../api/types';
import { PageHeader, SectionCard } from '../components/PageHeader';
import { DataTable, ErrorAlert } from '../components/DataTable';
import { JsonEditor } from '../components/JsonEditor';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { formatNumber, formatPercent } from '../utils/format';

const policyMeta: Record<string, { label: string; description: string; hint: string }> = {
  approval: {
    label: '审批策略',
    description: '高风险工具执行前的允许/拒绝规则；无 UI 时 fail-closed。',
    hint: '示例：{ "version": "3", "rules": [{"risk":"read","action":"allow"},{"risk":"exec","action":"ask"}], "no_ui": "deny" }',
  },
  modelwhitelist: {
    label: '模型白名单',
    description: '限制用户/项目可访问的公共模型；网关强制执行。',
    hint: '示例：{ "mode": "allowlist", "models": ["claude-sonnet-4-5", "gpt-5-codex"] }',
  },
  ratelimit: {
    label: '速率限制',
    description: '按用户/项目的 RPM/TPM 与最大并发。',
    hint: '示例：{ "rpm": 60, "tpm": 120000, "max_concurrency": 4 }',
  },
};

interface QuotaForm {
  scope_type: 'user' | 'project';
  scope_id: string;
  period: 'day' | 'month';
  token_limit: number;
  request_limit: number;
  action: 'block' | 'warn' | 'observe';
  enabled: boolean;
}

const emptyQuota: QuotaForm = {
  scope_type: 'user',
  scope_id: '',
  period: 'month',
  token_limit: 1_000_000,
  request_limit: 0,
  action: 'block',
  enabled: true,
};

export function PoliciesPage() {
  const [tab, setTab] = useState(0);
  const [policies, setPolicies] = useState<PolicyRow[] | null>(null);
  const [quotas, setQuotas] = useState<QuotaRow[] | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { json: string; enabled: boolean }>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const [quotaOpen, setQuotaOpen] = useState(false);
  const [quotaForm, setQuotaForm] = useState<QuotaForm>(emptyQuota);
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const [quotaBusy, setQuotaBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<QuotaRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [policyRows, quotaRows, userRows, projectRows] = await Promise.all([
        api<PolicyRow[]>('/api/v1/admin/policies'),
        api<QuotaRow[]>('/api/v1/admin/quotas'),
        api<AdminUser[]>('/api/v1/admin/users'),
        api<ProjectListItem[]>('/api/v1/admin/projects'),
      ]);
      setPolicies(policyRows);
      setQuotas(quotaRows);
      setUsers(userRows);
      setProjects(projectRows);
      setDrafts(
        Object.fromEntries(
          policyRows.map((policy) => [policy.id, { json: JSON.stringify(policy.config ?? JSON.parse(policy.config_json), null, 2), enabled: policy.enabled }]),
        ),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '加载策略与配额失败。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const savePolicy = async (policy: PolicyRow) => {
    const draft = drafts[policy.id];
    if (!draft) return;
    try {
      JSON.parse(draft.json);
    } catch {
      setError('策略配置必须是合法 JSON。');
      return;
    }
    setSavingId(policy.id);
    setError(null);
    try {
      await api(`/api/v1/admin/policies/${policy.id}`, {
        method: 'PUT',
        body: JSON.stringify({ config_json: draft.json, enabled: draft.enabled }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '保存策略失败。');
    } finally {
      setSavingId(null);
    }
  };

  const openQuota = (quota?: QuotaRow) => {
    if (quota) {
      setQuotaForm({
        scope_type: quota.scope_type,
        scope_id: quota.scope_id,
        period: quota.period,
        token_limit: quota.token_limit,
        request_limit: quota.request_limit,
        action: (quota.action as QuotaForm['action']) ?? 'block',
        enabled: quota.enabled,
      });
    } else {
      setQuotaForm({ ...emptyQuota, scope_id: users[0]?.id ?? projects[0]?.id ?? '' });
    }
    setQuotaError(null);
    setQuotaOpen(true);
  };

  const saveQuota = async () => {
    setQuotaBusy(true);
    setQuotaError(null);
    try {
      await api('/api/v1/admin/quotas', {
        method: 'PUT',
        body: JSON.stringify(quotaForm),
      });
      setQuotaOpen(false);
      await load();
    } catch (err) {
      setQuotaError(err instanceof ApiError ? err.message : '保存配额失败。');
    } finally {
      setQuotaBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="策略与配额"
        subtitle="模型白名单与用户配额由网关强制执行；审批策略和项目配额用于治理与提醒。"
        actions={
          <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => openQuota()}>
            新增配额
          </Button>
        }
      />
      <ErrorAlert error={error} />

      <Tabs value={tab} onChange={(_, value: number) => setTab(value)} sx={{ mb: 2 }}>
        <Tab label={`策略（${policies?.length ?? 0}）`} />
        <Tab label={`配额（${quotas?.length ?? 0}）`} />
      </Tabs>

      {tab === 0 && (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 2 }}>
          {(policies ?? []).map((policy) => {
            const meta = policyMeta[policy.type] ?? { label: policy.type, description: '', hint: '' };
            const draft = drafts[policy.id] ?? { json: policy.config_json, enabled: policy.enabled };
            return (
              <SectionCard
                key={policy.id}
                title={meta.label}
                subtitle={`${policy.scope_type}${policy.scope_id ? ` · ${policy.scope_id}` : ''} · v${policy.version}`}
                action={
                  <FormControlLabel
                    control={
                      <Switch
                        checked={draft.enabled}
                        onChange={(event) => setDrafts({ ...drafts, [policy.id]: { ...draft, enabled: event.target.checked } })}
                      />
                    }
                    label="启用"
                  />
                }
              >
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  {meta.description}
                </Typography>
                <JsonEditor
                  value={draft.json}
                  onChange={(value) => setDrafts({ ...drafts, [policy.id]: { ...draft, json: value } })}
                  minRows={10}
                  helperText={meta.hint}
                />
                <Stack direction="row" justifyContent="flex-end" sx={{ mt: 1.5 }}>
                  <Button
                    variant="contained"
                    startIcon={<SaveRoundedIcon />}
                    onClick={() => void savePolicy(policy)}
                    disabled={savingId === policy.id}
                  >
                    {savingId === policy.id ? '保存中…' : '保存策略'}
                  </Button>
                </Stack>
              </SectionCard>
            );
          })}
          {!loading && (policies ?? []).length === 0 && (
            <Alert severity="info">尚未配置策略。可执行种子数据初始化或通过 API 创建。</Alert>
          )}
        </Box>
      )}

      {tab === 1 && (
        <SectionCard title="配额" subtitle="配额按日/月重置；用户配额为硬限制，项目配额为软治理。">
          <DataTable
            loading={loading}
            rows={quotas}
            getKey={(row) => row.id}
            emptyText="尚未配置配额。"
            columns={[
              {
                key: 'scope',
                label: '对象',
                render: (row) => (
                  <Box>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Chip size="small" label={row.scope_type === 'user' ? '用户' : '项目'} variant="outlined" />
                      <Typography variant="body2" fontWeight={650}>
                        {row.scope_name}
                      </Typography>
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {row.scope_id}
                    </Typography>
                  </Box>
                ),
              },
              { key: 'period', label: '周期', render: (row) => (row.period === 'day' ? '每日' : '每月') },
              {
                key: 'usage',
                label: '用量 / 配额',
                width: 240,
                render: (row) => (
                  <Box sx={{ minWidth: 180 }}>
                    <LinearProgress
                      variant="determinate"
                      value={Math.min(100, row.token_percent)}
                      color={row.token_percent >= 100 ? 'error' : row.token_percent >= 80 ? 'warning' : 'primary'}
                      sx={{ height: 6, borderRadius: 3, mb: 0.75 }}
                    />
                    <Typography variant="caption" color="text.secondary">
                      {formatNumber(row.used_tokens)} / {row.token_limit === 0 ? '不限' : formatNumber(row.token_limit)} Token（
                      {formatPercent(row.token_percent)}） · {formatNumber(row.used_requests)} 请求
                    </Typography>
                  </Box>
                ),
              },
              { key: 'action', label: '动作', render: (row) => <Chip size="small" label={row.action} color={row.action === 'block' ? 'error' : row.action === 'warn' ? 'warning' : 'default'} variant="outlined" /> },
              { key: 'enabled', label: '状态', render: (row) => <Chip size="small" label={row.enabled ? '启用' : '停用'} color={row.enabled ? 'success' : 'default'} variant="outlined" /> },
              {
                key: 'actions',
                label: '操作',
                align: 'right',
                render: (row) => (
                  <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                    <Button size="small" startIcon={<EditRoundedIcon fontSize="small" />} onClick={() => openQuota(row)}>
                      编辑
                    </Button>
                    <Button size="small" color="error" startIcon={<DeleteOutlineRoundedIcon fontSize="small" />} onClick={() => setDeleteTarget(row)}>
                      删除
                    </Button>
                  </Stack>
                ),
              },
            ]}
          />
        </SectionCard>
      )}

      <Dialog open={quotaOpen} onClose={() => setQuotaOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>配额设置</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {quotaError && <Alert severity="error">{quotaError}</Alert>}
            <TextField
              select
              label="对象类型"
              value={quotaForm.scope_type}
              onChange={(event) => {
                const scopeType = event.target.value as QuotaForm['scope_type'];
                setQuotaForm({
                  ...quotaForm,
                  scope_type: scopeType,
                  scope_id: scopeType === 'user' ? users[0]?.id ?? '' : projects[0]?.id ?? '',
                });
              }}
              fullWidth
            >
              <MenuItem value="user">用户</MenuItem>
              <MenuItem value="project">项目</MenuItem>
            </TextField>
            <TextField
              select
              label={quotaForm.scope_type === 'user' ? '用户' : '项目'}
              value={quotaForm.scope_id}
              onChange={(event) => setQuotaForm({ ...quotaForm, scope_id: event.target.value })}
              fullWidth
            >
              {(quotaForm.scope_type === 'user' ? users : projects).map((item) => (
                <MenuItem key={item.id} value={item.id}>
                  {item.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField select label="周期" value={quotaForm.period} onChange={(event) => setQuotaForm({ ...quotaForm, period: event.target.value as QuotaForm['period'] })} fullWidth>
              <MenuItem value="day">每日</MenuItem>
              <MenuItem value="month">每月</MenuItem>
            </TextField>
            <TextField
              label="Token 上限（0 表示不限）"
              type="number"
              value={quotaForm.token_limit}
              onChange={(event) => setQuotaForm({ ...quotaForm, token_limit: Number(event.target.value) })}
              fullWidth
            />
            <TextField
              label="请求数上限（0 表示不限）"
              type="number"
              value={quotaForm.request_limit}
              onChange={(event) => setQuotaForm({ ...quotaForm, request_limit: Number(event.target.value) })}
              fullWidth
            />
            <TextField select label="超限动作" value={quotaForm.action} onChange={(event) => setQuotaForm({ ...quotaForm, action: event.target.value as QuotaForm['action'] })} fullWidth>
              <MenuItem value="block">阻断（block）</MenuItem>
              <MenuItem value="warn">提醒并记录（warn）</MenuItem>
              <MenuItem value="observe">仅观察（observe）</MenuItem>
            </TextField>
            <FormControlLabel
              control={<Switch checked={quotaForm.enabled} onChange={(event) => setQuotaForm({ ...quotaForm, enabled: event.target.checked })} />}
              label="启用配额"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setQuotaOpen(false)}>取消</Button>
          <Button variant="contained" onClick={() => void saveQuota()} disabled={quotaBusy || !quotaForm.scope_id}>
            {quotaBusy ? '保存中…' : '保存'}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除配额"
        description={`确定删除「${deleteTarget?.scope_name ?? ''}」的${deleteTarget?.period === 'day' ? '每日' : '每月'}配额吗？`}
        destructive
        confirmText="删除"
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await api(`/api/v1/admin/quotas/${deleteTarget.id}`, { method: 'DELETE' });
            await load();
          } catch (err) {
            setError(err instanceof ApiError ? err.message : '删除配额失败。');
          }
        }}
      />

      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 2 }}>
        提示：项目 key 由客户端上报，项目配额不能阻止用户把请求归到其他有权限的项目；硬限制请使用用户配额。
      </Typography>
    </>
  );
}