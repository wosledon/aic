import type { ReactNode } from 'react';
import { alpha, Box, Card, CardContent, Stack, Typography, useTheme } from '@mui/material';

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'primary',
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: ReactNode;
  tone?: 'primary' | 'secondary' | 'warning' | 'error' | 'success';
}) {
  const theme = useTheme();
  const color = theme.palette[tone].main;
  return (
    <Card
      sx={{
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        '&::after': {
          content: '""',
          position: 'absolute',
          insetInline: 0,
          bottom: 0,
          height: 3,
          background: `linear-gradient(90deg, ${color}, ${alpha(color, 0)})`,
          opacity: 0.75,
        },
      }}
    >
      <CardContent sx={{ p: 2.25, '&:last-child': { pb: 2.25 } }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1.25}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 750, letterSpacing: '0.04em' }}>
              {label}
            </Typography>
            <Typography
              sx={{
                mt: 0.7,
                fontSize: { xs: '1.5rem', sm: '1.65rem' },
                fontWeight: 760,
                lineHeight: 1.15,
                letterSpacing: '-0.03em',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {value}
            </Typography>
            {hint && (
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.6, lineHeight: 1.4 }}>
                {hint}
              </Typography>
            )}
          </Box>
          {icon && (
            <Box
              sx={{
                width: 42,
                height: 42,
                borderRadius: '13px',
                display: 'grid',
                placeItems: 'center',
                color,
                bgcolor: alpha(color, 0.12),
                flexShrink: 0,
                '& svg': { fontSize: 21 },
              }}
            >
              {icon}
            </Box>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}