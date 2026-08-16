import { describe, expect, it } from 'vitest';
import { nativeTerminalThemes } from '../tokens';

const normalAnsiKeys = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const;
const brightAnsiKeys = normalAnsiKeys.map((name) => `bright${name[0].toUpperCase()}${name.slice(1)}`) as readonly string[];
const ansiForegroundKeys = ['foreground', ...normalAnsiKeys, ...brightAnsiKeys] as const;

function contrast(first: string, second: string): number {
  const luminance = (color: string) => {
    const channels = color.match(/[0-9a-f]{2}/gi)?.map((channel) => Number.parseInt(channel, 16) / 255);
    if (!channels || channels.length !== 3) throw new Error(`expected a resolved hex color, received ${color}`);
    const [red, green, blue] = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const [lighter, darker] = [luminance(first), luminance(second)].sort((left, right) => right - left);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('native terminal themes', () => {
  it('keeps every normal and camel-case bright ANSI foreground at WCAG AA contrast in both modes', () => {
    for (const mode of ['light', 'dark'] as const) {
      const theme = nativeTerminalThemes[mode];
      expect(Object.keys(theme)).toEqual(expect.arrayContaining([...ansiForegroundKeys]));
      expect(ansiForegroundKeys).toHaveLength(17);
      for (const name of ansiForegroundKeys) {
        const color = theme[name as keyof typeof theme];
        expect(color, `${mode} ${name} must be a resolved canvas color`).toMatch(/^#[0-9a-f]{6}$/i);
        expect(contrast(color, theme.background), `${name} on ${theme.background}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
