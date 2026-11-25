import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  Chip,
  FormControl,
  InputLabel,
  ListItemText,
  MenuItem,
  OutlinedInput,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import dayjs from 'dayjs';
import { BarChart } from '@mui/x-charts/BarChart';
import { api, ApiError, downloadFile } from '../api/client';
import type { AdminUser, ProjectListItem, PublicModel, UsageResponse, UsageRow } from '../api/types';
import { PageHeader, SectionCard } from '../components/PageHeader';
import { DataTable, ErrorAlert, type Column } from '../components/DataTable';
import { StatCard } from '../components/StatCard';
import { formatCompact, formatNumber } from '../utils/format';

const groupOptions = [
  { value: 'day', label: '日期' },
  { value: 'project', label: '项目' },
  { value: 'user', label: '用户' },
  { value: 'model', label: '模型' },
  { value: 'protocol', label: '协议' },
  { value: 'device', label: '设备' },
  { value: 'status', label: '状态码' },
];

export function UsagePage() {
  const [from, setFrom] = useState(dayjs().subtract(6, 'day').format('YYYY-MM-DD'));
  const [to, setTo] = useState(dayjs().format('YYYY-MM-DD'));
  const [groupBy, setGroupBy] = useState<string[]>(['project', 'model']);
  const [projectId, setProjectId] = useState('');
  const [userId, setUserId] = useState('');
  const [modelId, setModelId] = useState('');
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [models, setModels] = useState<PublicModel[]>([]);

  useEffect(() => {
    api<ProjectListItem[]>('/api/v1/admin/projects').then(setProjects).catch(() => undefined);
    api<AdminUser[]>('/api/v1/admin/users').then(setUsers).catch(() => undefined);
    api<PublicModel[]>('/api/v1/admin/models').then(setModels).catch(() => undefined);
  }, []);

  const query = useMemo(() => {
    const params = new URLSearchParams({
      from: dayjs(from).startOf('day').toISOString(),
      to: dayjs(to).endOf('day').toISOString(),
      group_by: groupBy.join(','),
      limit: '1000',
    });
    if (projectId) params.set('project_id', projectId);
    if (userId) params.set('user_id', userId);
    if (modelId) params.set('model_id', modelId);
    return params.toString();
  }, [from, to, groupBy, projectId, userId, modelId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api<UsageResponse>(`/api/v1/admin/analytics/usage?${query}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '加载用量失败。');
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = data?.rows ?? [];
  const totals = rows.reduce(
    (acc, row) => ({
      requests: acc.requests + row.requests,
      tokens: acc.tokens + row.total_tokens,
      errors: acc.errors + row.errors,
    }),
    { requests: 0, tokens: 0, errors: 0 },
  );
  const chartRows = rows.slice(0, 10);
  const chartLabels = chartRows.map((row) => {
    if (row.project_name && row.model_alias) return `${row.project_name} · ${row.model_alias}`;
    return row.project_name ?? row.model_alias ?? row.user_name ?? row.device_id ?? row.day ?? row.group_key;
  });

  const today = dayjs().format('YYYY-MM-DD');
  const isToday = from === today && to === today;
  const is7Days = from === dayjs().subtract(6, 'day').format('YYYY-MM-DD') && to === today;
  const is30Days = from === dayjs().subtract(29, 'day').format('YYYY-MM-DD') && to === today;

  const columns: Column<UsageRow>[] = [
    ...(groupBy.includes('day')
      ? [{ key: 'day', label: '日期', render: (row: UsageRow) => (row.day ? dayjs(row.day).format('MM-DD') : '-') }]
      : []),
    ...(groupBy.includes('project')
      ? [
          {
            key: 'project',
            label: '项目',
            render: (row: UsageRow) =>
              row.project_key ? (
                <Box>
                  <Typography variant="body2" fontWeight={650}>
                    {row.project_name ?? row.project_key}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'ui-monospace, monospace' }}>
                    {row.project_key}
                  </Typography>
                </Box>
              ) : (
                <Chip size="small" variant="outlined" color="warning" label="未归因" />
              ),
          },
        ]
      : []),
    ...(groupBy.includes('user') ? [{ key: 'user', label: '用户', render: (row: UsageRow) => row.user_name ?? '-' }] : []),
    ...(groupBy.includes('model') ? [{ key: 'model', label: '模型', render: (row: UsageRow) => row.model_alias ?? '-' }] : []),
    ...(groupBy.includes('protocol')
      ? [{ key: 'protocol', label: '协议', render: (row: UsageRow) => <Chip size="small" variant="outlined" label={row.protocol ?? '-'} /> }]
      : []),
    ...(groupBy.includes('device')
      ? [
          {
            key: 'device',
            label: '设备',
            render: (row: UsageRow) => <Typography variant="caption" sx={{ fontFamily: 'ui-monospace, monospace' }}>{row.device_id ?? '-'}</Typography>,
          },
        ]
      : []),
    ...(groupBy.includes('status')
      ? [{ key: 'status', label: '状态码', render: (row: UsageRow) => <Typography variant="caption" sx={{ fontFamily: 'ui-monospace, monospace' }}>{row.group_key}</Typography> }]
      : []),
    { key: 'requests', label: '请求', align: 'right', render: (row) => formatNumber(row.requests) },
    {
      key: 'errors',
      label: '错误',
      align: 'right',
      render: (row) => (
        <Typography component="span" color={row.errors > 0 ? 'error.main' : 'inherit'} variant="body2">
          {formatNumber(row.errors)}
        </Typography>
      ),
    },
    { key: 'tokens', label: '总 Token', align: 'right', render: (row) => <Typography variant="body2" fontWeight={650}>{formatNumber(row.total_tokens)}</Typography> },
    { key: 'input', label: '输入', align: 'right', render: (row) => formatNumber(row.input_tokens) },
    { key: 'output', label: '输出', align: 'right', render: (row) => formatNumber(row.output_tokens) },
    { key: 'avg', label: '平均延迟', align: 'right', render: (row) => `${formatNumber(Math.round(row.avg_latency_ms))} ms` },
    { key: 'p95', label: 'P95', align: 'right', render: (row) => `${formatNumber(row.p95_latency_ms)} ms` },
  ] as Column<UsageRow>[];

  return (
    <>
      <PageHeader
        title="用量分析"
        subtitle="按时间、项目、用户、模型、协议与设备聚合网关权威 Token 计量。"
        actions={
          <Button
            variant="outlined"
            startIcon={<DownloadRoundedIcon />}
            onClick={() =>
              downloadFile(`/api/v1/admin/analytics/usage/export?${query}`, 'aicontrol-usage.csv').catch((err) =>
                setError(err instanceof Error ? err.message : '导出失败'),
              )
            }
          >
            导出 CSV
          </Button>
        }
      />
      <ErrorAlert error={error} />

      <SectionCard
        title="筛选条件"
        subtitle="按时间与维度聚合；表格列会随分组维度自动变化"
        sx={{ mb: 2.5 }}
        action={
          <Button variant="contained" startIcon={<SearchRoundedIcon />} onClick={() => void load()} disabled={loading} sx={{ height: 38 }}>
            应用筛选
          </Button>
        }
      >
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)', xl: 'repeat(6, 1fr)' },
            gap: 1.75,
            alignItems: 'center',
          }}
        >
          <TextField
            label="开始日期"
            type="date"
            size="small"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            label="结束日期"
            type="date"
            size="small"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          <FormControl size="small">
            <InputLabel>分组维度</InputLabel>
            <Select
              multiple
              value={groupBy}
              onChange={(event) => setGroupBy(typeof event.target.value === 'string' ? event.target.value.split(',') : event.target.value)}
              input={<OutlinedInput label="分组维度" />}
              renderValue={(selected) =>
                selected.map((value) => groupOptions.find((option) => option.value === value)?.label ?? value).join(' / ')
              }
            >
              {groupOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  <Checkbox size="small" checked={groupBy.includes(option.value)} />
                  <ListItemText primary={option.label} />
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField select size="small" label="项目" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            <MenuItem value="">全部</MenuItem>
            {projects.map((project) => (
              <MenuItem key={project.id} value={project.id}>
                {project.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField select size="small" label="用户" value={userId} onChange={(event) => setUserId(event.target.value)}>
            <MenuItem value="">全部</MenuItem>
            {users.map((user) => (
              <MenuItem key={user.id} value={user.id}>
                {user.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField select size="small" label="模型" value={modelId} onChange={(event) => setModelId(event.target.value)}>
            <MenuItem value="">全部</MenuItem>
            {models.map((model) => (
              <MenuItem key={model.id} value={model.id}>
                {model.alias}
              </MenuItem>
            ))}
          </TextField>
        </Box>
        <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, mr: 0.5 }}>
            快捷范围
          </Typography>
          <Chip
            size="small"
            label="今日"
            color={isToday ? 'primary' : 'default'}
            variant={isToday ? 'filled' : 'outlined'}
            onClick={() => {
              setFrom(today);
              setTo(today);
            }}
          />
          <Chip
            size="small"
            label="近 7 天"
            color={is7Days ? 'primary' : 'default'}
            variant={is7Days ? 'filled' : 'outlined'}
            onClick={() => {
              setFrom(dayjs().subtract(6, 'day').format('YYYY-MM-DD'));
              setTo(today);
            }}
          />
          <Chip
            size="small"
            label="近 30 天"
            color={is30Days ? 'primary' : 'default'}
            variant={is30Days ? 'filled' : 'outlined'}
            onClick={() => {
              setFrom(dayjs().subtract(29, 'day').format('YYYY-MM-DD'));
              setTo(today);
            }}
          />
          {data?.note && <Chip size="small" color="warning" variant="outlined" label={data.note} />}
        </Stack>
      </SectionCard>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 2, mb: 3 }}>
        <StatCard label="请求数" value={formatNumber(totals.requests)} hint={`错误 ${formatNumber(totals.errors)}`} />
        <StatCard label="总 Token" value={formatCompact(totals.tokens)} hint="当前筛选结果合计" tone="secondary" />
        <StatCard label="分组行数" value={formatNumber(rows.length)} hint={`按 ${groupBy.length} 个维度聚合`} tone="warning" />
      </Box>

      {chartRows.length > 0 && (
        <SectionCard title="Top 10 分组 Token" subtitle="按当前筛选与分组维度" sx={{ mb: 3 }}>
          <Box sx={{ width: '100%', height: 300 }}>
            <BarChart
              height={300}
              layout="horizontal"
              series={[
                {
                  data: chartRows.map((row) => row.total_tokens),
                  label: 'Token',
                  color: '#4f6ef7',
                  valueFormatter: (value: number | null) => formatCompact(value ?? 0),
                },
              ]}
              yAxis={[{ scaleType: 'band', data: chartLabels, tickLabelStyle: { fontSize: 11 }, width: 180 }]}
              xAxis={[{ valueFormatter: (value: number) => formatCompact(value) }]}
              margin={{ left: 0, right: 20, top: 10, bottom: 24 }}
              grid={{ vertical: true }}
            />
          </Box>
        </SectionCard>
      )}

      <SectionCard title="明细" subtitle="列随分组维度变化；最多返回 1000 行，导出包含完整字段">
        <DataTable
          loading={loading}
          rows={data?.rows ?? null}
          getKey={(row) => row.group_key + row.requests + row.total_tokens}
          columns={columns}
          maxHeight={560}
        />
      </SectionCard>
    </>
  );
}