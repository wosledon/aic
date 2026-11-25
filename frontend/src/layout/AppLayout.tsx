import { useState, type ReactNode } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  AppBar,
  Avatar,
  Box,
  Chip,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Toolbar,
  Tooltip,
  Typography,
  alpha,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import MenuRoundedIcon from '@mui/icons-material/MenuRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import DashboardRoundedIcon from '@mui/icons-material/DashboardRounded';
import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded';
import VerifiedUserRoundedIcon from '@mui/icons-material/VerifiedUserRounded';
import TimelineRoundedIcon from '@mui/icons-material/TimelineRounded';
import FolderRoundedIcon from '@mui/icons-material/FolderRounded';
import GroupRoundedIcon from '@mui/icons-material/GroupRounded';
import HubRoundedIcon from '@mui/icons-material/HubRounded';
import PolicyRoundedIcon from '@mui/icons-material/PolicyRounded';
import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded';
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded';
import AccountCircleRoundedIcon from '@mui/icons-material/AccountCircleRounded';
import LightModeRoundedIcon from '@mui/icons-material/LightModeRounded';
import DarkModeRoundedIcon from '@mui/icons-material/DarkModeRounded';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import { useAuth } from '../auth/AuthProvider';
import { useColorMode } from '../theme';

const drawerWidth = 268;

