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
  Drawer,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import BlockRoundedIcon from '@mui/icons-material/BlockRounded';
import BoltRoundedIcon from '@mui/icons-material/BoltRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import CloudRoundedIcon from '@mui/icons-material/CloudRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import KeyRoundedIcon from '@mui/icons-material/KeyRounded';
import { api, ApiError } from '../api/client';
import type { Channel } from '../api/types';
import { PageHeader, SectionCard } from '../components/PageHeader';
import { DataTable, ErrorAlert, StatusChip } from '../components/DataTable';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { formatDateTime, formatNumber, fromNow } from '../utils/format';

const protocols = [
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'openai-completions', label: 'OpenAI Chat Completions' },
  { value: 'google-generative-ai', label: 'Google Generative AI' },
  { value: 'azure-openai-responses', label: 'Azure OpenAI Responses' },
  { value: 'azure-openai-completions', label: 'Azure OpenAI Completions' },
];

interface ChannelForm {
  name: string;
  provider_key: string;
  protocol: string;
  base_url: string;
  api_key: string;
  headers_json: string;
  status: string;
  max_concurrency: number;
}

const emptyForm: ChannelForm = {
  name: '',
  provider_key: '',
  protocol: 'anthropic-messages',
  base_url: '',
  api_key: '',
  headers_json: '',
  status: 'enabled',
  max_concurrency: 32,
};

interface TestResult {
  ok: boolean;
  status_code: number;
  latency_ms: number;
  error: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    has_usage: boolean;
  } | null;
}

