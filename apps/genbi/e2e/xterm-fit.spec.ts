import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    xtermFitRegression?: {
      terminal: { cols: number; rows: number; options: { fontSize: number; lineHeight: number; fontFamily: string } };
      refit: () => void;
      render: () => void;
      rendered: number;
    };
  }
}

interface TerminalViewport {
  lastRowBottom: number;
  lastRowText: string;
  mountBottom: number;
  mountPaddingBottom: number;
  statusBottom: number;
  columns: number;
  rows: number;
  wrapperPadding: number;
  wrapperOverflow: string;
  wrapperScrollHeight: number;
  wrapperClientHeight: number;
  scrollHeight: number;
  clientHeight: number;
  fontSize: number;
  lineHeight: number;
  fontFamily: string;
  glyphMetrics: {
    fontFamily: string;
    fontSize: number;
    cellHeight: number;
    cjkInkHeight: number;
    latinInkHeight: number;
    requiredCellHeight: number;
    leadingPerSide: number;
  };
}

async function viewport(page: import('@playwright/test').Page): Promise<TerminalViewport> {
  return page.evaluate(() => {
    const mount = document.querySelector<HTMLElement>('.sessions-terminal');
    const lastRow = mount?.querySelector<HTMLElement>('.xterm-rows > div:last-child');
    const statusRow = Array.from(mount?.querySelectorAll<HTMLElement>('.xterm-rows > div') ?? []).find((row) => row.textContent?.includes('Claude status: working'));
    const cjkRow = Array.from(mount?.querySelectorAll<HTMLElement>('.xterm-rows > div') ?? []).find((row) => row.textContent?.includes('中文測試'));
    const viewport = mount?.querySelector<HTMLElement>('.xterm-viewport');
    const terminal = window.xtermFitRegression?.terminal;
    const wrapper = document.querySelector<HTMLElement>('.sessions-terminal-wrap');
    if (!mount || !lastRow || !statusRow || !cjkRow || !viewport || !terminal || !wrapper) throw new Error('xterm regression fixture did not initialize');
    const mountStyle = getComputedStyle(mount);
    const rowRect = cjkRow.getBoundingClientRect();
    const rowStyle = getComputedStyle(cjkRow);
    const fontSize = Number.parseFloat(rowStyle.fontSize);
    const context = document.createElement('canvas').getContext('2d');
    if (!context || !Number.isFinite(fontSize)) throw new Error('xterm glyph metrics are unavailable');
    context.font = `${fontSize}px ${rowStyle.fontFamily}`;
    const height = (sample: string) => {
      const metrics = context.measureText(sample);
      const inkHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
      if (!(inkHeight > 0)) throw new Error('browser does not expose actual xterm glyph ink bounds');
      return inkHeight;
    };
    const cjkInkHeight = height('中文測試');
    const latinInkHeight = height('Ágypq');
    const requiredCellHeight = Math.max(cjkInkHeight, latinInkHeight) + 3;
    return {
      lastRowBottom: lastRow.getBoundingClientRect().bottom,
      lastRowText: lastRow.textContent ?? '',
      mountBottom: mount.getBoundingClientRect().bottom,
      mountPaddingBottom: Number.parseFloat(mountStyle.paddingBottom),
      statusBottom: statusRow.getBoundingClientRect().bottom,
      columns: terminal.cols,
      rows: terminal.rows,
      wrapperPadding: Number.parseFloat(getComputedStyle(wrapper).paddingBottom),
      wrapperOverflow: getComputedStyle(wrapper).overflow,
      wrapperScrollHeight: wrapper.scrollHeight,
      wrapperClientHeight: wrapper.clientHeight,
      scrollHeight: viewport.scrollHeight,
      clientHeight: viewport.clientHeight,
      fontSize: terminal.options.fontSize,
      lineHeight: terminal.options.lineHeight,
      fontFamily: terminal.options.fontFamily,
      glyphMetrics: {
        fontFamily: rowStyle.fontFamily,
        fontSize,
        cellHeight: rowRect.height,
        cjkInkHeight,
        latinInkHeight,
        requiredCellHeight,
        leadingPerSide: (rowRect.height - Math.max(cjkInkHeight, latinInkHeight)) / 2,
      },
    };
  });
}

