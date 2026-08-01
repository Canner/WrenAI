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