export function ChannelsPanel() {
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Channel | null>(null);
  const [form, setForm] = useState<ChannelForm>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [rotateTarget, setRotateTarget] = useState<Channel | null>(null);
  const [newKey, setNewKey] = useState('');
  const [disableTarget, setDisableTarget] = useState<Channel | null>(null);
  const [testTarget, setTestTarget] = useState<Channel | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setChannels(await api<Channel[]>('/api/v1/admin/channels'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '加载上游连接失败。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (channel: Channel) => {
    setEditing(channel);
    setForm({
      name: channel.name,
      provider_key: channel.provider_key ?? '',
      protocol: channel.protocol,
      base_url: channel.base_url,
      api_key: channel.api_key_masked,
      headers_json: '',
      status: channel.status,
      max_concurrency: channel.max_concurrency,
    });
    setFormError(null);
    setFormOpen(true);
  };

  const save = async () => {
    setBusy(true);
    setFormError(null);
    try {
      const body = JSON.stringify({
        ...form,
        api_key: form.api_key.includes('****') ? null : form.api_key,
        headers_json: form.headers_json.trim() || null,
      });
      if (editing) {
        await api(`/api/v1/admin/channels/${editing.id}`, { method: 'PUT', body });
      } else {
        await api('/api/v1/admin/channels', { method: 'POST', body });
      }
      setFormOpen(false);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : '保存连接失败。');
    } finally {
      setBusy(false);
    }
  };

  const rotate = async () => {
    if (!rotateTarget || !newKey) return;
    setBusy(true);
    try {
      await api(`/api/v1/admin/channels/${rotateTarget.id}/rotate-secret`, {
        method: 'POST',
        body: JSON.stringify({ api_key: newKey }),
      });
      setRotateTarget(null);
      setNewKey('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '轮换密钥失败。');
    } finally {
      setBusy(false);
    }
  };

  const runTest = async (channel: Channel) => {
    setTestTarget(channel);
    setTestResult(null);
    setTestError(null);
    setTesting(true);
    try {
      setTestResult(await api<TestResult>(`/api/v1/admin/channels/${channel.id}/test`, { method: 'POST' }));
      await load();
    } catch (err) {
      setTestError(err instanceof ApiError ? err.message : '测试请求失败。');
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <ErrorAlert error={error} />

      <SectionCard
        title="已接入连接"
        subtitle={`${channels?.length ?? 0} 个上游连接 · 通常在供应商导入时自动创建`}
        action={
          <Button variant="outlined" startIcon={<AddRoundedIcon />} onClick={openCreate}>
            手动添加连接
          </Button>
        }
      >
        <DataTable
          loading={loading}
          rows={channels}
          getKey={(row) => row.id}
          emptyText="还没有上游连接。在「供应商」中选择 models.dev 供应商和模型即可自动创建。"
          columns={[
            {
              key: 'name',
              label: '连接',
              render: (row) => (
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <Box
                    sx={{
                      width: 36,
                      height: 36,
                      borderRadius: 2,
                      display: 'grid',
                      placeItems: 'center',
                      bgcolor: (theme) => theme.palette.action.hover,
                      color: 'secondary.main',
                    }}
                  >
                    <CloudRoundedIcon fontSize="small" />
                  </Box>
                  <Box>
                    <Typography variant="body2" fontWeight={650}>
                      {row.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {row.provider_key ?? '自定义'} · {row.model_count} 个模型 · 并发 {row.max_concurrency}
                    </Typography>
                  </Box>
                </Stack>
              ),
            },
            {
              key: 'protocol',
              label: '协议',
              render: (row) => <Chip size="small" label={protocols.find((item) => item.value === row.protocol)?.label ?? row.protocol} variant="outlined" />,
            },
            {
              key: 'baseUrl',
              label: '上游地址',
              render: (row) => (
                <Typography variant="caption" sx={{ fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' }}>
                  {row.base_url}
                </Typography>
              ),
            },
            {
              key: 'key',
              label: 'API Key',
              render: (row) => (
                <Typography variant="caption" sx={{ fontFamily: 'ui-monospace, monospace' }}>
                  {row.api_key_masked || '未配置'}
                </Typography>
              ),
            },
            { key: 'status', label: '状态', render: (row) => <StatusChip status={row.status} /> },
            {
              key: 'health',
              label: '最近测试',
              render: (row) =>
                row.last_test_at ? (
                  <Box>
                    <Chip size="small" label={row.last_test_ok ? '成功' : '失败'} color={row.last_test_ok ? 'success' : 'error'} variant="outlined" />
                    <Typography variant="caption" color="text.secondary" display="block">
                      {fromNow(row.last_test_at)}
                    </Typography>
                  </Box>
                ) : (
                  <Typography variant="caption" color="text.secondary">
                    从未测试
                  </Typography>
                ),
            },
            {
              key: 'actions',
              label: '操作',
              align: 'right',
              render: (row) => (
                <Stack direction="row" spacing={0.25} justifyContent="flex-end">
                  <Tooltip title="测试请求">
                    <IconButton size="small" onClick={() => void runTest(row)} aria-label="测试连接">
                      <BoltRoundedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="轮换密钥">
                    <IconButton size="small" onClick={() => setRotateTarget(row)} aria-label="轮换密钥">
                      <KeyRoundedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="编辑">
                    <IconButton size="small" onClick={() => openEdit(row)} aria-label="编辑连接">
                      <EditRoundedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  {row.status !== 'disabled' && (
                    <Tooltip title="停用">
                      <IconButton size="small" color="error" onClick={() => setDisableTarget(row)} aria-label="停用连接">
                        <BlockRoundedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                </Stack>
              ),
            },
          ]}
        />
      </SectionCard>

      <Drawer anchor="right" open={formOpen} onClose={() => setFormOpen(false)} slotProps={{ paper: { sx: { width: { xs: '100%', sm: 480 } } } }}>
        <Stack sx={{ height: '100%' }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ p: 2.5, borderBottom: 1, borderColor: 'divider' }}>
            <Typography variant="h3">{editing ? '编辑上游连接' : '手动添加上游连接'}</Typography>
            <IconButton onClick={() => setFormOpen(false)} aria-label="关闭">
              <CloseRoundedIcon />
            </IconButton>
          </Stack>
          <Box sx={{ p: 2.5, overflowY: 'auto', flex: 1 }}>
            {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}
            <Stack spacing={2}>
              <TextField label="连接名称" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} fullWidth />
              <TextField
                label="供应商 Key"
                value={form.provider_key}
                onChange={(event) => setForm({ ...form, provider_key: event.target.value })}
                helperText="对应 models.dev provider.id，如 anthropic、openai、deepseek"
                fullWidth
              />
              <TextField select label="协议类型" value={form.protocol} onChange={(event) => setForm({ ...form, protocol: event.target.value })} fullWidth>
                {protocols.map((item) => (
                  <MenuItem key={item.value} value={item.value}>
                    {item.label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField label="Base URL" value={form.base_url} onChange={(event) => setForm({ ...form, base_url: event.target.value })} helperText="上游真实地址，仅管理员可见" fullWidth />
              <TextField
                label="API Key"
                value={form.api_key}
                onChange={(event) => setForm({ ...form, api_key: event.target.value })}
                helperText={editing ? '留空或保留掩码表示不修改；新值会覆盖旧密钥' : '加密存储，只写不读'}
                fullWidth
                type="password"
                autoComplete="new-password"
              />
              <TextField
                label="附加认证头（JSON）"
                value={form.headers_json}
                onChange={(event) => setForm({ ...form, headers_json: event.target.value })}
                helperText={editing ? '留空表示不修改' : '如 {"anthropic-version":"2023-06-01"}'}
                fullWidth
                multiline
                minRows={3}
              />
              <Stack direction="row" spacing={2}>
                <TextField select label="状态" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })} sx={{ flex: 1 }}>
                  <MenuItem value="enabled">启用</MenuItem>
                  <MenuItem value="maintenance">维护中</MenuItem>
                  <MenuItem value="disabled">停用</MenuItem>
                </TextField>
                <TextField
                  label="最大并发"
                  type="number"
                  value={form.max_concurrency}
                  onChange={(event) => setForm({ ...form, max_concurrency: Number(event.target.value) })}
                  sx={{ width: 140 }}
                />
              </Stack>
            </Stack>
          </Box>
          <Box sx={{ p: 2.5, borderTop: 1, borderColor: 'divider' }}>
            <Stack direction="row" spacing={1.25} justifyContent="flex-end">
              <Button onClick={() => setFormOpen(false)}>取消</Button>
              <Button variant="contained" onClick={() => void save()} disabled={busy || !form.name || !form.base_url}>
                {busy ? '保存中…' : '保存'}
              </Button>
            </Stack>
          </Box>
        </Stack>
      </Drawer>

      <Dialog open={Boolean(rotateTarget)} onClose={() => setRotateTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>轮换 API Key</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            连接「{rotateTarget?.name}」将立即使用新密钥，旧密钥不再保存。
          </Typography>
          <TextField fullWidth label="新 API Key" type="password" value={newKey} onChange={(event) => setNewKey(event.target.value)} autoComplete="new-password" />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRotateTarget(null)}>取消</Button>
          <Button variant="contained" onClick={() => void rotate()} disabled={!newKey || busy}>
            确认轮换
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(testTarget)} onClose={() => !testing && setTestTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>连接测试 · {testTarget?.name}</DialogTitle>
        <DialogContent>
          {testing && <Typography color="text.secondary">正在发起最小请求…</Typography>}
          {testError && <Alert severity="error">{testError}</Alert>}
          {testResult && (
            <Stack spacing={1.25}>
              <Alert severity={testResult.ok ? 'success' : 'error'}>{testResult.ok ? '连接成功' : testResult.error ?? '连接失败'}</Alert>
              <Typography variant="body2">HTTP 状态：{testResult.status_code || '-'}</Typography>
              <Typography variant="body2">耗时：{formatNumber(testResult.latency_ms)} ms</Typography>
              {testResult.usage && (
                <Typography variant="body2" color="text.secondary">
                  Usage：输入 {formatNumber(testResult.usage.input_tokens)} / 输出 {formatNumber(testResult.usage.output_tokens)} / 合计{' '}
                  {formatNumber(testResult.usage.total_tokens)}
                  {!testResult.usage.has_usage && '（上游未返回 usage）'}
                </Typography>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTestTarget(null)} disabled={testing}>
            关闭
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={Boolean(disableTarget)}
        title="停用连接"
        description={`确定停用连接「${disableTarget?.name ?? ''}」吗？新请求将不再使用该连接。`}
        destructive
        confirmText="停用"
        onClose={() => setDisableTarget(null)}
        onConfirm={async () => {
          if (!disableTarget) return;
          try {
            await api(`/api/v1/admin/channels/${disableTarget.id}`, { method: 'DELETE' });
            await load();
          } catch (err) {
            setError(err instanceof ApiError ? err.message : '停用连接失败。');
          }
        }}
      />

      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 2 }}>
        提示：最后测试时间 {channels?.filter((channel) => channel.last_test_at).length ? formatDateTime(channels.filter((channel) => channel.last_test_at)[0].last_test_at) : '暂无'}。
        上游错误会脱敏保存，不会向客户端泄露主机名或密钥。
      </Typography>
    </>
  );
}

export function ChannelsPage() {
  return (
    <>
      <PageHeader title="上游连接" subtitle="高级管理入口：Base URL、API Key 与附加认证头仅存储在服务端并加密，客户端永远不可见。" />
      <ChannelsPanel />
    </>
  );
}