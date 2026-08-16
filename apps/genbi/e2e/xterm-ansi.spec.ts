import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    xtermAnsiRegression?: {
      terminals: Record<string, {
        cols: number;
        rows: number;
        buffer: { active: { getLine(index: number): { getCell(index: number): { getChars(): string; getFgColor(): number } | undefined } | undefined } };
      }>;
      themes: Record<string, Record<string, string>>;
      rendered: () => number;
      sgr: string;
    };
  }
}

test('xterm renders resolved normal and bright ANSI palettes in both GenBI modes', async ({ page }) => {
  await page.goto('/e2e/xterm-ansi.html');
  await page.waitForFunction(() => window.xtermAnsiRegression?.rendered() === 2);

  await expect(page.getByLabel('Light native agent terminal')).toBeVisible();
  await expect(page.getByLabel('Dark native agent terminal')).toBeVisible();
  const contract = await page.evaluate(() => {
    const regression = window.xtermAnsiRegression;
    if (!regression) throw new Error('xterm ANSI regression fixture did not initialize');
    const colors = Object.fromEntries(Object.entries(regression.terminals).map(([mode, terminal]) => {
      const line = terminal.buffer.active.getLine(0);
      if (!line) throw new Error(`xterm ANSI ${mode} buffer is unavailable`);
      return [mode, Array.from({ length: 16 }, (_, index) => {
        const cell = line.getCell(index);
        if (!cell || cell.getChars() !== index.toString(16)) throw new Error(`xterm ANSI ${mode} SGR output was changed`);
        return cell.getFgColor();
      })];
    }));
    return {
      themes: regression.themes,
      colors,
      viewport: Object.fromEntries(Object.entries(regression.terminals).map(([mode, terminal]) => [mode, { columns: terminal.cols, rows: terminal.rows }])),
    };
  });

  for (const [mode, theme] of Object.entries(contract.themes)) {
    expect(theme.background).toMatch(/^#[0-9a-f]{6}$/i);
    expect(theme.foreground).toMatch(/^#[0-9a-f]{6}$/i);
    expect(theme.selectionBackground).toMatch(/^#[0-9a-f]{6}$/i);
    expect(Object.keys(theme)).toEqual(expect.arrayContaining([
      'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
      'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
    ]));
    expect(Object.values(theme).every((color) => !color.startsWith('var('))).toBe(true);
    expect(new Set(contract.colors[mode] as number[]).size).toBe(16);
    expect(contract.viewport[mode]).toMatchObject({ columns: expect.any(Number), rows: expect.any(Number) });
    expect(contract.viewport[mode].columns).toBeGreaterThan(1);
    expect(contract.viewport[mode].rows).toBeGreaterThan(1);
  }
});
