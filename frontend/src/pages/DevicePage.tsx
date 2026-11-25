import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CircularProgress,
  Stack,
  TextField,
  Typography,
  alpha,
} from '@mui/material';
import DevicesRoundedIcon from '@mui/icons-material/DevicesRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import { api, ApiError } from '../api/client';
import type { DevicePending } from '../api/types';
import { formatDateTime } from '../utils/format';

export function DevicePage() {
  const [params] = useSearchParams();
  const [code, setCode] = useState(params.get('user_code') ?? '');
  const [pending, setPending] = useState<DevicePending | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<'approved' | 'denied' | null>(null);

  const lookup = async (value: string) => {
    const normalized = value.trim().toUpperCase();
    if (!normalized) {
      setError('请输入终端中显示的授权码。');
      return;
    }
    setLoading(true);
    setError(null);
    setPending(null);
    try {
      const data = await api<DevicePending>(`/api/v1/plugin/device/pending?user_code=${encodeURIComponent(normalized)}`);
      setPending(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '查询授权码失败。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const initial = params.get('user_code');
    if (initial) void lookup(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const decide = async (approve: boolean) => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/v1/plugin/auth/device/${approve ? 'approve' : 'deny'}`, {
        method: 'POST',
        body: JSON.stringify({ user_code: pending.user_code }),
      });
      setResult(approve ? 'approved' : 'denied');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '操作失败。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        p: 2,
        background: (theme) =>
          `radial-gradient(circle at 15% 20%, ${alpha(theme.palette.primary.main, 0.12)}, transparent 40%), ${theme.palette.background.default}`,
      }}
    >
      <Card sx={{ width: '100%', maxWidth: 520, p: { xs: 3, sm: 4 } }}>
        <Stack alignItems="center" spacing={1.5} sx={{ mb: 3 }}>
          <Box
            sx={{
              width: 56,
              height: 56,
              borderRadius: 3,
              display: 'grid',
              placeItems: 'center',
              bgcolor: (theme) => alpha(theme.palette.primary.main, 0.12),
              color: 'primary.main',
            }}
          >
            {result ? <CheckCircleRoundedIcon fontSize="large" /> : <DevicesRoundedIcon fontSize="large" />}
          </Box>
          <Typography variant="h2" textAlign="center">
            {result === 'approved' ? '设备授权成功' : result === 'denied' ? '已拒绝本次授权' : '授权 CLI 设备'}
          </Typography>
          <Typography variant="body2" color="text.secondary" textAlign="center">
            {result
              ? '请返回终端继续操作，现在可以关闭此页面。'
              : '请确认授权码与终端中显示的一致，批准后该设备将获得短期网关令牌。'}
          </Typography>
        </Stack>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {result ? (
          <Alert severity={result === 'approved' ? 'success' : 'info'}>
            {result === 'approved' ? 'CLI 将在数秒内完成登录。' : 'CLI 端会收到拒绝状态，请重新发起登录。'}
          </Alert>
        ) : (
          <>
            <Stack direction="row" spacing={1.25} sx={{ mb: 2 }}>
              <TextField
                fullWidth
                label="授权码"
                placeholder="例如 A7K-2QP"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void lookup(code);
                }}
                inputProps={{ style: { letterSpacing: '0.18em', fontWeight: 700, fontFamily: 'ui-monospace, monospace' } }}
              />
              <Button variant="outlined" onClick={() => void lookup(code)} disabled={loading} sx={{ minWidth: 96 }}>
                {loading ? <CircularProgress size={20} /> : '查询'}
              </Button>
            </Stack>

            {pending && (
              <Box sx={{ p: 2, borderRadius: 2, border: 1, borderColor: 'divider', mb: 2 }}>
                <Stack spacing={0.75}>
                  <Row label="设备" value={pending.device_name} />
                  <Row label="系统" value={pending.os ?? '-'} />
                  <Row label="插件版本" value={pending.plugin_version ?? '-'} />
                  <Row label="有效期至" value={formatDateTime(pending.expires_at)} />
                  <Row label="状态" value={pending.status} />
                </Stack>
              </Box>
            )}

            {pending && pending.status === 'pending' && (
              <Stack direction="row" spacing={1.25}>
                <Button fullWidth variant="contained" disabled={busy} onClick={() => void decide(true)}>
                  {busy ? <CircularProgress size={20} color="inherit" /> : '批准授权'}
                </Button>
                <Button fullWidth variant="outlined" color="error" disabled={busy} onClick={() => void decide(false)}>
                  拒绝
                </Button>
              </Stack>
            )}
            {pending && pending.status !== 'pending' && (
              <Alert severity="info">该授权码当前状态为「{pending.status}」，无法再次操作。</Alert>
            )}
          </>
        )}
      </Card>
    </Box>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" justifyContent="space-between" spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" fontWeight={600} sx={{ wordBreak: 'break-all', textAlign: 'right' }}>
        {value}
      </Typography>
    </Stack>
  );
}