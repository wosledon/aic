import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import dayjs from 'dayjs';
import { api, ApiError } from '../api/client';
import type { AuditLogRow } from '../api/types';
import { PageHeader, SectionCard } from '../components/PageHeader';
import { DataTable, ErrorAlert } from '../components/DataTable';
import { formatDateTime } from '../utils/format';

export function AuditPage() {
  const [rows, setRows] = useState<AuditLogRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [from, setFrom] = useState(dayjs().subtract(7, 'day').format('YYYY-MM-DD'));
  const [to, setTo] = useState(dayjs().format('YYYY-MM-DD'));
  const [detail, setDetail] = useState<AuditLogRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: '300',
        from: dayjs(from).startOf('day').toISOString(),
        to: dayjs(to).endOf('day').toISOString(),
      });
      if (action) params.set('action', action);
      if (actor) params.set('actor', actor);
      setRows(await api<AuditLogRow[]>(`/api/v1/admin/audit-logs?${params.toString()}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '加载审计日志失败。');
    } finally {
      setLoading(false);
    }
  }, [action, actor, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <PageHeader title="审计日志" subtitle="只追加的管理操作与登录、设备、密钥轮换记录；不包含 Prompt 与代码内容。" />
      <ErrorAlert error={error} />

      <SectionCard sx={{ mb: 2 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(5, 1fr)' }, gap: 2 }}>
          <TextField label="开始日期" type="date" size="small" value={from} onChange={(event) => setFrom(event.target.value)} InputLabelProps={{ shrink: true }} />
          <TextField label="结束日期" type="date" size="small" value={to} onChange={(event) => setTo(event.target.value)} InputLabelProps={{ shrink: true }} />
          <TextField label="操作类型" size="small" placeholder="如 channel.create" value={action} onChange={(event) => setAction(event.target.value)} />
          <TextField label="操作人" size="small" value={actor} onChange={(event) => setActor(event.target.value)} />
          <Button variant="contained" startIcon={<SearchRoundedIcon />} onClick={() => void load()} disabled={loading}>
            查询
          </Button>
        </Box>
      </SectionCard>

      <SectionCard title="操作记录" subtitle="按时间倒序，最多 300 条">
        <DataTable
          loading={loading}
          rows={rows}
          getKey={(row) => row.id}
          emptyText="当前条件下没有审计记录"
          columns={[
            { key: 'time', label: '时间', render: (row) => formatDateTime(row.created_at) },
            { key: 'actor', label: '操作人', render: (row) => <Typography variant="body2" fontWeight={600}>{row.actor_name || '-'}</Typography> },
            {
              key: 'action',
              label: '操作',
              render: (row) => (
                <Typography variant="body2" sx={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
                  {row.action}
                </Typography>
              ),
            },
            {
              key: 'target',
              label: '对象',
              render: (row) => (
                <Box>
                  <Typography variant="caption" display="block">
                    {row.target_type ?? '-'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'ui-monospace, monospace' }}>
                    {row.target_id ?? '-'}
                  </Typography>
                </Box>
              ),
            },
            { key: 'ip', label: 'IP', render: (row) => row.ip ?? '-' },
            {
              key: 'detail',
              label: '详情',
              align: 'right',
              render: (row) => (
                <Button size="small" disabled={row.detail === null} onClick={() => setDetail(row)}>
                  查看
                </Button>
              ),
            },
          ]}
        />
      </SectionCard>

      <Dialog open={Boolean(detail)} onClose={() => setDetail(null)} maxWidth="sm" fullWidth>
        <DialogTitle>审计详情 · {detail?.action}</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
              {formatDateTime(detail?.created_at)} · {detail?.actor_name} · {detail?.ip ?? '-'}
            </Typography>
            <Box
              component="pre"
              sx={{
                m: 0,
                p: 2,
                borderRadius: 2,
                bgcolor: 'action.hover',
                fontSize: 12.5,
                overflow: 'auto',
                maxHeight: 400,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              }}
            >
              {JSON.stringify(detail?.detail ?? null, null, 2)}
            </Box>
            <Typography variant="caption" color="text.secondary">
              User-Agent：{detail?.user_agent ?? '-'}
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetail(null)}>关闭</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}