import '@testing-library/jest-dom/vitest';

// jsdom implements neither ResizeObserver (used by the chart wrapper) nor
// matchMedia (used by AntD's responsive + theme code).
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom's canvas element has no 2D context, so ECharts renders into null and
// throws asynchronously — after the test that triggered it has already passed.
// Vitest counts those as unhandled errors and exits non-zero on an otherwise
// green run, which is how this first reached CI: every assertion passing, the
// job still red. A stub context is enough; nothing here asserts on pixels.
// jsdom *defines* getContext and returns null from it, so testing for the
// method's absence would never install this.
if (document.createElement('canvas').getContext('2d') === null) {
  HTMLCanvasElement.prototype.getContext = (() => {
    const noop = () => {};
    return {
      canvas: undefined,
      clearRect: noop, fillRect: noop, strokeRect: noop,
      save: noop, restore: noop, scale: noop, translate: noop, rotate: noop, setTransform: noop,
      beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arc: noop, bezierCurveTo: noop,
      fill: noop, stroke: noop, clip: noop,
      createLinearGradient: () => ({ addColorStop: noop }),
      createRadialGradient: () => ({ addColorStop: noop }),
      createPattern: () => null,
      measureText: () => ({ width: 0 }),
      fillText: noop, strokeText: noop,
      drawImage: noop,
      getImageData: () => ({ data: new Uint8ClampedArray(4) }),
      putImageData: noop,
      createImageData: () => ({ data: new Uint8ClampedArray(4) }),
      setLineDash: noop, getLineDash: () => [],
    };
  }) as unknown as HTMLCanvasElement["getContext"];
}

// jsdom does not implement matchMedia; AntD's responsive + theme code reads it.
if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

// jsdom's `getComputedStyle` is expensive (it re-parses stylesheets per call),
// and `@testing-library/dom`'s `getByRole(role, { name })` calls it many times
// per candidate element via `dom-accessibility-api`'s `computeAccessibleName`
// — on a page with AntD's generated stylesheet and a dozen button candidates,
// that's enough repeated recomputation of the *same* element's style to push
// a single `getByRole` call into multiple seconds under CPU-contended (full
// parallel suite) runs. This is a well-documented jsdom/testing-library
// interaction (jsdom/jsdom#3234, #3984; testing-library/dom-testing-library#390).
//
// Memoize `getComputedStyle` per (element, pseudo-element) pair, clearing the
// cache on the next microtask. That's long enough to dedupe the redundant
// same-tick lookups a single `getByRole`/`computeAccessibleName` pass makes,
// but short enough to never observe a stale value across an `await` — so
// styles React actually changes (and jest-dom's `toHaveStyle` assertions)
// still see fresh, correct results.
{
  const realGetComputedStyle = window.getComputedStyle.bind(window);
  let cache: WeakMap<Element, Map<string, CSSStyleDeclaration>> | null = null;

  window.getComputedStyle = (elt: Element, pseudoElt?: string | null) => {
    if (!cache) {
      const fresh = new WeakMap<Element, Map<string, CSSStyleDeclaration>>();
      cache = fresh;
      queueMicrotask(() => {
        if (cache === fresh) cache = null;
      });
    }
    const key = pseudoElt ?? '';
    let byPseudo = cache.get(elt);
    if (!byPseudo) {
      byPseudo = new Map();
      cache.set(elt, byPseudo);
    }
    let style = byPseudo.get(key);
    if (!style) {
      style = realGetComputedStyle(elt, pseudoElt ?? undefined);
      byPseudo.set(key, style);
    }
    return style;
  };
}
