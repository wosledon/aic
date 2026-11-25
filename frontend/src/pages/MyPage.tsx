import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  LinearProgress,
  Stack,
  Tab,
  Tabs,
  Typography,
  alpha,
} from '@mui/material';
import DevicesRoundedIcon from '@mui/icons-material/DevicesRounded';
import DataUsageRoundedIcon from '@mui/icons-material/DataUsageRounded';
import BoltRoundedIcon from '@mui/icons-material/BoltRounded';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import { api, ApiError } from '../api/client';
import type { MeUsageResponse, SessionRow } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { PageHeader, SectionCard } from '../components/PageHeader';
import { DataTable, ErrorAlert, StatusChip } from '../components/DataTable';
import { StatCard } from '../components/StatCard';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { formatCompact, formatDateTime, formatNumber, formatPercent, fromNow } from '../utils/format';

interface MyDevice {
  id: string;
  name: string;
  os: string | null;
  plugin_version: string | null;
  pi_version: string | null;
  status: string;
  last_seen_at: string;
  created_at: string;
  is_current: boolean;
}

export function MyPage() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState(0);
  const [usage, setUsage] = useState<MeUsageResponse | null>(null);
  const [devices, setDevices] = useState<MyDevice[] | null>(null);
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<MyDevice | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [usageData, deviceData, sessionData] = await Promise.all([
        api<MeUsageResponse>('/api/v1/me/usage'),
        api<MyDevice[]>('/api/v1/me/devices'),
        api<SessionRow[]>('/api/v1/me/sessions?limit=50'),
      ]);
      setUsage(usageData);
      setDevices(deviceData);
      setSessions(sessionData);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '加载个人数据失败。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const today = usage?.windows.find((window) => window.label === '今日');
  const sevenDays = usage?.windows.find((window) => window.label === '近 7 天');
  const month = usage?.windows.find((window) => window.label === '近 30 天');
  const maxModelTokens = usage?.models[0]?.tokens ?? 1;

  return (
    <>
      <PageHeader
        title="个人中心"
        subtitle="查看本人用量、配额与设备。普通用户也可以在这里撤销丢失的设备。"
        actions={
          <>
            <Button variant="outlined" onClick={() => void load()} disabled={loading}>
              刷新
            </Button>
            <Button variant="outlined" color="error" startIcon={<LogoutRoundedIcon />} onClick={() => void logout()}>
              退出登录
            </Button>
          </>
        }
      />
      <ErrorAlert error={error} />

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 2fr' }, gap: 3, mb: 3 }}>
        <SectionCard>
          <Stack direction="row" spacing={2} alignItems="center">
            <Avatar
              src={user?.avatar_url ?? undefined}
              sx={{ width: 64, height: 64, bgcolor: 'primary.main', fontSize: 26, fontWeight: 700 }}
            >
              {user?.name.slice(0, 1)}
            </Avatar>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h3">{user?.name}</Typography>
              <Typography variant="body2" color="text.secondary" noWrap>
                {user?.email ?? user?.id}
              </Typography>
              <Stack direction="row" spacing={0.75} sx={{ mt: 1 }}>
                <Chip size="small" label={user?.role === 'admin' ? '管理员' : '用户'} color={user?.role === 'admin' ? 'primary' : 'default'} />
                <StatusChip status={user?.status} />
              </Stack>
            </Box>
          </Stack>
          <Stack spacing={1} sx={{ mt: 3 }}>
            <Row label="最近登录" value={formatDateTime(user?.last_login_at)} />
            <Row label="用户 ID" value={user?.id ?? '-'} mono />
            <Row label="数据采集" value="仅元数据，不含 Prompt / 代码 / 命令原文" />
          </Stack>
        </SectionCard>

        <SectionCard title="我的用量" subtitle="由网关权威计量">
          {loading && <CircularProgress size={28} />}
          {usage && (
            <Stack spacing={2.5}>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 2 }}>
                <StatCard label="今日 Token" value={formatCompact(today?.total_tokens ?? 0)} hint={`${formatNumber(today?.requests ?? 0)} 次请求`} icon={<DataUsageRoundedIcon />} />
                <StatCard label="近 7 天 Token" value={formatCompact(sevenDays?.total_tokens ?? 0)} hint={`${formatNumber(sevenDays?.requests ?? 0)} 次请求`} icon={<BoltRoundedIcon />} tone="secondary" />
                <StatCard label="近 30 天 Token" value={formatCompact(month?.total_tokens ?? 0)} hint={`${formatNumber(month?.requests ?? 0)} 次请求`} icon={<DataUsageRoundedIcon />} tone="warning" />
              </Box>

              <Box>
                <Typography variant="h4" sx={{ mb: 1.5 }}>
                  配额
                </Typography>
                {usage.quotas.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    管理员尚未为你配置配额。
                  </Typography>
                ) : (
                  <Stack spacing={1.5}>
                    {usage.quotas.map((quota, index) => (
                      <Box key={index}>
                        <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
                          <Typography variant="body2" fontWeight={600}>
                            {quota.period === 'day' ? '每日' : '每月'} · {quota.action}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {formatNumber(quota.used_tokens)} / {quota.token_limit === 0 ? '不限' : formatNumber(quota.token_limit)}（{formatPercent(quota.token_percent)}）
                          </Typography>
                        </Stack>
                        <LinearProgress
                          variant="determinate"
                          value={Math.min(100, quota.token_percent)}
                          color={quota.token_percent >= 100 ? 'error' : quota.token_percent >= 80 ? 'warning' : 'primary'}
                          sx={{ height: 7, borderRadius: 4 }}
                        />
                      </Box>
                    ))}
                  </Stack>
                )}
              </Box>

              <Box>
                <Typography variant="h4" sx={{ mb: 1.5 }}>
                  模型偏好（近 7 天）
                </Typography>
                {usage.models.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    近 7 天没有模型调用。
                  </Typography>
                ) : (
                  <Stack spacing={1.25}>
                    {usage.models.map((model) => (
                      <Box key={model.model_alias}>
                        <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
                          <Typography variant="body2" fontWeight={600}>
                            {model.model_alias}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {formatCompact(model.tokens)} tok · {formatNumber(model.requests)} 请求
                          </Typography>
                        </Stack>
                        <LinearProgress variant="determinate" value={(model.tokens / maxModelTokens) * 100} sx={{ height: 6, borderRadius: 3 }} />
                      </Box>
                    ))}
                  </Stack>
                )}
              </Box>
            </Stack>
          )}
        </SectionCard>
      </Box>

      <SectionCard>
        <Tabs value={tab} onChange={(_, value: number) => setTab(value)} sx={{ mb: 2 }}>
          <Tab label={`我的设备（${devices?.length ?? 0}）`} />
          <Tab label={`我的会话（${sessions?.length ?? 0}）`} />
        </Tabs>

        {tab === 0 &&
          (loading ? (
            <Box sx={{ py: 6, display: 'grid', placeItems: 'center' }}>
              <CircularProgress size={28} />
            </Box>
          ) : (
            <Stack spacing={1.5}>
              {devices?.length === 0 && (
                <Alert severity="info">
                  还没有已登录的 CLI 设备。在终端执行 <code>aic login</code>，或在 Pi 中执行 <code>/login</code> 后选择 AIC Gateway。
                </Alert>
              )}
              {devices?.map((device) => (
                <Box
                  key={device.id}
                  sx={{
                    p: 2,
                    borderRadius: 2,
                    border: 1,
                    borderColor: device.is_current ? 'primary.main' : 'divider',
                    bgcolor: device.is_current ? (theme) => alpha(theme.palette.primary.main, 0.04) : 'transparent',
                  }}
                >
                  <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1.5} alignItems={{ xs: 'flex-start', sm: 'center' }}>
                    <Stack direction="row" spacing={1.5} alignItems="center">
                      <Box sx={{ width: 38, height: 38, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: 'action.hover', color: 'primary.main' }}>
                        <DevicesRoundedIcon fontSize="small" />
                      </Box>
                      <Box>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Typography variant="body2" fontWeight={650}>
                            {device.name}
                          </Typography>
                          {device.is_current && <Chip size="small" label="当前" color="primary" />}
                          <StatusChip status={device.status} />
                        </Stack>
                        <Typography variant="caption" color="text.secondary" display="block">
                          {device.os ?? '-'} · 插件 {device.plugin_version ?? '-'} · Pi {device.pi_version ?? '-'} · {fromNow(device.last_seen_at)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'ui-monospace, monospace' }}>
                          {device.id}
                        </Typography>
                      </Box>
                    </Stack>
                    {device.status === 'active' && (
                      <Button size="small" color="error" onClick={() => setRevokeTarget(device)}>
                        撤销设备
                      </Button>
                    )}
                  </Stack>
                </Box>
              ))}
            </Stack>
          ))}

        {tab === 1 && (
          <DataTable
            loading={loading}
            rows={sessions}
            getKey={(row) => row.id}
            emptyText="暂无本人会话记录"
            columns={[
              {
                key: 'session',
                label: '会话',
                render: (row) => (
                  <Box>
                    <Typography variant="body2" fontWeight={600} sx={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
                      {row.session_id.length > 24 ? `${row.session_id.slice(0, 24)}…` : row.session_id}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {row.cwd_basename ?? '-'}
                    </Typography>
                  </Box>
                ),
              },
              { key: 'project', label: '项目', render: (row) => row.project_name ?? <Chip size="small" label="未归因" variant="outlined" /> },
              { key: 'client', label: '客户端', render: (row) => row.client },
              { key: 'started', label: '开始时间', render: (row) => formatDateTime(row.started_at) },
              { key: 'turns', label: '轮次', align: 'right', render: (row) => formatNumber(row.turn_count) },
              { key: 'tools', label: '工具调用', align: 'right', render: (row) => formatNumber(row.tool_call_count) },
              { key: 'tokens', label: 'Token', align: 'right', render: (row) => formatNumber(row.tokens) },
            ]}
          />
        )}
      </SectionCard>

      <ConfirmDialog
        open={Boolean(revokeTarget)}
        title="撤销设备"
        description={`确定撤销设备「${revokeTarget?.name ?? ''}」吗？该设备上的 CLI 将无法继续刷新令牌。`}
        destructive
        confirmText="撤销"
        onClose={() => setRevokeTarget(null)}
        onConfirm={async () => {
          if (!revokeTarget) return;
          try {
            await api(`/api/v1/me/devices/${revokeTarget.id}`, { method: 'DELETE' });
            await load();
          } catch (err) {
            setError(err instanceof ApiError ? err.message : '撤销设备失败。');
          }
        }}
      />
    </>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <Stack direction="row" justifyContent="space-between" spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography
        variant="body2"
        fontWeight={600}
        sx={{ textAlign: 'right', wordBreak: 'break-all', fontFamily: mono ? 'ui-monospace, monospace' : undefined }}
      >
        {value}
      </Typography>
    </Stack>
  );
}