// Supplemental observations only. This does not change the host delivery policy.
// Pixel sizes include SVG viewBox scaling. Complex CSS transforms and canvas
// text are outside this bounded semantic-label measurement; inspect screenshots.
export async function inspectLabels(frame, payload) {
  return frame.evaluate(data => {
    const selectors = data.datasets.flatMap(d => d.rows.map((_, i) => `[data-value="${d.id}:${i}"]`))
      .concat(data.datasets[1].rows.map((_, i) => `[data-week="${i}"]`));
    const visible = el => {
      if (!el) return false;
      const r = el.getBoundingClientRect(); if (!(r.width > 0 && r.height > 0)) return false;
      for (let p = el; p; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
      }
      return true;
    };
    const rect = r => ({ x: r.x, y: r.y, width: r.width, height: r.height });
    const labels = selectors.map(selector => {
      const matches = [...document.querySelectorAll(selector)], el = matches[0];
      const shown = matches.length === 1 && visible(el);
      let px = el ? parseFloat(getComputedStyle(el).fontSize) : null;
      if (el instanceof SVGElement) {
        const matrix = el.getScreenCTM(); px = matrix ? px * Math.hypot(matrix.a, matrix.b) : null;
      }
      const range = document.createRange(); if (el) range.selectNodeContents(el);
      const boxes = el ? [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0).map(rect) : [];
      const inside = boxes.length > 0 && boxes.every(r => r.x >= -1 && r.x + r.width <= innerWidth + 1);
      return { selector, text: el?.textContent.trim() ?? null, matches: matches.length, visible: shown,
        screen_font_px: px, horizontal_fit: inside, boxes,
        target_met: shown && Number.isFinite(px) && px >= 13.99 && inside };
    });
    return { version: 'dashboard-label-readability/1', target_px: 14,
      viewport_width: innerWidth, labels, label_count: labels.length,
      min_label_px: labels.every(x => Number.isFinite(x.screen_font_px)) ? Math.min(...labels.map(x => x.screen_font_px)) : null,
      all_visible: labels.every(x => x.visible), target_met: labels.every(x => x.target_met) };
  }, payload);
}
