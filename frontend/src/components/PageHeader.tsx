import type { ReactNode } from 'react';
import { Box, Stack, Typography } from '@mui/material';

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <Stack
      direction={{ xs: 'column', md: 'row' }}
      spacing={2}
      alignItems={{ xs: 'flex-start', md: 'flex-end' }}
      justifyContent="space-between"
      sx={{ mb: 3.25 }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.75 }}>
          <Box sx={{ width: 18, height: 3, borderRadius: 2, background: 'linear-gradient(90deg,#5b6cff,#0ea5a4)' }} />
          <Typography variant="overline" color="text.secondary">
            AIControl 控制台
          </Typography>
        </Stack>
        <Typography variant="h1" component="h1">
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75, maxWidth: 880 }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      {actions && (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ flexShrink: 0 }}>
          {actions}
        </Stack>
      )}
    </Stack>
  );
}

export function SectionCard({
  title,
  subtitle,
  action,
  children,
  sx,
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  sx?: object;
}) {
  return (
    <Box
      sx={{
        p: { xs: 2, sm: 2.75 },
        border: 1,
        borderColor: 'divider',
        borderRadius: '18px',
        bgcolor: 'background.paper',
        minWidth: 0,
        boxShadow: (theme) =>
          theme.palette.mode === 'light' ? '0 16px 40px rgba(15,23,42,0.055)' : '0 20px 48px rgba(0,0,0,0.38)',
        ...sx,
      }}
    >
      {(title || action) && (
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', sm: 'flex-start' }}
          spacing={1.5}
          sx={{ mb: 2.25 }}
        >
          <Box>
            {title && <Typography variant="h3">{title}</Typography>}
            {subtitle && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.4 }}>
                {subtitle}
              </Typography>
            )}
          </Box>
          {action}
        </Stack>
      )}
      {children}
    </Box>
  );
}