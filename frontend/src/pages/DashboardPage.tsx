import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import GroupRoundedIcon from '@mui/icons-material/GroupRounded';
import BoltRoundedIcon from '@mui/icons-material/BoltRounded';
import DataUsageRoundedIcon from '@mui/icons-material/DataUsageRounded';
import ForumRoundedIcon from '@mui/icons-material/ForumRounded';
import VerifiedUserRoundedIcon from '@mui/icons-material/VerifiedUserRounded';
import GppBadRoundedIcon from '@mui/icons-material/GppBadRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded';
import { LineChart } from '@mui/x-charts/LineChart';
import { BarChart } from '@mui/x-charts/BarChart';
import dayjs from 'dayjs';
import { api, ApiError } from '../api/client';
import type { OverviewResponse, ProjectListItem } from '../api/types';
import { PageHeader, SectionCard } from '../components/PageHeader';
import { ErrorAlert } from '../components/DataTable';
import { formatCompact, formatNumber, formatPercent, fromNow } from '../utils/format';

const ranges = [
  { label: '今日', days: 0 },
  { label: '近 7 天', days: 7 },
  { label: '近 30 天', days: 30 },
  { label: '近 90 天', days: 90 },
];

export function DashboardPage() {
  const theme = useTheme();
  const [rangeDays, setRangeDays] = useState(7);
  const [projectId, setProjectId] = useState('');
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useMemo(
    () => async () => {
      setLoading(true);
      setError(null);
      try {
        const now = dayjs();
        const from = rangeDays === 0 ? now.startOf('day') : now.subtract(rangeDays - 1, 'day').startOf('day');
        const qs = new URLSearchParams({ from: from.toISOString(), to: now.toISOString() });
        if (projectId) qs.set('project_id', projectId);
        setData(await api<OverviewResponse>(`/api/v1/admin/analytics/overview?${qs.toString()}`));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : '加载概览失败。');
      } finally {
        setLoading(false);
      }
    },
    [rangeDays, projectId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api<ProjectListItem[]>('/api/v1/admin/projects').then(setProjects).catch(() => setProjects([]));
  }, []);

  const summary = data?.summary;
  const trendLabels = data?.trend.map((point) => dayjs(point.day).format('MM-DD')) ?? [];
  const tokenTrend = data?.trend.map((point) => point.tokens) ?? [];
  const requestTrend = data?.trend.map((point) => point.requests) ?? [];
  const userTrend = data?.trend.map((point) => point.active_users) ?? [];

  return (
    <>
      <PageHeader
        title="概览"
        subtitle="统一观察 Token 消耗、模型分布、项目归因与审批治理。"
        actions={
          <>
            <TextField
              select
              size="small"
              value={rangeDays}
              onChange={(event) => setRangeDays(Number(event.target.value))}
              sx={{ minWidth: 118 }}
              label="时间范围"
            >
              {ranges.map((item) => (
                <MenuItem key={item.days} value={item.days}>
                  {item.label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              sx={{ minWidth: 154 }}
              label="项目"
            >
              <MenuItem value="">全部项目</MenuItem>
              {projects.map((project) => (
                <MenuItem key={project.id} value={project.id}>
                  {project.name}
                </MenuItem>
              ))}
            </TextField>
            <Button variant="outlined" startIcon={<RefreshRoundedIcon />} onClick={() => void load()} disabled={loading}>
              刷新
            </Button>
          </>
        }
      />
      <ErrorAlert error={error} />

      {loading && !data ? (
        <Box sx={{ py: 12, display: 'grid', placeItems: 'center' }}>
          <CircularProgress />
        </Box>
      ) : (
        summary && (
          <Stack spacing={3}>
            <Card
              sx={{
                position: 'relative',
                overflow: 'hidden',
                border: '1px solid rgba(255,255,255,0.08)',
                color: '#fff',
                background: 'linear-gradient(118deg, #0d1730 0%, #1b2c5c 54%, #0d3e46 100%)',
                boxShadow: '0 26px 70px rgba(10,17,32,0.36)',
              }}
            >
              <Box
                sx={{
                  position: 'absolute',
                  width: 380,
                  height: 380,
                  borderRadius: '50%',
                  right: -120,
                  top: -190,
                  background: 'radial-gradient(circle, rgba(109,125,255,0.34), transparent 66%)',
                }}
              />
              <Box
                sx={{
                  position: 'absolute',
                  width: 320,
                  height: 320,
                  borderRadius: '50%',
                  right: 220,
                  bottom: -240,
                  background: 'radial-gradient(circle, rgba(14,165,164,0.24), transparent 68%)',
                }}
              />
              <Box sx={{ position: 'relative', p: { xs: 2.75, md: 3.5 } }}>
                <Stack direction={{ xs: 'column', xl: 'row' }} spacing={{ xs: 3, xl: 5 }} justifyContent="space-between">
                  <Box sx={{ maxWidth: 520 }}>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.2 }}>
                      <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: '#5eead4', boxShadow: '0 0 0 4px rgba(94,234,212,0.14)' }} />
                      <Typography sx={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.16em', color: 'rgba(226,232,255,0.58)' }}>
                        实时概览
                      </Typography>
                    </Stack>
                    <Typography sx={{ fontSize: { xs: '2.4rem', md: '3.1rem' }, fontWeight: 800, letterSpacing: '-0.05em', lineHeight: 1 }}>
                      {formatCompact(summary.total_tokens)}
                    </Typography>
                    <Typography sx={{ mt: 1, fontSize: 13, color: 'rgba(226,232,255,0.64)' }}>
                      总 Token · 输入 {formatCompact(summary.input_tokens)} · 输出 {formatCompact(summary.output_tokens)} · 缓存{' '}
                      {formatCompact(summary.cache_read_tokens + summary.cache_write_tokens)}
                    </Typography>
                    <Stack direction="row" spacing={1} sx={{ mt: 2.2 }} flexWrap="wrap" useFlexGap>
                      <Chip
                        label={`错误率 ${formatPercent(summary.error_rate, 2)}`}
                        size="small"
                        sx={{ bgcolor: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.78)' }}
                      />
                      <Chip
                        label={`策略拒绝 ${formatNumber(summary.policy_denied)}`}
                        size="small"
                        sx={{ bgcolor: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.78)' }}
                      />
                      <Chip
                        icon={<ArrowUpwardRoundedIcon sx={{ color: '#5eead4 !important', fontSize: '14px !important' }} />}
                        label={`统计至 ${dayjs(data!.generated_at).format('HH:mm')}`}
                        size="small"
                        sx={{ bgcolor: 'rgba(14,165,164,0.16)', color: '#8df3ea' }}
                      />
                    </Stack>
                  </Box>

                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, minmax(110px, 1fr))' },
                      gap: { xs: 2, md: 0 },
                      alignSelf: 'center',
                      width: { xs: '100%', xl: 'auto' },
                    }}
                  >
                    {[
                      { label: '请求数', value: formatNumber(summary.requests), hint: `成功 ${formatNumber(summary.success_requests)}`, icon: <BoltRoundedIcon /> },
                      { label: '活跃用户', value: formatNumber(summary.active_users), hint: `${formatNumber(summary.sessions)} 个会话`, icon: <GroupRoundedIcon /> },
                      { label: '批准率', value: formatPercent(summary.approval_rate), hint: `${summary.approved} 批准 / ${summary.rejected} 拒绝`, icon: <VerifiedUserRoundedIcon /> },
                      { label: '工具调用', value: formatNumber(summary.tool_calls), hint: `${formatNumber(summary.turns)} 轮次`, icon: <ForumRoundedIcon /> },
                    ].map((metric, index) => (
                      <Box
                        key={metric.label}
                        sx={{
                          px: { xs: 0, md: 2.4 },
                          pl: { md: index === 0 ? 0 : 2.4 },
                          borderLeft: { md: index === 0 ? 'none' : '1px solid rgba(255,255,255,0.12)' },
                        }}
                      >
                        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ color: 'rgba(226,232,255,0.55)' }}>
                          <Box sx={{ '& svg': { fontSize: 15 } }}>{metric.icon}</Box>
                          <Typography sx={{ fontSize: 10.5, fontWeight: 750, letterSpacing: '0.06em' }}>{metric.label}</Typography>
                        </Stack>
                        <Typography sx={{ mt: 0.7, fontSize: { xs: '1.35rem', md: '1.55rem' }, fontWeight: 780, letterSpacing: '-0.03em' }}>
                          {metric.value}
                        </Typography>
                        <Typography sx={{ mt: 0.3, fontSize: 10.5, color: 'rgba(226,232,255,0.46)' }}>{metric.hint}</Typography>
                      </Box>
                    ))}
                  </Box>
                </Stack>
              </Box>
            </Card>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1.72fr 1fr' }, gap: 2.5 }}>
              <SectionCard
                title="Token 趋势"
                subtitle="每天归一化后的总 Token（输入 + 输出 + 缓存读写）"
                action={
                  <Chip size="small" variant="outlined" label={`${rangeDays === 0 ? '今日' : `近 ${rangeDays} 天`}`} />
                }
              >
                <Box sx={{ width: '100%', height: 310 }}>
                  <LineChart
                    height={310}
                    series={[
                      {
                        data: tokenTrend,
                        label: 'Token',
                        area: true,
                        curve: 'monotoneX',
                        color: theme.palette.primary.main,
                        valueFormatter: (value: number | null) => formatCompact(value ?? 0),
                      },
                    ]}
                    xAxis={[{ scaleType: 'point', data: trendLabels, tickLabelStyle: { fontSize: 10.5 } }]}
                    yAxis={[{ valueFormatter: (value: number) => formatCompact(value), width: 58 }]}
                    margin={{ left: 0, right: 18, top: 22, bottom: 30 }}
                    grid={{ horizontal: true }}
                    sx={{ '.MuiAreaElement-root': { fillOpacity: 0.14 } }}
                  />
                </Box>
              </SectionCard>

              <SectionCard title="模型分布" subtitle="按 Token 排序 Top 10">
                {data!.models.length === 0 ? (
                  <Typography variant="body2" color="text.secondary" sx={{ py: 7, textAlign: 'center' }}>
                    当前时间范围内暂无模型调用。
                  </Typography>
                ) : (
                  <Box sx={{ width: '100%', height: 310 }}>
                    <BarChart
                      height={310}
                      layout="horizontal"
                      series={[
                        {
                          data: data!.models.map((item) => item.tokens),
                          label: 'Token',
                          color: '#14b8a6',
                          valueFormatter: (value: number | null) => formatCompact(value ?? 0),
                        },
                      ]}
                      yAxis={[{ scaleType: 'band', data: data!.models.map((item) => item.model_alias), tickLabelStyle: { fontSize: 10.5 }, width: 118 }]}
                      xAxis={[{ valueFormatter: (value: number) => formatCompact(value) }]}
                      margin={{ left: 0, right: 14, top: 8, bottom: 24 }}
                      grid={{ vertical: true }}
                    />
                  </Box>
                )}
              </SectionCard>
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr 1fr' }, gap: 2.5 }}>
              <SectionCard title="请求与活跃用户" subtitle="请求数 / 活跃用户趋势">
                <Box sx={{ width: '100%', height: 264 }}>
                  <LineChart
                    height={264}
                    series={[
                      { data: requestTrend, label: '请求数', curve: 'monotoneX', color: '#f59e0b' },
                      { data: userTrend, label: '活跃用户', curve: 'monotoneX', color: '#0ea5a4' },
                    ]}
                    xAxis={[{ scaleType: 'point', data: trendLabels, tickLabelStyle: { fontSize: 10 } }]}
                    yAxis={[{ width: 40 }]}
                    margin={{ left: 0, right: 12, top: 26, bottom: 28 }}
                    grid={{ horizontal: true }}
                  />
                </Box>
              </SectionCard>

              <SectionCard title="项目 Top 10" subtitle="按 Token 消耗">
                <Stack spacing={1.8} sx={{ maxHeight: 264, overflowY: 'auto', pr: 0.5 }}>
                  {data!.projects.length === 0 && (
                    <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                      暂无项目用量。
                    </Typography>
                  )}
                  {data!.projects.map((project) => {
                    const max = data!.projects[0]?.tokens || 1;
                    return (
                      <Box key={project.project_key}>
                        <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.65 }}>
                          <Typography variant="body2" fontWeight={650} noWrap>
                            {project.project_name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                            {formatCompact(project.tokens)} tok · {formatNumber(project.requests)} 请求
                          </Typography>
                        </Stack>
                        <LinearProgress variant="determinate" value={(project.tokens / max) * 100} sx={{ height: 6 }} />
                      </Box>
                    );
                  })}
                </Stack>
              </SectionCard>

              <SectionCard title="用户 Top 10" subtitle="按 Token 消耗">
                <Stack spacing={1.5} sx={{ maxHeight: 264, overflowY: 'auto', pr: 0.5 }}>
                  {data!.users.length === 0 && (
                    <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                      暂无用户用量。
                    </Typography>
                  )}
                  {data!.users.map((userRow) => (
                    <Stack key={userRow.user_id} direction="row" alignItems="center" spacing={1.4}>
                      <Box
                        sx={{
                          width: 32,
                          height: 32,
                          borderRadius: '50%',
                          display: 'grid',
                          placeItems: 'center',
                          flexShrink: 0,
                          fontSize: 13,
                          fontWeight: 750,
                          color: 'primary.main',
                          bgcolor: alpha(theme.palette.primary.main, 0.1),
                        }}
                      >
                        {userRow.user_name.slice(0, 1)}
                      </Box>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" fontWeight={650} noWrap>
                          {userRow.user_name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {formatNumber(userRow.requests)} 请求
                        </Typography>
                      </Box>
                      <Typography variant="body2" fontWeight={720}>
                        {formatCompact(userRow.tokens)}
                      </Typography>
                    </Stack>
                  ))}
                </Stack>
              </SectionCard>
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1.7fr 1fr' }, gap: 2.5 }}>
              <SectionCard title="最近异常" subtitle="网关错误与审批策略拒绝">
                {data!.anomalies.length === 0 ? (
                  <Alert severity="success" variant="outlined">
                    当前时间范围内未发现异常。
                  </Alert>
                ) : (
                  <Stack spacing={1.2}>
                    {data!.anomalies.map((item, index) => (
                      <Box
                        key={`${item.kind}-${index}`}
                        sx={{
                          p: 1.6,
                          borderRadius: '13px',
                          border: 1,
                          borderColor: 'divider',
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: 2,
                          alignItems: 'center',
                          bgcolor: (t) => alpha(t.palette.error.main, 0.03),
                        }}
                      >
                        <Box>
                          <Typography variant="body2" fontWeight={650}>
                            {item.message}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            最近发生：{fromNow(item.last_occurred_at)}
                          </Typography>
                        </Box>
                        <Chip size="small" color="error" label={`${item.count} 次`} />
                      </Box>
                    ))}
                  </Stack>
                )}
              </SectionCard>

              <SectionCard title="数据说明" subtitle="网关权威计量 + 插件补充归因">
                <Stack spacing={1.35}>
                  {[
                    { icon: <DataUsageRoundedIcon />, text: 'Token 与请求数由网关解析上游响应后权威计量。' },
                    { icon: <ForumRoundedIcon />, text: '项目、会话、审批来自插件遥测，可按用户/项目下钻。' },
                    { icon: <GppBadRoundedIcon />, text: '未归因 Token 单独展示，不强制分摊到项目。' },
                    { icon: <VerifiedUserRoundedIcon />, text: '审批率仅统计用户批准/拒绝，策略拒绝单独计算。' },
                  ].map((item) => (
                    <Stack key={item.text} direction="row" spacing={1.3} alignItems="flex-start">
                      <Box
                        sx={{
                          width: 30,
                          height: 30,
                          borderRadius: '9px',
                          display: 'grid',
                          placeItems: 'center',
                          bgcolor: 'action.hover',
                          color: 'primary.main',
                          flexShrink: 0,
                          '& svg': { fontSize: 16 },
                        }}
                      >
                        {item.icon}
                      </Box>
                      <Typography variant="body2" color="text.secondary">
                        {item.text}
                      </Typography>
                    </Stack>
                  ))}
                </Stack>
              </SectionCard>
            </Box>
          </Stack>
        )
      )}
    </>
  );
}