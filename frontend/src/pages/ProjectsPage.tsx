import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  Divider,
  Drawer,
  IconButton,
  LinearProgress,
  Stack,
  Typography,
  alpha,
} from '@mui/material';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import FolderRoundedIcon from '@mui/icons-material/FolderRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import dayjs from 'dayjs';
import { api, ApiError } from '../api/client';
import type { OverviewResponse, ProjectDetail, ProjectListItem } from '../api/types';
import { PageHeader, SectionCard } from '../components/PageHeader';
import { ErrorAlert, StatusChip } from '../components/DataTable';
import { StatCard } from '../components/StatCard';
import { formatCompact, formatNumber } from '../utils/format';

export function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectListItem[] | null>(null);
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const now = dayjs();
      const [projectRows, overviewData] = await Promise.all([
        api<ProjectListItem[]>('/api/v1/admin/projects'),
        api<OverviewResponse>(
          `/api/v1/admin/analytics/overview?from=${encodeURIComponent(
            now.subtract(6, 'day').startOf('day').toISOString(),
          )}&to=${encodeURIComponent(now.toISOString())}`,
        ),
      ]);
      setProjects(projectRows);
      setOverview(overviewData);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '加载项目用量失败。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!detailId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    api<ProjectDetail>(`/api/v1/admin/projects/${detailId}`)
      .then(setDetail)
      .catch((err) => setError(err instanceof ApiError ? err.message : '加载项目详情失败。'))
      .finally(() => setDetailLoading(false));
  }, [detailId]);

  const usageByKey = useMemo(
    () => new Map((overview?.projects ?? []).map((item) => [item.project_key, item])),
    [overview],
  );
  const maxTokens = Math.max(1, ...(overview?.projects ?? []).map((item) => item.tokens));
  const totalTokens = (overview?.projects ?? []).reduce((sum, item) => sum + item.tokens, 0);
  const totalMembers = (projects ?? []).reduce((sum, item) => sum + item.member_count, 0);
  const unattributed = (overview?.projects ?? []).find((item) => item.project_key === 'unattributed');

  return (
    <>
      <PageHeader
        title="项目用量"
        subtitle="项目由插件与网关自动上报建档，无需手工创建；这里只读展示归因、成员、仓库与 Token 用量。"
        actions={
          <Button variant="outlined" startIcon={<RefreshRoundedIcon />} onClick={() => void load()} disabled={loading}>
            刷新
          </Button>
        }
      />
      <ErrorAlert error={error} />

      <Alert severity="info" icon={<AutoAwesomeRoundedIcon />} sx={{ mb: 2.5 }}>
        插件在会话开始与每次请求时自动上报 project_key、项目名与仓库；平台自动建档并记录参与成员。管理员只需在「策略与配额」中按需设置配额。
      </Alert>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 2, mb: 2.5 }}>
        <StatCard label="项目数" value={formatNumber(projects?.length ?? 0)} hint="全部由客户端自动上报" icon={<FolderRoundedIcon />} />
        <StatCard label="成员关系" value={formatNumber(totalMembers)} hint="按项目累计，自动发现" icon={<GroupsRoundedIcon />} tone="secondary" />
        <StatCard label="近 7 天 Token" value={formatCompact(totalTokens)} hint="当前项目归因合计" tone="warning" />
      </Box>

      {loading && !projects ? (
        <SectionCard>
          <Typography color="text.secondary">加载中…</Typography>
        </SectionCard>
      ) : (projects ?? []).length === 0 ? (
        <SectionCard>
          <Stack alignItems="center" spacing={1.5} sx={{ py: 7 }}>
            <Box sx={{ width: 56, height: 56, borderRadius: '18px', display: 'grid', placeItems: 'center', bgcolor: 'action.hover', color: 'primary.main' }}>
              <FolderRoundedIcon />
            </Box>
            <Typography variant="h4">还没有项目上报</Typography>
            <Typography variant="body2" color="text.secondary" textAlign="center" sx={{ maxWidth: 460 }}>
              安装插件并执行 aic login 后，在仓库中开始一次会话即可自动出现。
            </Typography>
          </Stack>
        </SectionCard>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)', xl: 'repeat(3, 1fr)' }, gap: 2.25 }}>
          {(projects ?? []).map((project) => {
            const usage = usageByKey.get(project.key);
            const tokens = usage?.tokens ?? 0;
            const requests = usage?.requests ?? 0;
            return (
              <Card
                key={project.id}
                onClick={() => setDetailId(project.id)}
                sx={{
                  cursor: 'pointer',
                  p: 2.5,
                  '&:hover': {
                    transform: 'translateY(-3px)',
                    borderColor: 'primary.main',
                    boxShadow: (theme) =>
                      theme.palette.mode === 'light'
                        ? '0 24px 54px rgba(91,108,255,0.16)'
                        : '0 24px 54px rgba(0,0,0,0.5)',
                  },
                }}
              >
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1.5}>
                  <Stack direction="row" spacing={1.4} alignItems="center" sx={{ minWidth: 0 }}>
                    <Box
                      sx={{
                        width: 44,
                        height: 44,
                        borderRadius: '13px',
                        display: 'grid',
                        placeItems: 'center',
                        flexShrink: 0,
                        color: 'primary.main',
                        bgcolor: (theme) => alpha(theme.palette.primary.main, 0.1),
                      }}
                    >
                      <FolderRoundedIcon />
                    </Box>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="h4" noWrap>
                        {project.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" noWrap sx={{ fontFamily: 'ui-monospace, monospace' }}>
                        {project.key}
                      </Typography>
                    </Box>
                  </Stack>
                  <StatusChip status={project.status} />
                </Stack>

                <Stack direction="row" justifyContent="space-between" alignItems="flex-end" sx={{ mt: 2.4, mb: 0.8 }}>
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      近 7 天 Token
                    </Typography>
                    <Typography sx={{ fontSize: '1.55rem', fontWeight: 780, letterSpacing: '-0.03em', lineHeight: 1.2 }}>
                      {formatCompact(tokens)}
                    </Typography>
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    {formatNumber(requests)} 次请求
                  </Typography>
                </Stack>
                <LinearProgress variant="determinate" value={(tokens / maxTokens) * 100} sx={{ height: 7, mb: 2 }} />

                <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                  <Chip size="small" label={`${project.member_count} 位成员`} variant="outlined" />
                  <Chip size="small" label={`${project.repo_count} 个仓库`} variant="outlined" />
                </Stack>

                <Divider sx={{ my: 1.8 }} />
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="caption" color="text.secondary">
                    最近上报 {dayjs(project.updated_at).format('MM-DD HH:mm')}
                  </Typography>
                  <Stack direction="row" alignItems="center" spacing={0.3} sx={{ color: 'primary.main' }}>
                    <Typography variant="caption" fontWeight={700}>
                      查看详情
                    </Typography>
                    <ChevronRightRoundedIcon sx={{ fontSize: 17 }} />
                  </Stack>
                </Stack>
              </Card>
            );
          })}

          {unattributed && (
            <Card sx={{ p: 2.5, borderStyle: 'dashed' }}>
              <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                <Box
                  sx={{
                    width: 44,
                    height: 44,
                    borderRadius: '13px',
                    display: 'grid',
                    placeItems: 'center',
                    color: 'warning.main',
                    bgcolor: (theme) => alpha(theme.palette.warning.main, 0.12),
                  }}
                >
                  <WarningAmberRoundedIcon />
                </Box>
                <Chip size="small" color="warning" variant="outlined" label="未归因" />
              </Stack>
              <Typography variant="h4" sx={{ mt: 1.75 }}>
                未归因请求
              </Typography>
              <Typography variant="caption" color="text.secondary">
                未匹配到任何项目 key 的网关调用
              </Typography>
              <Stack direction="row" justifyContent="space-between" alignItems="flex-end" sx={{ mt: 2.2 }}>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    近 7 天 Token
                  </Typography>
                  <Typography sx={{ fontSize: '1.55rem', fontWeight: 780, letterSpacing: '-0.03em', lineHeight: 1.2 }}>
                    {formatCompact(unattributed.tokens)}
                  </Typography>
                </Box>
                <Typography variant="caption" color="text.secondary">
                  {formatNumber(unattributed.requests)} 次请求
                </Typography>
              </Stack>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 2 }}>
                插件下次上报项目后会自动归因，历史数据不会强制分摊。
              </Typography>
            </Card>
          )}

          <Card sx={{ p: 2.5, background: (theme) => `linear-gradient(145deg, ${alpha(theme.palette.primary.main, 0.07)}, ${alpha(theme.palette.secondary.main, 0.05)})` }}>
            <Box
              sx={{
                width: 44,
                height: 44,
                borderRadius: '13px',
                display: 'grid',
                placeItems: 'center',
                color: 'primary.main',
                bgcolor: (theme) => alpha(theme.palette.primary.main, 0.12),
              }}
            >
              <AutoAwesomeRoundedIcon />
            </Box>
            <Typography variant="h4" sx={{ mt: 1.75 }}>
              归因自动完成
            </Typography>
            <Stack spacing={1.1} sx={{ mt: 1.5 }}>
              {['插件读取 Git remote 并做规范化', '上报项目 key、项目名与仓库', '平台自动建档并记录参与成员'].map((text, index) => (
                <Stack key={text} direction="row" spacing={1.1} alignItems="center">
                  <Box
                    sx={{
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: 10,
                      fontWeight: 800,
                      color: 'primary.main',
                      bgcolor: (theme) => alpha(theme.palette.primary.main, 0.12),
                    }}
                  >
                    {index + 1}
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    {text}
                  </Typography>
                </Stack>
              ))}
            </Stack>
            <Chip size="small" color="primary" variant="outlined" label="无需管理员维护" sx={{ mt: 1.8 }} />
          </Card>
        </Box>
      )}

      <Drawer
        anchor="right"
        open={Boolean(detailId)}
        onClose={() => setDetailId(null)}
        slotProps={{ paper: { sx: { width: { xs: '100%', sm: 520 } } } }}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ p: 2.75, borderBottom: 1, borderColor: 'divider' }}>
            <Box>
              <Typography variant="h3">{detail?.name ?? '项目详情'}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'ui-monospace, monospace' }}>
                {detail?.key}
              </Typography>
            </Box>
            <IconButton onClick={() => setDetailId(null)} aria-label="关闭">
              <CloseRoundedIcon />
            </IconButton>
          </Stack>

          <Box sx={{ p: 2.75, overflowY: 'auto', flex: 1 }}>
            {detailLoading && <Typography color="text.secondary">加载中…</Typography>}
            {detail && (
              <Stack spacing={3}>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <StatusChip status={detail.status} />
                  <Chip size="small" label={`${detail.members.length} 位自动发现成员`} />
                  <Chip size="small" label={`${detail.repos.length} 个自动上报仓库`} />
                </Stack>

                <Box>
                  <Typography variant="h4" sx={{ mb: 0.5 }}>
                    参与成员
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
                    由插件会话与网关请求自动记录，无需维护。
                  </Typography>
                  <Stack divider={<Divider />} spacing={1.25}>
                    {detail.members.length === 0 && <Typography variant="body2" color="text.secondary">暂无成员</Typography>}
                    {detail.members.map((member) => (
                      <Box key={member.user_id}>
                        <Typography variant="body2" fontWeight={600}>
                          {member.name ?? member.user_id}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {member.email ?? '-'} · 来源 {member.source}
                        </Typography>
                      </Box>
                    ))}
                  </Stack>
                </Box>

                <Box>
                  <Typography variant="h4" sx={{ mb: 0.5 }}>
                    仓库
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
                    插件自动上报规范化后的仓库展示名与 SHA-256 摘要。
                  </Typography>
                  <Stack divider={<Divider />} spacing={1.25}>
                    {detail.repos.length === 0 && <Typography variant="body2" color="text.secondary">暂无仓库上报</Typography>}
                    {detail.repos.map((repo) => (
                      <Box key={repo.id}>
                        <Typography variant="body2" fontWeight={600} sx={{ wordBreak: 'break-all' }}>
                          {repo.repo_display}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'ui-monospace, monospace' }}>
                          {repo.repo_hash.slice(0, 28)}…
                        </Typography>
                      </Box>
                    ))}
                  </Stack>
                </Box>

                <Box>
                  <Typography variant="h4" sx={{ mb: 1.5 }}>
                    配额
                  </Typography>
                  {detail.quotas.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      未配置项目配额。项目配额为软治理，可在「策略与配额」中按需设置。
                    </Typography>
                  ) : (
                    <Stack spacing={1.25}>
                      {detail.quotas.map((quota) => (
                        <Box key={quota.id} sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 2 }}>
                          <Typography variant="body2" fontWeight={600}>
                            {quota.period === 'day' ? '每日' : '每月'} · {quota.action}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            Token 上限 {formatNumber(quota.token_limit)} · 请求上限 {formatNumber(quota.request_limit)}
                          </Typography>
                        </Box>
                      ))}
                    </Stack>
                  )}
                </Box>
              </Stack>
            )}
          </Box>
        </Box>
      </Drawer>
    </>
  );
}