/**
 * Keep this independent of the Ant Design code-font token: xterm paints to a
 * canvas, so it needs a concrete cross-platform fallback chain for CJK glyphs.
 * Explicit CJK mono faces (Noto, Source Han, and Sarasa, all common macOS
 * installs) precede the macOS-only proportional PingFang fallback; keep that
 * last-resort face so systems without one still render text rather than a
 * missing glyph. Windows CJK fallbacks remain in the stack too.
 */
export const nativeTerminalTypography = {
  fontSize: 14,
  lineHeight: 1.24,
  fontFamily: "'Noto Sans Mono CJK TC', 'Noto Sans Mono CJK SC', 'Source Han Mono TC', 'Source Han Mono SC', 'Sarasa Mono TC', 'Sarasa Mono SC', 'SFMono-Regular', Menlo, Monaco, Consolas, 'Liberation Mono', 'Microsoft JhengHei', 'Microsoft YaHei', 'PingFang TC', 'PingFang SC', monospace",
} as const;
