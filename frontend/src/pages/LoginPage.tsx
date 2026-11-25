import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CircularProgress,
  Divider,
  Stack,
  TextField,
  Typography,
  alpha,
} from '@mui/material';
import LoginRoundedIcon from '@mui/icons-material/LoginRounded';
import ShieldRoundedIcon from '@mui/icons-material/ShieldRounded';
import KeyRoundedIcon from '@mui/icons-material/KeyRounded';
import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded';
import { useAuth } from '../auth/AuthProvider';
import { ApiError } from '../api/client';

const errorMessages: Record<string, string> = {
  feishu_not_configured: '飞书登录尚未配置，请联系管理员，或使用开发登录。',
  feishu_denied: '你已取消飞书授权。',
  state_expired: '登录状态已过期，请重新发起登录。',
  feishu_error: '飞书登录失败，请稍后重试。',
  user_not_provisioned: '账号尚未开通，请联系管理员。',
  user_disabled: '账号已被停用，请联系管理员。',
};

const feishuErrorHints: Record<string, string> = {
  '20003': '授权码无效或已被使用，请重新发起登录。',
  '20010': '当前账号不在应用可用范围内。请在飞书开放平台「应用发布 → 可用范围」加入自己，或改用有权限的企业账号。',
  '20027': '授权页请求的 Scope 中包含应用未开通的权限。请清空 Scope，或先在「权限管理」开通后发布版本。',
  '20029': '回调地址与应用「安全设置 → 重定向 URL」不一致。',
  '20037': '授权请求参数不完整，请检查 App ID 与回调地址。',
  '20064': '授权码已失效或重复使用，请重新发起登录。',
  '20068': '请求的 Scope 超出应用已开通的权限。请清空 Scope，或先在权限管理中开通并发布版本。',
  '20005': '获取到的 user_access_token 无效，请重新登录。',
  invalid_grant: '授权码无效或已被使用，请重新发起登录。',
  invalid_client: 'App ID 或 App Secret 不正确，请在系统设置中重新填写。',
  invalid_scope: '请求的 Scope 不被应用支持，请清空 Scope 后重试。',
};

function describeError(code: string | null): string | null {
  if (!code) return null;
  const known = errorMessages[code];
  if (known) return known;
  if (code.startsWith('feishu_error_')) {
    const raw = code.slice('feishu_error_'.length);
    const hint = feishuErrorHints[raw];
    return hint ? `飞书登录失败（${raw}）：${hint}` : `飞书登录失败（错误码 ${raw}），请检查应用权限与可用范围。`;
  }
  return null;
}

const demoAccounts = [
  { email: 'admin@aic.local', label: '管理员', desc: 'AIC 管理员 · 全部管理权限' },
  { email: 'dev@aic.local', label: '开发者', desc: '示例开发者 · 普通用户' },
  { email: 'lisi@aic.local', label: '开发者', desc: '李思 · 普通用户' },
];

