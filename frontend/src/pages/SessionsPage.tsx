import { useEffect, useMemo, useState } from 'react';
import { Box, Chip, MenuItem, Stack, TextField, Typography } from '@mui/material';
import ForumRoundedIcon from '@mui/icons-material/ForumRounded';
import DataUsageRoundedIcon from '@mui/icons-material/DataUsageRounded';
import TimelineRoundedIcon from '@mui/icons-material/TimelineRounded';
import dayjs from 'dayjs';
import { api, ApiError } from '../api/client';
import type { AdminUser, ProjectListItem, SessionRow } from '../api/types';
import { PageHeader, SectionCard } from '../components/PageHeader';
import { DataTable, ErrorAlert } from '../components/DataTable';
import { StatCard } from '../components/StatCard';
import { formatDateTime, formatNumber } from '../utils/format';

export function SessionsPage() {
  const [days, setDays] = useState(7);
  const [projectId, setProjectId] = useState('');
  const [userId, setUserId] = useState('');
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<ProjectListItem[]>('/api/v1/admin/projects').then(setProjects).catch(() => undefined);
    api<AdminUser[]>('/api/v1/admin/users').then(setUsers).catch(() => undefined);
  }, []);

  const query = useMemo(() => {
    const now = dayjs();
    const params = new URLSearchParams({
      from: now.subtract(days - 1, 'day').startOf('day').toISOString(),
      to: now.toISOString(),
      limit: '300',
    });
    if (projectId) params.set('project_id', projectId);
    if (userId) params.set('user_id', userId);
    return params.toString();
  }, [days, projectId, userId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api<SessionRow[]>(`/api/v1/admin/analytics/sessions?${query}`)
      .then((result) => {
        if (!cancelled) setRows(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : '加载会话失败。');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  const totals = (rows ?? []).reduce(
    (acc, row) => ({
      sessions: acc.sessions + 1,
      turns: acc.turns + row.turn_count,
      tools: acc.tools + row.tool_call_count,
      tokens: acc.tokens + row.tokens,
    }),
    { sessions: 0, turns: 0, tools: 0, tokens: 0 },
  );

  return (
    <>
      <PageHeader
        title="会话明细"
        subtitle="仅展示会话元数据：客户端、项目、仓库展示名、轮次、工具调用与 Token，不包含 Prompt 与代码内容。"
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
            <TextField select size="small" label="用户" value={userId} onChange={(event) => setUserId(event.target.value)} sx={{ minWidth: 140 }}>
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

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 2, mb: 2.5 }}>
        <StatCard label="会话数" value={formatNumber(totals.sessions)} hint="当前筛选范围" icon={<TimelineRoundedIcon />} />
        <StatCard label="轮次 / 工具调用" value={`${formatNumber(totals.turns)} / ${formatNumber(totals.tools)}`} hint="来自插件遥测" icon={<ForumRoundedIcon />} tone="secondary" />
        <StatCard label="关联 Token" value={formatNumber(totals.tokens)} hint="按会话关联的网关计量" icon={<DataUsageRoundedIcon />} tone="warning" />
      </Box>

      <SectionCard title="会话列表" subtitle="按开始时间倒序，仅元数据">
        <DataTable
          loading={loading}
          rows={rows}
          getKey={(row) => row.id}
          emptyText="当前范围内暂无会话"
          columns={[
            {
              key: 'session',
              label: '会话',
              render: (row) => (
                <Box>
                  <Typography variant="body2" fontWeight={650} sx={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
                    {row.session_id.length > 26 ? `${row.session_id.slice(0, 26)}…` : row.session_id}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {row.cwd_basename ?? '-'}
                  </Typography>
                  {row.repo_display && (
                    <Typography variant="caption" color="text.secondary" display="block" noWrap sx={{ maxWidth: 240 }}>
                      {row.repo_display}
                    </Typography>
                  )}
                </Box>
              ),
            },
            { key: 'user', label: '用户', render: (row) => row.user_name },
            {
              key: 'project',
              label: '项目',
              render: (row) =>
                row.project_key ? (
                  <Chip size="small" label={row.project_name ?? row.project_key} variant="outlined" />
                ) : (
                  <Chip size="small" label="未归因" color="warning" variant="outlined" />
                ),
            },
            { key: 'client', label: '客户端', render: (row) => <Chip size="small" label={row.client} /> },
            {
              key: 'started',
              label: '开始 / 结束',
              render: (row) => (
                <Box>
                  <Typography variant="caption" display="block">{formatDateTime(row.started_at)}</Typography>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {row.ended_at ? formatDateTime(row.ended_at) : '-'}
                  </Typography>
                </Box>
              ),
            },
            { key: 'turns', label: '轮次', align: 'right', render: (row) => formatNumber(row.turn_count) },
            { key: 'tools', label: '工具调用', align: 'right', render: (row) => formatNumber(row.tool_call_count) },
            { key: 'tokens', label: 'Token', align: 'right', render: (row) => formatNumber(row.tokens) },
            { key: 'status', label: '状态', render: (row) => <Chip size="small" label={row.status} variant="outlined" /> },
          ]}
        />
      </SectionCard>

      <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="caption" color="text.secondary">
          提示：未归因会话会在插件下次上报项目后自动归因；历史用量不会自动重算。
        </Typography>
      </Stack>
    </>
  );
}