test('FitAddon renders its last xterm row inside the padded Sessions viewport', async ({ page }) => {
  await page.goto('/e2e/xterm-fit.html');
  await page.waitForFunction(() => window.xtermFitRegression?.terminal.rows > 1
    && (window.xtermFitRegression?.rendered ?? 0) > 0
    && Array.from(document.querySelectorAll('.sessions-terminal .xterm-rows > div')).some((row) => row.textContent?.includes('中文測試')));

  const desktop = await viewport(page);
  expect(desktop.rows).toBeGreaterThan(1);
  expect(desktop.mountPaddingBottom).toBe(0);
  expect(desktop.lastRowText).toContain('Input:');
  expect(desktop.lastRowBottom).toBeLessThanOrEqual(desktop.mountBottom + 0.5);
  expect(desktop.statusBottom).toBeLessThanOrEqual(desktop.mountBottom + 0.5);
  expect(desktop.scrollHeight).toBe(desktop.clientHeight);
  expect(desktop.wrapperOverflow).toBe('hidden');
  expect(desktop.wrapperScrollHeight).toBe(desktop.wrapperClientHeight);
  expect(desktop.fontSize).toBe(14);
  expect(desktop.lineHeight).toBe(1.24);
  expect(desktop.fontFamily).toContain('Noto Sans Mono CJK TC');
  expect(desktop.glyphMetrics).toMatchObject({
    fontFamily: expect.stringContaining('Noto Sans Mono CJK TC'),
    fontSize: 14,
  });
  // These are real canvas ink bounds for CJK plus Latin ascenders/descenders,
  // measured with xterm's resolved font stack.  Require the xterm cell to
  // retain at least 1.5 CSS pixels above and below the tallest representative
  // glyph; the old 13px/default-line-height terminal fails the configured
  // typography contract and does not provide this deliberate leading.
  expect(desktop.glyphMetrics.cjkInkHeight).toBeGreaterThan(0);
  expect(desktop.glyphMetrics.latinInkHeight).toBeGreaterThan(0);
  expect(desktop.glyphMetrics.cellHeight).toBeGreaterThanOrEqual(desktop.glyphMetrics.requiredCellHeight);
  expect(desktop.glyphMetrics.leadingPerSide).toBeGreaterThanOrEqual(1.5);

  await page.locator('.sessions-workbench').evaluate((element) => element.classList.add('is-compact'));
  await expect(page.locator('.sessions-terminal-wrap')).toHaveCSS('padding-bottom', '8px');
  await page.locator('.sessions-terminal-wrap').evaluate((element) => { Object.assign((element as HTMLElement).style, { height: '320px', width: '640px' }); });
  await page.evaluate(() => { window.xtermFitRegression?.refit(); window.xtermFitRegression?.render(); });
  await page.waitForFunction(([previousColumns, previousRows]) => {
    const terminal = window.xtermFitRegression?.terminal;
    return terminal !== undefined
      && terminal.cols < previousColumns
      && terminal.rows < previousRows
      && (window.xtermFitRegression?.rendered ?? 0) > 1
      && Array.from(document.querySelectorAll('.sessions-terminal .xterm-rows > div')).some((row) => row.textContent?.includes('中文測試'));
  }, [desktop.columns, desktop.rows]);

  const compact = await viewport(page);
  expect(compact.wrapperPadding).toBe(8);
  expect(compact.columns).toBeLessThan(desktop.columns);
  expect(compact.rows).toBeLessThan(desktop.rows);
  expect(compact.lastRowText).toContain('Input:');
  expect(compact.lastRowBottom).toBeLessThanOrEqual(compact.mountBottom + 0.5);
  expect(compact.statusBottom).toBeLessThanOrEqual(compact.mountBottom + 0.5);
  expect(compact.scrollHeight).toBe(compact.clientHeight);
  expect(compact.wrapperOverflow).toBe('hidden');
  expect(compact.wrapperScrollHeight).toBe(compact.wrapperClientHeight);
  expect(compact.glyphMetrics.cjkInkHeight).toBeGreaterThan(0);
  expect(compact.glyphMetrics.latinInkHeight).toBeGreaterThan(0);
  expect(compact.glyphMetrics.cellHeight).toBeGreaterThanOrEqual(compact.glyphMetrics.requiredCellHeight);
  expect(compact.glyphMetrics.leadingPerSide).toBeGreaterThanOrEqual(1.5);
});
