import { createTheme } from '@mui/material/styles';

const brand = {
  unBlue: '#0A1E33',
  appBarNavy: '#0A1E33',
  appBackground: '#F4F6F8',
  surface: '#FFFFFF',
  border: '#E3E8EE',
  textPrimary: '#101828',
  textSecondary: '#566579',
  monoFontFamily: '"IBM Plex Mono", "JetBrains Mono", "Consolas", monospace',
};

declare module '@mui/material/styles' {
  interface Theme {
    custom: typeof brand;
  }

  interface ThemeOptions {
    custom?: Partial<typeof brand>;
  }
}

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: brand.unBlue,
      dark: '#061525',
      contrastText: '#ffffff',
    },
    info: {
      main: brand.unBlue,
      dark: '#061525',
      contrastText: '#ffffff',
    },
    success: {
      main: '#2E7D32',
    },
    error: {
      main: '#C62828',
    },
    warning: {
      main: '#B26A00',
    },
    background: {
      default: brand.appBackground,
      paper: brand.surface,
    },
    text: {
      primary: brand.textPrimary,
      secondary: brand.textSecondary,
    },
    divider: brand.border,
  },
  custom: brand,
  shape: {
    borderRadius: 6,
  },
  typography: {
    fontFamily: '"IBM Plex Sans", "Inter", "Segoe UI", sans-serif',
    fontWeightRegular: 400,
    fontWeightMedium: 500,
    h1: {
      fontSize: '1.25rem',
      lineHeight: 1.25,
      fontWeight: 500,
      letterSpacing: '-0.015em',
    },
    h2: {
      fontSize: '1rem',
      lineHeight: 1.3,
      fontWeight: 500,
      letterSpacing: '-0.005em',
    },
    subtitle1: {
      fontSize: '0.9rem',
      lineHeight: 1.3,
      fontWeight: 500,
    },
    body1: {
      fontSize: '0.875rem',
      lineHeight: 1.5,
      fontWeight: 400,
    },
    body2: {
      fontSize: '0.78rem',
      lineHeight: 1.45,
      fontWeight: 400,
    },
    caption: {
      fontSize: '0.72rem',
      lineHeight: 1.35,
      fontWeight: 400,
    },
    overline: {
      fontSize: '0.68rem',
      lineHeight: 1.4,
      fontWeight: 500,
      letterSpacing: '0.04em',
      textTransform: 'none',
    },
    button: {
      fontSize: '0.8rem',
      fontWeight: 500,
      letterSpacing: 0,
      textTransform: 'none',
    },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        ':root': {
          colorScheme: 'light',
        },
        body: {
          minWidth: 320,
          backgroundColor: brand.appBackground,
        },
        '*:focus-visible': {
          outline: `2px solid ${brand.unBlue}`,
          outlineOffset: 2,
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: brand.appBarNavy,
          backgroundImage: 'none',
          boxShadow: 'none',
          borderBottom: `1px solid rgba(255, 255, 255, 0.12)`,
        },
      },
    },
    MuiAlert: {
      defaultProps: {
        variant: 'standard',
      },
      styleOverrides: {
        root: {
          borderRadius: 6,
          fontSize: '0.78rem',
        },
        icon: {
          paddingTop: 5,
          paddingBottom: 5,
        },
        message: {
          paddingTop: 5,
          paddingBottom: 5,
        },
      },
    },
    MuiButton: {
      defaultProps: {
        size: 'small',
      },
      styleOverrides: {
        root: {
          borderRadius: 6,
          boxShadow: 'none',
        },
      },
    },
    MuiChip: {
      defaultProps: {
        size: 'small',
      },
      styleOverrides: {
        root: {
          borderRadius: 5,
          fontWeight: 500,
          fontSize: '0.72rem',
        },
      },
    },
    MuiIconButton: {
      defaultProps: {
        size: 'small',
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
        outlined: {
          borderColor: brand.border,
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderColor: brand.border,
          fontSize: '0.78rem',
        },
        head: {
          color: brand.textSecondary,
          fontWeight: 500,
          backgroundColor: '#FAFBFC',
        },
        sizeSmall: {
          paddingTop: 6,
          paddingBottom: 6,
        },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          '&:last-child td': {
            borderBottom: 0,
          },
        },
      },
    },
  },
});