interface NavItem {
  label: string;
  path: string;
  icon: ReactNode;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const adminSections: NavSection[] = [
  { title: '总览', items: [{ label: '概览', path: '/', icon: <DashboardRoundedIcon /> }] },
  {
    title: '分析',
    items: [
      { label: '用量分析', path: '/usage', icon: <InsightsRoundedIcon /> },
      { label: '审批治理', path: '/approvals', icon: <VerifiedUserRoundedIcon /> },
      { label: '会话明细', path: '/sessions', icon: <TimelineRoundedIcon /> },
    ],
  },
  {
    title: '治理',
    items: [
      { label: '项目用量', path: '/projects', icon: <FolderRoundedIcon /> },
      { label: '用户与设备', path: '/users', icon: <GroupRoundedIcon /> },
      { label: '策略与配额', path: '/policies', icon: <PolicyRoundedIcon /> },
    ],
  },
  { title: '接入', items: [{ label: '供应商与模型', path: '/models', icon: <HubRoundedIcon /> }] },
  {
    title: '系统',
    items: [
      { label: '审计日志', path: '/audit', icon: <ReceiptLongRoundedIcon /> },
      { label: '系统设置', path: '/settings', icon: <SettingsRoundedIcon /> },
    ],
  },
];

const userSection: NavSection = {
  title: '我的',
  items: [{ label: '个人中心', path: '/me', icon: <AccountCircleRoundedIcon /> }],
};

function BrandMark() {
  return (
    <Stack direction="row" spacing={1.35} alignItems="center">
      <Box
        sx={{
          width: 42,
          height: 42,
          borderRadius: '13px',
          display: 'grid',
          placeItems: 'center',
          fontWeight: 850,
          fontSize: 15,
          letterSpacing: '-0.04em',
          color: '#fff',
          background: 'linear-gradient(135deg, #6d7dff 0%, #0ea5a4 100%)',
          boxShadow: '0 12px 26px rgba(91,108,255,0.38)',
        }}
      >
        AIC
      </Box>
      <Box>
        <Typography sx={{ color: '#fff', fontWeight: 780, fontSize: 16.5, lineHeight: 1.15, letterSpacing: '-0.02em' }}>
          AIControl
        </Typography>
        <Typography sx={{ color: 'rgba(226,232,255,0.48)', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.13em' }}>
          GATEWAY CONSOLE
        </Typography>
      </Box>
    </Stack>
  );
}

export function AppLayout() {
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('lg'));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const { user, isAdmin, logout } = useAuth();
  const { mode, toggle } = useColorMode();
  const location = useLocation();
  const navigate = useNavigate();

  const sections = isAdmin ? [...adminSections, userSection] : [userSection];
  const allItems = sections.flatMap((section) => section.items);
  const current = allItems.find((item) => (item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path)));

  const drawerContent = (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        color: '#fff',
        background: 'linear-gradient(180deg, #0a1120 0%, #0d1730 58%, #0a1222 100%)',
      }}
    >
      <Box sx={{ px: 2.5, pt: 2.75, pb: 2 }}>
        <BrandMark />
      </Box>
      <Box sx={{ flex: 1, overflowY: 'auto', px: 1.5, pb: 2 }}>
        {sections.map((section) => (
          <Box key={section.title} sx={{ mb: 2 }}>
            <Typography
              sx={{
                px: 1.75,
                pb: 0.7,
                fontSize: 10,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: 'rgba(226,232,255,0.34)',
                fontWeight: 800,
              }}
            >
              {section.title}
            </Typography>
            <List disablePadding>
              {section.items.map((item) => {
                const selected = item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path);
                return (
                  <ListItemButton
                    key={item.path}
                    selected={selected}
                    onClick={() => {
                      navigate(item.path);
                      setMobileOpen(false);
                    }}
                    sx={{
                      borderRadius: '11px',
                      mb: 0.35,
                      minHeight: 42,
                      color: selected ? '#fff' : 'rgba(226,232,255,0.62)',
                      border: selected ? '1px solid rgba(141,153,255,0.20)' : '1px solid transparent',
                      background: selected
                        ? 'linear-gradient(90deg, rgba(91,108,255,0.30) 0%, rgba(91,108,255,0.08) 100%)'
                        : 'transparent',
                      boxShadow: selected ? 'inset 3px 0 0 #8d99ff' : 'none',
                      '&.Mui-selected:hover': { background: 'linear-gradient(90deg, rgba(91,108,255,0.36) 0%, rgba(91,108,255,0.10) 100%)' },
                      '&:hover': { bgcolor: 'rgba(255,255,255,0.055)', color: '#fff' },
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 38, color: selected ? '#aab5ff' : 'inherit', '& svg': { fontSize: 20 } }}>
                      {item.icon}
                    </ListItemIcon>
                    <ListItemText primaryTypographyProps={{ fontSize: 13.5, fontWeight: selected ? 700 : 550 }}>
                      {item.label}
                    </ListItemText>
                  </ListItemButton>
                );
              })}
            </List>
          </Box>
        ))}
      </Box>

      <Box sx={{ px: 1.75, pb: 1.75 }}>
        <Stack
          direction="row"
          alignItems="center"
          spacing={1.25}
          sx={{
            p: 1.4,
            borderRadius: '14px',
            bgcolor: 'rgba(255,255,255,0.055)',
            border: '1px solid rgba(255,255,255,0.07)',
          }}
        >
          <Avatar src={user?.avatar_url ?? undefined} sx={{ width: 36, height: 36, bgcolor: '#5b6cff', fontSize: 14, fontWeight: 750 }}>
            {user?.name?.slice(0, 1) ?? 'A'}
          </Avatar>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography noWrap sx={{ color: '#fff', fontSize: 12.5, fontWeight: 650 }}>
              {user?.name ?? '未登录'}
            </Typography>
            <Typography noWrap sx={{ color: 'rgba(226,232,255,0.45)', fontSize: 10.5 }}>
              {isAdmin ? '管理员' : '用户'} · v1.0.0 Demo
            </Typography>
          </Box>
          <Tooltip title="退出登录">
            <IconButton
              size="small"
              sx={{ color: 'rgba(226,232,255,0.55)' }}
              onClick={async () => {
                await logout();
                navigate('/login');
              }}
              aria-label="退出登录"
            >
              <LogoutRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <Box component="nav" sx={{ width: { lg: drawerWidth }, flexShrink: { lg: 0 } }}>
        {isDesktop ? (
          <Drawer
            variant="permanent"
            open
            sx={{ '& .MuiDrawer-paper': { width: drawerWidth, border: 0, boxSizing: 'border-box' } }}
          >
            {drawerContent}
          </Drawer>
        ) : (
          <Drawer
            variant="temporary"
            open={mobileOpen}
            onClose={() => setMobileOpen(false)}
            ModalProps={{ keepMounted: true }}
            sx={{ '& .MuiDrawer-paper': { width: drawerWidth, border: 0 } }}
          >
            {drawerContent}
          </Drawer>
        )}
      </Box>

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <AppBar
          position="sticky"
          elevation={0}
          color="transparent"
          sx={{
            bgcolor: alpha(theme.palette.background.default, 0.78),
            backdropFilter: 'blur(16px)',
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          <Toolbar sx={{ minHeight: { xs: 64, sm: 70 }, gap: 1.25, px: { xs: 2, md: 3.5 } }}>
            {!isDesktop && (
              <IconButton edge="start" onClick={() => setMobileOpen(true)} aria-label="打开导航">
                <MenuRoundedIcon />
              </IconButton>
            )}
            <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                工作台
              </Typography>
              <ChevronRightRoundedIcon sx={{ fontSize: 15, color: 'text.disabled' }} />
              <Typography variant="body2" fontWeight={720} noWrap>
                {current?.label ?? 'AIControl'}
              </Typography>
            </Stack>

            <Chip
              size="small"
              label="Demo 环境"
              variant="outlined"
              sx={{
                display: { xs: 'none', sm: 'inline-flex' },
                color: 'success.main',
                borderColor: alpha(theme.palette.success.main, 0.4),
                bgcolor: alpha(theme.palette.success.main, 0.07),
              }}
            />
            <Tooltip title={mode === 'light' ? '切换深色模式' : '切换浅色模式'}>
              <IconButton onClick={toggle} aria-label="切换主题">
                {mode === 'light' ? <DarkModeRoundedIcon fontSize="small" /> : <LightModeRoundedIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
            <Box
              onClick={(event) => setAnchor(event.currentTarget)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                cursor: 'pointer',
                p: 0.5,
                pr: { xs: 0.5, sm: 1.25 },
                borderRadius: '999px',
                border: 1,
                borderColor: 'divider',
                bgcolor: 'background.paper',
                '&:hover': { borderColor: 'primary.main' },
              }}
            >
              <Avatar src={user?.avatar_url ?? undefined} sx={{ width: 30, height: 30, bgcolor: 'primary.main', fontSize: 13, fontWeight: 750 }}>
                {user?.name?.slice(0, 1) ?? 'A'}
              </Avatar>
              <Box sx={{ display: { xs: 'none', sm: 'block' }, minWidth: 0 }}>
                <Typography sx={{ fontSize: 12, fontWeight: 700, lineHeight: 1.2 }} noWrap>
                  {user?.name}
                </Typography>
                <Typography sx={{ fontSize: 10, color: 'text.secondary', lineHeight: 1.2 }} noWrap>
                  {isAdmin ? '管理员' : '用户'}
                </Typography>
              </Box>
            </Box>
            <Menu
              anchorEl={anchor}
              open={Boolean(anchor)}
              onClose={() => setAnchor(null)}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
              slotProps={{ paper: { sx: { mt: 1, minWidth: 230, p: 0.75, borderRadius: '14px' } } }}
            >
              <Box sx={{ px: 1.25, py: 1 }}>
                <Typography fontWeight={700}>{user?.name}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {user?.email ?? user?.id}
                </Typography>
              </Box>
              <Divider sx={{ my: 0.5 }} />
              <MenuItem
                onClick={() => {
                  setAnchor(null);
                  navigate('/me');
                }}
                sx={{ borderRadius: 2 }}
              >
                <ListItemIcon>
                  <AccountCircleRoundedIcon fontSize="small" />
                </ListItemIcon>
                个人中心
              </MenuItem>
              <MenuItem
                onClick={async () => {
                  setAnchor(null);
                  await logout();
                  navigate('/login');
                }}
                sx={{ borderRadius: 2 }}
              >
                <ListItemIcon>
                  <LogoutRoundedIcon fontSize="small" />
                </ListItemIcon>
                退出登录
              </MenuItem>
            </Menu>
          </Toolbar>
        </AppBar>

        <Box component="main" sx={{ px: { xs: 2, md: 3.5 }, py: { xs: 2.5, md: 3.5 }, maxWidth: 1560, mx: 'auto', width: '100%', overflowX: 'hidden' }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
}