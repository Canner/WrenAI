// Chart interaction markers describe semantics, not a renderer or fixed layout.
export const chartDrillSelector = '[data-chart="breakdown"] [data-drill]';
export async function commitMonthInput(input) {
  // Native month controls have multiple focus stops. Leave the control through
  // actual keyboard navigation so its change/blur events finish before drilling.
  await input.focus();
  for (let i = 0; i < 5; i++) {
    await input.page().keyboard.press('Tab');
    if (!await input.evaluate(el => document.activeElement === el)) return;
  }
  throw Error('month_input_did_not_blur');
}
export function matchesChartNavigation(navigation, labels) {
  return navigation?.local_roll_up === true && navigation.controls.length === labels.length
    && labels.every(label => navigation.controls.filter(c => c.key === label && c.accessible && c.label && c.mark).length === 1);
}
export async function inspectChartNavigation(frame) {
  return frame.evaluate(() => {
    const chart = document.querySelector('[data-chart="breakdown"]');
    const section = chart?.closest('[data-chart-section="breakdown"]');
    const up = document.querySelector('[data-action="roll-up"]');
    const controls = [...(chart?.querySelectorAll('[data-drill]') ?? [])];
    return {
      local_roll_up: !!section && !!up && section.contains(up),
      controls: controls.map(el => ({ key: el.dataset.drill,
        accessible: (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') && el.tabIndex >= 0,
        label: !!el.querySelector('[data-chart-label]'), mark: !!el.querySelector('[data-drill-mark]') })),
    };
  });
}
export async function activateChartGroup(frame, value, mode = 'label') {
  const group = frame.locator(`${chartDrillSelector}[data-drill=${JSON.stringify(value)}]`);
  if (mode === 'Enter' || mode === 'Space') { await group.focus(); await group.press(mode); }
  else if (mode === 'tap') await group.locator('[data-drill-mark]').tap();
  else await group.locator(mode === 'mark' ? '[data-drill-mark]' : '[data-chart-label]').click();
  // Touch can defer its compatibility click. Wait for the observable transition,
  // not a fixed number of animation frames; a dead handler still times out.
  await frame.waitForFunction(() => document.querySelector('[data-action="roll-up"]')?.disabled === false,
    null, { timeout: 3000 });
}
