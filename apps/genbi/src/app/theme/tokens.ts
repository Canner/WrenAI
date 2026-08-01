import { theme, type ThemeConfig } from 'antd';

/**
 * Wren AI Design System tokens.
 *
 * Source of truth: the team "Wren AI Design System" (Claude Design) reference
 * mockup — its exact light/dark CSS custom properties (`--ground`/`--surface`/
 * `--ink`/`--accent`/`--link`/…, `--shadow`, `--radius`) are mirrored here as
 * AntD alias-token overrides for BOTH modes, so the app matches the mockup's
 * look directly rather than approximating it via AntD's stock defaults +
 * `darkAlgorithm` alone. Brand is geekblue (`#2f54eb` light / `#597ef7` dark).
 *
 * Keep this the ONLY place raw hex values live — components read semantic
 * tokens (AntD `token.*` / `var(--ant-*)`, since `cssVar` is on) or the
 * `brand`/`surface2` objects below, never hard-coded colors. The one mockup
 * value with no clean 1:1 AntD alias (`--surface-2`) is exposed as the
 * `--genbi-surface-2` CSS var by `ThemeProvider`.
 */

export const palette = {
  blue6: '#1890ff', // info/link (light) — also SeverityTag's "compatibility" color
  green6: '#52c41a', // success / verified
  gold6: '#faad14', // warning / estimate
  red5: '#ff4d4f', // error / refusal
} as const;

/** Mockup's per-mode neutral + brand scale (`--ground` … `--link`). */
const modeColors = {
  light: {
    ground: '#f0f2f5',
    surface: '#ffffff',
    surface2: '#f5f5f5',
    line: '#f0f0f0',
    lineStrong: '#d9d9d9',
    ink: '#262626',
    ink2: '#434343',
    muted: '#65676c',
    accent: '#2f54eb',
    accentInk: '#1d39c4',
    link: '#1890ff',
  },
  dark: {
    ground: '#141414',
    surface: '#1f1f1f',
    surface2: '#262626',
    line: '#303030',
    lineStrong: '#434343',
    ink: '#f0f0f0',
    ink2: '#cfcfcf',
    muted: '#8c8c8c',
    accent: '#597ef7',
    accentInk: '#85a5ff',
    link: '#40a9ff',
  },
} as const;

/** Mockup's `--surface-2` per mode — the one value with no clean AntD alias. */
export const surface2 = {
  light: modeColors.light.surface2,
  dark: modeColors.dark.surface2,
} as const;

/** Mockup's `--shadow` per mode (drives `boxShadow*` incl. Card's `boxShadowCard`). */
const shadow = {
  light: '0px 3px 6px -4px rgba(0,0,0,.12),0px 6px 16px rgba(0,0,0,.08),0px 9px 28px 8px rgba(0,0,0,.05)',
  dark: '0 1px 2px rgba(0,0,0,.5),0 10px 30px rgba(0,0,0,.4)',
} as const;

/**
 * App-level semantic tokens that are NOT part of AntD's token set.
 * `verified` state colors drive the verified-first UI; each is paired with a
 * non-color channel (icon/label) at the component layer for a11y.
 */
export const brand = {
  verified: palette.green6,
  estimate: palette.gold6,
  refused: palette.red5,
  fontFamilyCode: `'Source Code Pro', ui-monospace, SFMono-Regular, Menlo, monospace`,
} as const;

const fontFamily = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`;

export type ThemeMode = 'light' | 'dark';

function modeToken(mode: ThemeMode): ThemeConfig['token'] {
  const c = modeColors[mode];
  return {
    colorPrimary: c.accent,
    colorPrimaryHover: c.accentInk,
    colorPrimaryActive: c.accentInk,
    colorInfo: c.link,
    colorLink: c.link,
    colorLinkHover: c.link,
    colorSuccess: palette.green6,
    colorWarning: palette.gold6,
    colorError: palette.red5,
    colorBgLayout: c.ground,
    colorBgContainer: c.surface,
    colorBgElevated: c.surface,
    colorBorder: c.lineStrong,
    colorBorderSecondary: c.line,
    colorText: c.ink,
    colorTextSecondary: c.ink2,
    colorTextTertiary: c.muted,
    borderRadius: 8,
    borderRadiusSM: 4,
    fontFamily,
    fontFamilyCode: brand.fontFamilyCode,
    fontSize: 15,
    boxShadow: shadow[mode],
    boxShadowSecondary: shadow[mode],
    boxShadowTertiary: shadow[mode],
  };
}

/**
 * Component-level overrides: flat surfaces, subtle `colorBorderSecondary`
 * borders, compact density — matching the mockup's Card/Table/Tag/Layout/
 * Segmented/Tree look. Card's shadow comes from the `boxShadowCard` token
 * above, not from here.
 */
function modeComponents(mode: ThemeMode): ThemeConfig['components'] {
  const c = modeColors[mode];
  return {
    Card: {
      bodyPaddingSM: 16,
      headerPaddingSM: 12,
      headerFontSizeSM: 14,
    },
    Table: {
      headerBg: c.surface2,
      headerColor: c.muted,
      headerSplitColor: c.line,
      borderColor: c.line,
      cellPaddingBlockSM: 8,
      cellPaddingInlineSM: 12,
      cellFontSizeSM: 12,
    },
    Tag: {
      defaultBg: c.surface2,
      defaultColor: c.ink2,
    },
    Layout: {
      headerBg: c.surface,
      bodyBg: c.ground,
      siderBg: c.surface,
    },
    Segmented: {
      trackBg: c.surface2,
      itemSelectedBg: c.surface,
      itemColor: c.muted,
      itemSelectedColor: c.ink,
    },
    Tree: {
      nodeSelectedBg: c.surface2,
      nodeHoverBg: c.surface2,
    },
  };
}

export const lightTheme: ThemeConfig = {
  algorithm: theme.defaultAlgorithm,
  token: modeToken('light'),
  components: modeComponents('light'),
  cssVar: {},
};

export const darkTheme: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: modeToken('dark'),
  components: modeComponents('dark'),
  cssVar: {},
};

export function themeConfig(mode: ThemeMode): ThemeConfig {
  return mode === 'dark' ? darkTheme : lightTheme;
}
