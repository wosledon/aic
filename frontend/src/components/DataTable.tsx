import type { ReactNode } from 'react';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import InboxRoundedIcon from '@mui/icons-material/InboxRounded';

export interface Column<T> {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  width?: number | string;
  render: (row: T) => ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  getKey,
  loading,
  error,
  emptyText = '暂无数据',
  maxHeight,
}: {
  columns: Column<T>[];
  rows: T[] | null;
  getKey: (row: T) => string | number;
  loading?: boolean;
  error?: string | null;
  emptyText?: string;
  maxHeight?: number | string;
}) {
  if (loading) {
    return (
      <Box sx={{ py: 8, display: 'grid', placeItems: 'center' }}>
        <CircularProgress size={32} />
      </Box>
    );
  }
  if (error) {
    return <Alert severity="error">{error}</Alert>;
  }
  if (!rows || rows.length === 0) {
    return (
      <Stack alignItems="center" spacing={1.5} sx={{ py: 8, color: 'text.secondary' }}>
        <Box
          sx={{
            width: 52,
            height: 52,
            borderRadius: '16px',
            display: 'grid',
            placeItems: 'center',
            bgcolor: 'action.hover',
          }}
        >
          <InboxRoundedIcon sx={{ fontSize: 26, opacity: 0.5 }} />
        </Box>
        <Typography variant="body2">{emptyText}</Typography>
      </Stack>
    );
  }
  return (
    <TableContainer sx={{ maxHeight, overflowX: 'auto', width: '100%', maxWidth: '100%' }}>
      <Table stickyHeader={Boolean(maxHeight)} size="medium">
        <TableHead>
          <TableRow>
            {columns.map((column) => (
              <TableCell key={column.key} align={column.align ?? 'left'} sx={{ width: column.width }}>
                {column.label}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={getKey(row)} hover>
              {columns.map((column) => (
                <TableCell key={column.key} align={column.align ?? 'left'}>
                  {column.render(row)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

export function StatusChip({ status }: { status: string | null | undefined }) {
  const normalized = (status ?? '').toLowerCase();
  const map: Record<string, { label: string; color: 'success' | 'default' | 'warning' | 'error' | 'info' }> = {
    active: { label: '启用', color: 'success' },
    enabled: { label: '启用', color: 'success' },
    approved: { label: '已批准', color: 'success' },
    disabled: { label: '停用', color: 'default' },
    archived: { label: '已归档', color: 'default' },
    pending: { label: '待审批', color: 'warning' },
    maintenance: { label: '维护中', color: 'warning' },
    expired: { label: '已过期', color: 'default' },
    consumed: { label: '已使用', color: 'default' },
    denied: { label: '已拒绝', color: 'error' },
    revoked: { label: '已撤销', color: 'error' },
    failed: { label: '失败', color: 'error' },
  };
  const meta = map[normalized] ?? { label: status || '-', color: 'info' as const };
  return <Chip size="small" label={meta.label} color={meta.color} variant={meta.color === 'default' ? 'outlined' : 'filled'} />;
}

export function ErrorAlert({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <Alert severity="error" sx={{ mb: 2 }}>
      {error instanceof Error ? error.message : String(error)}
    </Alert>
  );
}