export function LoginPage() {
  const { user, loading, config, loginDev } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returnUrl = params.get('return_url') || '/';
  const [email, setEmail] = useState('admin@aic.local');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) navigate(returnUrl, { replace: true });
  }, [user, navigate, returnUrl]);

  const errorCode = params.get('error');

  const handleDevLogin = async () => {
    setBusy(true);
    setError(null);
    try {
      await loginDev(email);
      navigate(returnUrl, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登录失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: '1.05fr 1fr' },
        bgcolor: 'background.default',
      }}
    >
      <Box
        sx={{
          display: { xs: 'none', md: 'flex' },
          flexDirection: 'column',
          justifyContent: 'space-between',
          p: 6,
          color: '#fff',
          background:
            'radial-gradient(circle at 18% 12%, rgba(79,110,247,0.55), transparent 42%), radial-gradient(circle at 82% 78%, rgba(14,165,164,0.35), transparent 45%), #0d1730',
        }}
      >
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Box
            sx={{
              width: 46,
              height: 46,
              borderRadius: '14px',
              display: 'grid',
              placeItems: 'center',
              fontWeight: 800,
              background: 'linear-gradient(135deg, #4f6ef7 0%, #0ea5a4 100%)',
            }}
          >
            AIC
          </Box>
          <Box>
            <Typography fontWeight={750} fontSize={20}>
              AIControl
            </Typography>
            <Typography fontSize={12} sx={{ color: 'rgba(255,255,255,0.6)' }}>
              企业级大模型网关
            </Typography>
          </Box>
        </Stack>

        <Box sx={{ maxWidth: 520 }}>
          <Typography variant="h1" sx={{ fontSize: { md: '2.6rem', lg: '3rem' }, lineHeight: 1.15, mb: 2 }}>
            一个入口，
            <br />
            管住每一次模型调用。
          </Typography>
          <Typography sx={{ color: 'rgba(255,255,255,0.66)', fontSize: 16, lineHeight: 1.8, mb: 4 }}>
            上游密钥零下发，飞书统一登录，按人 / 项目 / 模型 / 会话归因 Token 用量，并把高风险工具审批变成可追溯的治理数据。
          </Typography>
          <Stack spacing={2}>
            {[
              { icon: <ShieldRoundedIcon />, title: '密钥零下发', desc: '上游凭据只存在于服务端加密存储' },
              { icon: <KeyRoundedIcon />, title: '一次登录，多端使用', desc: 'Pi、Codex、Claude Code、Copilot CLI 统一接入' },
              { icon: <InsightsRoundedIcon />, title: 'Token 可解释', desc: '按项目、模型、用户、会话多维分析' },
            ].map((item) => (
              <Stack key={item.title} direction="row" spacing={1.75} alignItems="flex-start">
                <Box
                  sx={{
                    width: 40,
                    height: 40,
                    borderRadius: 2,
                    display: 'grid',
                    placeItems: 'center',
                    bgcolor: 'rgba(255,255,255,0.08)',
                    color: '#9db1ff',
                    flexShrink: 0,
                  }}
                >
                  {item.icon}
                </Box>
                <Box>
                  <Typography fontWeight={650}>{item.title}</Typography>
                  <Typography fontSize={13} sx={{ color: 'rgba(255,255,255,0.55)' }}>
                    {item.desc}
                  </Typography>
                </Box>
              </Stack>
            ))}
          </Stack>
        </Box>

        <Typography fontSize={12} sx={{ color: 'rgba(255,255,255,0.35)' }}>
          默认不存储 Prompt、代码与命令原文 · Demo 仅做 Token 计量
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', p: { xs: 2, sm: 4 } }}>
        <Card sx={{ width: '100%', maxWidth: 460, p: { xs: 3, sm: 4 } }}>
          <Typography variant="h2">登录控制台</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75, mb: 3 }}>
            使用飞书账号登录，或使用演示账号快速体验。
          </Typography>

          {(errorCode || error) && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
              {error ?? describeError(errorCode) ?? '登录失败，请重试。'}
            </Alert>
          )}

          <Button
            fullWidth
            size="large"
            variant="contained"
            startIcon={<LoginRoundedIcon />}
            disabled={!config?.feishu_enabled || !config?.console_sso_enabled}
            onClick={() => {
              window.location.href = `/api/v1/auth/feishu/start?return_url=${encodeURIComponent(returnUrl)}`;
            }}
            sx={{ py: 1.25 }}
          >
            飞书 SSO 登录
          </Button>
          {!config?.feishu_enabled && (
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
              飞书登录尚未启用，管理员可在「系统设置 → 飞书登录」中配置。
            </Typography>
          )}
          {config?.feishu_enabled && (
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
              若提示「无法授予的权限」，多为个人版（豆包）租户或权限未发布：飞书个人版无法使用企业自建应用。可在「系统设置 → 飞书登录 → 权限自检」查看具体原因。
            </Typography>
          )}

          {config?.dev_login_enabled && (
            <>
              <Divider sx={{ my: 3 }}>
                <Typography variant="caption" color="text.secondary">
                  演示账号
                </Typography>
              </Divider>
              <Stack spacing={1} sx={{ mb: 2 }}>
                {demoAccounts.map((account) => (
                  <Box
                    key={account.email}
                    onClick={() => setEmail(account.email)}
                    sx={{
                      p: 1.5,
                      borderRadius: 2,
                      border: 1,
                      cursor: 'pointer',
                      borderColor: email === account.email ? 'primary.main' : 'divider',
                      bgcolor: email === account.email ? (theme) => alpha(theme.palette.primary.main, 0.06) : 'transparent',
                      transition: '0.15s',
                      '&:hover': { borderColor: 'primary.main' },
                    }}
                  >
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Box>
                        <Typography fontSize={14} fontWeight={650}>
                          {account.email}
                        </Typography>
                        <Typography fontSize={12} color="text.secondary">
                          {account.desc}
                        </Typography>
                      </Box>
                      <Typography fontSize={12} color="primary.main" fontWeight={650}>
                        {account.label}
                      </Typography>
                    </Stack>
                  </Box>
                ))}
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
                <TextField
                  fullWidth
                  size="small"
                  label="登录邮箱"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void handleDevLogin();
                  }}
                />
                <Button
                  variant="outlined"
                  onClick={handleDevLogin}
                  disabled={busy}
                  sx={{ minWidth: 110, py: { xs: 1, sm: 0 } }}
                >
                  {busy ? <CircularProgress size={20} /> : '开发登录'}
                </Button>
              </Stack>
            </>
          )}

          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 3 }}>
            登录即表示你同意平台按《数据处理说明》仅采集模型、Token、项目、会话与审批元数据，不采集 Prompt 与代码内容。
          </Typography>
        </Card>
      </Box>
    </Box>
  );
}