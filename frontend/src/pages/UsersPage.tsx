import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import BlockRoundedIcon from '@mui/icons-material/BlockRounded';
import DevicesRoundedIcon from '@mui/icons-material/DevicesRounded';
import { api, ApiError } from '../api/client';
import type { AdminUser, Device } from '../api/types';
import { PageHeader, SectionCard } from '../components/PageHeader';
import { DataTable, ErrorAlert, StatusChip } from '../components/DataTable';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { formatDateTime, fromNow } from '../utils/format';

type PendingChange =
  | { kind: 'user'; user: AdminUser; role?: string; status?: string }
  | { kind: 'device'; device: Device };

export function UsersPage() {
  const [tab, setTab] = useState(0);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingChange | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [userRows, deviceRows] = await Promise.all([
        api<AdminUser[]>('/api/v1/admin/users'),
        api<Device[]>('/api/v1/admin/devices'),
      ]);
      setUsers(userRows);
      setDevices(deviceRows);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '加载用户与设备失败。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const applyChange = async () => {
    if (!pending) return;
    setActionError(null);
    try {
      if (pending.kind === 'user') {
        await api(`/api/v1/admin/users/${pending.user.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            role: pending.role ?? pending.user.role,
            status: pending.status ?? pending.user.status,
          }),
        });
      } else {
        await api(`/api/v1/admin/devices/${pending.device.id}`, { method: 'DELETE' });
      }
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : '操作失败。');
    }
  };

  return (
    <>
      <PageHeader
        title="用户与设备"
        subtitle="管理员可调整角色、停用账号与撤销设备；停用用户会立即吊销其全部刷新令牌。"
        actions={
          <Button variant="outlined" startIcon={<DevicesRoundedIcon />} onClick={() => setTab(1)}>
            查看设备
          </Button>
        }
      />
      <ErrorAlert error={error} />
      {actionError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>
          {actionError}
        </Alert>
      )}

      <SectionCard>
        <Tabs value={tab} onChange={(_, value: number) => setTab(value)} sx={{ mb: 2 }}>
          <Tab label={`用户（${users?.length ?? 0}）`} />
          <Tab label={`设备（${devices?.length ?? 0}）`} />
        </Tabs>

        {tab === 0 && (
          <DataTable
            loading={loading}
            rows={users}
            getKey={(row) => row.id}
            emptyText="暂无用户"
            columns={[
              {
                key: 'user',
                label: '用户',
                render: (row) => (
                  <Stack direction="row" spacing={1.5} alignItems="center">
                    <Avatar sx={{ width: 34, height: 34, bgcolor: 'primary.main', fontSize: 14, fontWeight: 700 }}>
                      {row.name.slice(0, 1)}
                    </Avatar>
                    <Box>
                      <Typography variant="body2" fontWeight={650}>
                        {row.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {row.email ?? row.union_id ?? row.id}
                      </Typography>
                    </Box>
                  </Stack>
                ),
              },
              {
                key: 'role',
                label: '角色',
                render: (row) => (
                  <TextField
                    select
                    size="small"
                    value={row.role}
                    onChange={(event) =>
                      setPending({ kind: 'user', user: row, role: event.target.value, status: row.status })
                    }
                    sx={{ width: 120 }}
                  >
                    <MenuItem value="admin">管理员</MenuItem>
                    <MenuItem value="user">用户</MenuItem>
                  </TextField>
                ),
              },
              {
                key: 'status',
                label: '状态',
                render: (row) => (
                  <Stack direction="row" spacing={1} alignItems="center">
                    <StatusChip status={row.status} />
                    <Button
                      size="small"
                      color={row.status === 'active' ? 'error' : 'success'}
                      onClick={() =>
                        setPending({
                          kind: 'user',
                          user: row,
                          role: row.role,
                          status: row.status === 'active' ? 'disabled' : 'active',
                        })
                      }
                    >
                      {row.status === 'active' ? '停用' : '启用'}
                    </Button>
                  </Stack>
                ),
              },
              {
                key: 'projects',
                label: '项目',
                render: (row) =>
                  row.projects.length === 0 ? (
                    <Typography variant="caption" color="text.secondary">
                      无
                    </Typography>
                  ) : (
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                      {row.projects.map((project) => (
                        <Chip key={project} size="small" label={project} variant="outlined" />
                      ))}
                    </Stack>
                  ),
              },
              { key: 'devices', label: '设备', align: 'right', render: (row) => row.device_count },
              { key: 'login', label: '最近登录', render: (row) => (row.last_login_at ? fromNow(row.last_login_at) : '-') },
            ]}
          />
        )}

        {tab === 1 && (
          <DataTable
            loading={loading}
            rows={devices}
            getKey={(row) => row.id}
            emptyText="暂无插件设备。终端执行 `aic login` 后会出现在这里。"
            columns={[
              {
                key: 'device',
                label: '设备',
                render: (row) => (
                  <Box>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <DevicesRoundedIcon fontSize="small" color="action" />
                      <Typography variant="body2" fontWeight={650}>
                        {row.name}
                      </Typography>
                    </Stack>
                    <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'ui-monospace, monospace' }}>
                      {row.id}
                    </Typography>
                  </Box>
                ),
              },
              { key: 'user', label: '用户', render: (row) => row.user_name ?? '-' },
              { key: 'os', label: '系统', render: (row) => row.os ?? '-' },
              {
                key: 'version',
                label: '客户端版本',
                render: (row) => (
                  <Box>
                    <Typography variant="caption" display="block">
                      插件 {row.plugin_version ?? '-'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" display="block">
                      Pi {row.pi_version ?? '-'}
                    </Typography>
                  </Box>
                ),
              },
              { key: 'lastSeen', label: '最近活跃', render: (row) => fromNow(row.last_seen_at) },
              { key: 'created', label: '创建时间', render: (row) => formatDateTime(row.created_at) },
              { key: 'status', label: '状态', render: (row) => <StatusChip status={row.status} /> },
              {
                key: 'actions',
                label: '操作',
                align: 'right',
                render: (row) =>
                  row.status === 'active' ? (
                    <Tooltip title="撤销该设备及全部令牌">
                      <Button
                        size="small"
                        color="error"
                        startIcon={<BlockRoundedIcon />}
                        onClick={() => setPending({ kind: 'device', device: row })}
                      >
                        撤销
                      </Button>
                    </Tooltip>
                  ) : (
                    <Typography variant="caption" color="text.secondary">
                      已撤销
                    </Typography>
                  ),
              },
            ]}
          />
        )}
      </SectionCard>

      <ConfirmDialog
        open={Boolean(pending)}
        title={pending?.kind === 'device' ? '撤销设备' : '确认变更用户'}
        description={
          pending?.kind === 'device'
            ? `确定撤销设备「${pending.device.name}」吗？该设备上的 CLI 将立即无法刷新令牌，需要重新登录。`
            : pending?.kind === 'user'
              ? `确定将「${pending.user.name}」的角色改为「${pending.role ?? pending.user.role}」、状态改为「${pending.status ?? pending.user.status}」吗？`
              : ''
        }
        destructive
        confirmText="确认"
        onClose={() => setPending(null)}
        onConfirm={applyChange}
      />
    </>
  );
}