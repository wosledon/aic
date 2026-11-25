import { useEffect, useMemo, useState } from 'react';
import {
  Avatar,
  Box,
  Chip,
  CircularProgress,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { BarChart } from '@mui/x-charts/BarChart';
import dayjs from 'dayjs';
import { api, ApiError } from '../api/client';
import type { AdminUser, ApprovalsResponse, ProjectListItem } from '../api/types';
import { PageHeader, SectionCard } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { DataTable, ErrorAlert } from '../components/DataTable';
import { formatNumber, formatPercent } from '../utils/format';

export function ApprovalsPage() {
  const [days, setDays] = useState(7);
  const [projectId, setProjectId] = useState('');
  const [userId, setUserId] = useState('');
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [data, setData] = useState<ApprovalsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => {
    const now = dayjs();
    const params = new URLSearchParams({
      from: now.subtract(days - 1, 'day').startOf('day').toISOString(),
      to: now.toISOString(),
    });
    if (projectId) params.set('project_id', projectId);
    if (userId) params.set('user_id', userId);
    return params.toString();
  }, [days, projectId, userId]);

  useEffect(() => {
    api<ProjectListItem[]>('/api/v1/admin/projects').then(setProjects).catch(() => undefined);
    api<AdminUser[]>('/api/v1/admin/users').then(setUsers).catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api<ApprovalsResponse>(`/api/v1/admin/analytics/approvals?${query}`)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : '加载审批统计失败。');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  const summary = data?.summary;
  const labels = data?.trend.map((point) => dayjs(point.day).format('MM-DD')) ?? [];

  return (
    <>
      <PageHeader
        title="审批治理"
        subtitle="按用户、项目和时间统计用户批准/拒绝、策略拒绝与自动允许；批准率仅包含用户决策。"
        actions={
          <>
            <TextField select size="small" label="时间范围" value={days} onChange={(event) => setDays(Number(event.target.value))} sx={{ minWidth: 120 }}>
              <MenuItem value={7}>近 7 天</MenuItem>
              <MenuItem value={30}>近 30 天</MenuItem>
              <MenuItem value={90}>近 90 天</MenuItem>
            </TextField>
            <TextField select size="small" label="项目" value={projectId} onChange={(event) => setProjectId(event.target.value)} sx={{ minWidth: 160 }}>
              <MenuItem value="">全部项目</MenuItem>
              {projects.map((project) => (
                <MenuItem key={project.id} value={project.id}>
                  {project.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField select size="small" label="用户" value={userId} onChange={(event) => setUserId(event.target.value)} sx={{ minWidth: 150 }}>
              <MenuItem value="">全部用户</MenuItem>
              {users.map((user) => (
                <MenuItem key={user.id} value={user.id}>
                  {user.name}
                </MenuItem>
              ))}
            </TextField>
          </>
        }
      />
      <ErrorAlert error={error} />

      {loading && !data ? (
        <Box sx={{ py: 10, display: 'grid', placeItems: 'center' }}>
          <CircularProgress />
        </Box>
      ) : (
        summary && (
          <Stack spacing={3}>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', xl: 'repeat(6, 1fr)' }, gap: 2 }}>
              <StatCard label="总决策" value={formatNumber(summary.total)} hint="去重后的 tool_call" />
              <StatCard label="用户批准" value={formatNumber(summary.approved)} hint="source=user" tone="success" />
              <StatCard label="用户拒绝" value={formatNumber(summary.rejected)} hint="source=user" tone="error" />
              <StatCard label="批准率" value={formatPercent(summary.approval_rate)} hint="排除策略拒绝与自动允许" />
              <StatCard label="策略拒绝" value={formatNumber(summary.policy_denied)} hint={`自动允许 ${summary.auto_allowed}`} tone="warning" />
              <StatCard
                label="审批耗时"
                value={`${formatNumber(Math.round(summary.latency_p50))} / ${formatNumber(Math.round(summary.latency_p95))} ms`}
                hint="P50 / P95"
                tone="secondary"
              />
            </Box>

            <SectionCard title="决策趋势" subtitle="用户批准、用户拒绝、策略拒绝与自动允许">
              <Box sx={{ width: '100%', height: 300 }}>
                <BarChart
                  height={300}
                  series={[
                    { data: data!.trend.map((p) => p.approved), label: '批准', color: '#16a34a', stack: 'total' },
                    { data: data!.trend.map((p) => p.rejected), label: '拒绝', color: '#dc2626', stack: 'total' },
                    { data: data!.trend.map((p) => p.policy_denied), label: '策略拒绝', color: '#f59e0b', stack: 'total' },
                    { data: data!.trend.map((p) => p.auto_allowed), label: '自动允许', color: '#64748b', stack: 'total' },
                  ]}
                  xAxis={[{ scaleType: 'band', data: labels, tickLabelStyle: { fontSize: 11 } }]}
                  yAxis={[{ width: 40 }]}
                  margin={{ left: 0, right: 16, top: 24, bottom: 28 }}
                  grid={{ horizontal: true }}
                />
              </Box>
            </SectionCard>

            <SectionCard title="按用户" subtitle="用户批准率 = 本人批准 /（本人批准 + 本人拒绝），策略拒绝单独统计">
              <DataTable
                rows={data!.users}
                getKey={(row) => row.user_id}
                emptyText="当前范围内没有审批事件"
                columns={[
                  {
                    key: 'user',
                    label: '用户',
                    render: (row) => (
                      <Stack direction="row" spacing={1.5} alignItems="center">
                        <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main', fontSize: 13, fontWeight: 700 }}>
                          {row.user_name.slice(0, 1)}
                        </Avatar>
                        <Typography variant="body2" fontWeight={650}>
                          {row.user_name}
                        </Typography>
                      </Stack>
                    ),
                  },
                  { key: 'approved', label: '批准', align: 'right', render: (row) => formatNumber(row.approved) },
                  { key: 'rejected', label: '拒绝', align: 'right', render: (row) => formatNumber(row.rejected) },
                  {
                    key: 'rate',
                    label: '批准率',
                    width: 220,
                    render: (row) => {
                      const total = row.approved + row.rejected;
                      return total === 0 ? (
                        <Typography variant="caption" color="text.secondary">
                          -
                        </Typography>
                      ) : (
                        <Box sx={{ minWidth: 140 }}>
                          <Typography variant="body2" fontWeight={650}>
                            {formatPercent(row.approval_rate)}
                          </Typography>
                          <LinearProgress
                            variant="determinate"
                            value={row.approval_rate}
                            color={row.approval_rate >= 80 ? 'success' : row.approval_rate >= 50 ? 'warning' : 'error'}
                            sx={{ height: 6, borderRadius: 3, mt: 0.5 }}
                          />
                        </Box>
                      );
                    },
                  },
                  { key: 'policy', label: '策略拒绝', align: 'right', render: (row) => formatNumber(row.policy_denied) },
                  { key: 'auto', label: '自动允许', align: 'right', render: (row) => formatNumber(row.auto_allowed) },
                  { key: 'latency', label: '审批 P95', align: 'right', render: (row) => `${formatNumber(Math.round(row.latency_p95))} ms` },
                ]}
              />
            </SectionCard>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 2 }}>
              <SectionCard title="按工具" subtitle="Top 20 工具调用决策">
                <DataTable
                  rows={data!.tools}
                  getKey={(row) => row.tool_name + row.risk}
                  emptyText="暂无审批事件"
                  columns={[
                    { key: 'tool', label: '工具', render: (row) => <Typography variant="body2" fontWeight={600}>{row.tool_name}</Typography> },
                    { key: 'risk', label: '风险', render: (row) => <Chip size="small" label={row.risk} variant="outlined" /> },
                    { key: 'approved', label: '批准', align: 'right', render: (row) => formatNumber(row.approved) },
                    { key: 'rejected', label: '拒绝', align: 'right', render: (row) => formatNumber(row.rejected) },
                    { key: 'policy', label: '策略拒绝', align: 'right', render: (row) => formatNumber(row.policy_denied) },
                    { key: 'auto', label: '自动允许', align: 'right', render: (row) => formatNumber(row.auto_allowed) },
                  ]}
                />
              </SectionCard>

              <SectionCard title="按风险类别" subtitle="风险分类由插件本地判定并上报">
                <DataTable
                  rows={data!.risks}
                  getKey={(row) => row.risk}
                  emptyText="暂无审批事件"
                  columns={[
                    {
                      key: 'risk',
                      label: '风险类别',
                      render: (row) => (
                        <Chip size="small" label={row.risk} color={row.risk === 'destructive' ? 'error' : row.risk === 'exec' ? 'warning' : 'default'} />
                      ),
                    },
                    { key: 'approved', label: '批准', align: 'right', render: (row) => formatNumber(row.approved) },
                    { key: 'rejected', label: '拒绝', align: 'right', render: (row) => formatNumber(row.rejected) },
                    { key: 'policy', label: '策略拒绝', align: 'right', render: (row) => formatNumber(row.policy_denied) },
                  ]}
                />
              </SectionCard>
            </Box>

            <SectionCard title="统计口径" subtitle="与 PRD §7.6.4 一致">
              <Stack spacing={1}>
                <Typography variant="body2" color="text.secondary">
                  批准率 = 用户批准 /（用户批准 + 用户拒绝），策略拒绝和自动允许不计入分母；按用户统计使用同一口径。
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  同一 tool_call_id 去重；审批耗时从弹窗展示到用户选择，反映在 P50/P95 中。
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  审批是治理与记录能力，不是防篡改的强制安全边界；硬控制由网关模型白名单、配额与密钥保护执行。
                </Typography>
              </Stack>
            </SectionCard>
          </Stack>
        )
      )}
    </>
  );
}