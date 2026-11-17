// Bounded rendered-presence observation, not certification of chart semantics.
export const chartContract = 'revenue-chart-presence/2';
export async function inspectChart(frame, payload, { marker = 'revenue_weekly', contract = chartContract, recover = true } = {}) {
  return frame.evaluate(({ rows, contract, marker, recover }) => {
    const visible = el => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0 || r.right <= 0 || r.left >= innerWidth) return false;
      for (let p = el; p; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (s.display === 'none' || s.visibility !== 'visible' || Number(s.opacity) === 0) return false;
      }
      return true;
    };
    const color = value => value !== 'none' && value !== 'transparent' && !/[,/]\s*0(?:\.0+)?\s*\)$/.test(value);
    const including = (el, selector) => [...(el.matches(selector) ? [el] : []), ...el.querySelectorAll(selector)];
    const renderer = root => {
      if (!visible(root)) return null;
      for (const svg of including(root, 'svg')) {
        if (!visible(svg)) continue;
        const marks = [...svg.querySelectorAll('rect,path,circle,ellipse,polygon,polyline,line')].filter(el => {
          if (el.closest('defs,clipPath,mask,symbol') || !visible(el)) return false;
          const s = getComputedStyle(el);
          return (color(s.fill) && Number(s.fillOpacity) > 0 && !el.matches('line,polyline'))
            || (color(s.stroke) && Number(s.strokeOpacity) > 0 && parseFloat(s.strokeWidth) > 0);
        });
        if (marks.length) return 'svg';
      }
      for (const canvas of including(root, 'canvas')) {
        if (!visible(canvas) || !canvas.width || !canvas.height) continue;
        // Sample into a small host-created canvas, bounding memory independently
        // of the generated canvas size. Blank / solid backgrounds are not charts.
        const sample = document.createElement('canvas'); sample.width = sample.height = 64;
        const ctx = sample.getContext('2d');
        try {
          ctx.drawImage(canvas, 0, 0, 64, 64);
          const pixels = ctx.getImageData(0, 0, 64, 64).data;
          const colors = new Set(); let ink = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            colors.add(`${pixels[i]},${pixels[i+1]},${pixels[i+2]},${pixels[i+3]}`);
            if (pixels[i+3]) ink++;
          }
          if (ink > 2 && colors.size > 1) return 'canvas';
        } catch { /* Unreadable canvas is not positive evidence. */ }
      }
      // CSS bars are supported without prescribing class names or orientation.
      // Require a painted, text-free leaf per row; text panels alone do not count.
      const marks = [...root.querySelectorAll('*')].filter(el => {
        if (!(el instanceof HTMLElement) || el.children.length || el.textContent.trim() || !visible(el)) return false;
        const r = el.getBoundingClientRect(), s = getComputedStyle(el);
        return r.width >= 2 && r.height >= 2 && color(s.backgroundColor);
      });
      if (marks.length >= rows.length && rows.length > 0) return 'css';
      return null;
    };
    const marked = [...document.querySelectorAll('[data-chart]')].filter(el => el.getAttribute('data-chart') === marker);
    if (marked.length === 1) {
      const kind = renderer(marked[0]);
      if (kind) return { contract, present: true, renderer: kind, marker: 'matched' };
    }
    // Recover only an unambiguous accessible weekly-revenue chart containing
    // the row labels. Never treat an arbitrary decorative SVG or colored card
    // elsewhere on the page as the required chart.
    const recovered = [...document.querySelectorAll('[role="img"][aria-label]')].filter(el => recover &&
      /weekly.*revenue|revenue.*week/i.test(el.getAttribute('aria-label'))
      && rows.every((_, i) => el.querySelector(`[data-week="${i}"]`) && el.querySelector(`[data-value="revenue_weekly:${i}"]`)))
      .map(el => ({ el, kind: renderer(el) })).filter(x => x.kind);
    if (recovered.length === 1) return { contract, present: true, renderer: recovered[0].kind, marker: 'fallback' };
    return { contract, present: false, renderer: null, marker: 'missing' };
  }, { rows: payload.datasets[1].rows, contract, marker, recover });
}
