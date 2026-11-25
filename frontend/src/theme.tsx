import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createTheme, ThemeProvider, type PaletteMode } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';

const ColorModeContext = createContext<{ mode: PaletteMode; toggle: () => void }>({
  mode: 'light',
  toggle: () => undefined,
});

export function useColorMode() {
  return useContext(ColorModeContext);
}

export const nav = '#0a1120';

export function ColorModeProvider({ children }: { children: ReactNode }) {
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const [mode, setMode] = useState<PaletteMode>(() => {
    const saved = localStorage.getItem('aic-color-mode');
    if (saved === 'light' || saved === 'dark') return saved;
    return 'light';
  });

  useEffect(() => {
    if (!localStorage.getItem('aic-color-mode') && prefersDark) {
      setMode('dark');
    }
  }, [prefersDark]);

  const toggle = () => {
    setMode((current) => {
      const next = current === 'light' ? 'dark' : 'light';
      localStorage.setItem('aic-color-mode', next);
      return next;
    });
  };

  const theme = useMemo(() => {
    const light = mode === 'light';
    return createTheme({
      palette: {
        mode,
        primary: { main: '#5b6cff', light: '#8d99ff', dark: '#3f4fd8', contrastText: '#ffffff' },
        secondary: { main: '#0ea5a4', light: '#5eead4', dark: '#0f766e', contrastText: '#ffffff' },
        success: { main: '#10b981' },
        warning: { main: '#f59e0b' },
        error: { main: '#ef4444' },
        info: { main: '#38bdf8' },
        ...(light
          ? {
              background: { default: '#f4f6fb', paper: '#ffffff' },
              text: { primary: '#0f172a', secondary: '#667085' },
              divider: 'rgba(15, 23, 42, 0.08)',
            }
          : {
              background: { default: '#070b14', paper: '#0e1627' },
              text: { primary: '#f1f5ff', secondary: '#93a1bd' },
              divider: 'rgba(148, 163, 184, 0.14)',
            }),
      },
      shape: { borderRadius: 16 },
      typography: {
        fontFamily: [
          'Inter',
          'Plus Jakarta Sans',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          'sans-serif',
        ].join(','),
        h1: { fontSize: '1.85rem', fontWeight: 750, letterSpacing: '-0.035em', lineHeight: 1.2 },
        h2: { fontSize: '1.45rem', fontWeight: 720, letterSpacing: '-0.025em' },
        h3: { fontSize: '1.18rem', fontWeight: 700, letterSpacing: '-0.015em' },
        h4: { fontSize: '1rem', fontWeight: 680 },
        subtitle1: { fontWeight: 600 },
        body1: { fontSize: 14.5 },
        body2: { fontSize: 13.5, lineHeight: 1.6 },
        caption: { fontSize: 11.5, lineHeight: 1.5 },
        button: { textTransform: 'none', fontWeight: 650 },
        overline: { fontSize: 10.5, fontWeight: 750, letterSpacing: '0.14em' },
      },
      components: {
        MuiCssBaseline: {
          styleOverrides: {
            body: {
              backgroundImage: light
                ? 'radial-gradient(1100px 460px at 88% -8%, rgba(91,108,255,0.10), transparent 62%), radial-gradient(900px 420px at 4% 102%, rgba(14,165,164,0.08), transparent 60%)'
                : 'radial-gradient(1100px 480px at 88% -10%, rgba(91,108,255,0.16), transparent 62%), radial-gradient(900px 420px at 2% 104%, rgba(14,165,164,0.08), transparent 60%)',
              backgroundAttachment: 'fixed',
              minHeight: '100vh',
            },
            '*::-webkit-scrollbar': { width: 8, height: 8 },
            '*::-webkit-scrollbar-thumb': {
              background: light ? 'rgba(15,23,42,0.18)' : 'rgba(148,163,184,0.25)',
              borderRadius: 8,
            },
            '*::-webkit-scrollbar-track': { background: 'transparent' },
          },
        },
        MuiPaper: {
          defaultProps: { elevation: 0 },
          styleOverrides: { root: { backgroundImage: 'none' } },
        },
        MuiCard: {
          defaultProps: { elevation: 0 },
          styleOverrides: {
            root: {
              borderRadius: 18,
              border: light ? '1px solid rgba(15,23,42,0.07)' : '1px solid rgba(148,163,184,0.13)',
              boxShadow: light ? '0 16px 40px rgba(15,23,42,0.055)' : '0 20px 48px rgba(0,0,0,0.38)',
              transition: 'border-color .2s ease, transform .2s ease, box-shadow .2s ease',
            },
          },
        },
        MuiButton: {
          styleOverrides: {
            root: { borderRadius: 10, paddingInline: 16, minHeight: 36 },
            contained: { boxShadow: '0 8px 20px rgba(91,108,255,0.24)' },
            containedSecondary: { boxShadow: '0 8px 20px rgba(14,165,164,0.20)' },
            outlined: { borderColor: light ? 'rgba(15,23,42,0.14)' : 'rgba(148,163,184,0.24)' },
          },
        },
        MuiChip: {
          styleOverrides: {
            root: { borderRadius: 8, fontWeight: 650, height: 26 },
            label: { paddingInline: 10 },
          },
        },
        MuiTableContainer: {
          styleOverrides: { root: { borderRadius: 14 } },
        },
        MuiTableHead: {
          styleOverrides: {
            root: {
              '& .MuiTableCell-head': {
                backgroundColor: light ? '#f7f9fd' : '#111c31',
                color: light ? '#5c6a85' : '#93a1bd',
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: '0.07em',
                textTransform: 'uppercase',
                borderBottom: light ? '1px solid rgba(15,23,42,0.08)' : '1px solid rgba(148,163,184,0.16)',
              },
            },
          },
        },
        MuiTableCell: {
          styleOverrides: {
            root: {
              padding: '13px 16px',
              borderBottom: light ? '1px solid rgba(15,23,42,0.06)' : '1px solid rgba(148,163,184,0.10)',
            },
          },
        },
        MuiTableRow: {
          styleOverrides: {
            root: {
              '&.MuiTableRow-hover:hover': {
                backgroundColor: light ? 'rgba(91,108,255,0.045)' : 'rgba(91,108,255,0.08)',
              },
            },
          },
        },
        MuiOutlinedInput: {
          styleOverrides: {
            root: {
              borderRadius: 10,
              backgroundColor: light ? 'rgba(255,255,255,0.72)' : 'rgba(14,22,39,0.72)',
              '& fieldset': { borderColor: light ? 'rgba(15,23,42,0.12)' : 'rgba(148,163,184,0.22)' },
              '&:hover fieldset': { borderColor: light ? 'rgba(91,108,255,0.4)' : 'rgba(141,153,255,0.5)' },
            },
          },
        },
        MuiDialog: {
          styleOverrides: {
            paper: { borderRadius: 18, border: light ? '1px solid rgba(15,23,42,0.08)' : '1px solid rgba(148,163,184,0.16)' },
          },
        },
        MuiTooltip: {
          styleOverrides: { tooltip: { borderRadius: 8, fontSize: 12, padding: '7px 10px' } },
        },
        MuiLinearProgress: {
          styleOverrides: { root: { borderRadius: 999, backgroundColor: light ? 'rgba(15,23,42,0.07)' : 'rgba(148,163,184,0.16)' } },
        },
      },
    });
  }, [mode]);

  return (
    <ColorModeContext.Provider value={{ mode, toggle }}>
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    </ColorModeContext.Provider>
  );
}