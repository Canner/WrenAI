import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bffBaseUrl, isBffEnabled } from '../env';

// `bffBaseUrl`/`isBffEnabled` read `import.meta.env.VITE_BFF_URL` and
// `import.meta.env.DEV` directly (see env.ts's own doc comment on why: the
// dev-vs-prod branch has to be a build-time constant Vite can tree-shake).
// `vi.stubEnv` covers `VITE_BFF_URL`; `DEV`/`PROD` are stubbed by writing
// directly to `import.meta.env` (vitest runs real module code, not a
// statically-replaced constant, so this is a real, restorable mutation).
const importMetaEnv = import.meta.env as unknown as Record<string, unknown>;
let originalDev: unknown;
let originalProd: unknown;

beforeEach(() => {
  originalDev = importMetaEnv.DEV;
  originalProd = importMetaEnv.PROD;
});

afterEach(() => {
  vi.unstubAllEnvs();
  importMetaEnv.DEV = originalDev;
  importMetaEnv.PROD = originalProd;
});

function setProdMode(): void {
  importMetaEnv.DEV = false;
  importMetaEnv.PROD = true;
}

describe('isBffEnabled', () => {
  it('is false with no VITE_BFF_URL set', () => {
    vi.stubEnv('VITE_BFF_URL', '');
    expect(isBffEnabled()).toBe(false);
  });

  it('is true once VITE_BFF_URL is set', () => {
    vi.stubEnv('VITE_BFF_URL', 'same-origin');
    expect(isBffEnabled()).toBe(true);
  });
});

describe('bffBaseUrl', () => {
  it('is empty when the BFF is disabled entirely', () => {
    vi.stubEnv('VITE_BFF_URL', '');
    setProdMode();
    expect(bffBaseUrl()).toBe('');
  });

  it('is a relative (empty) base in dev, regardless of VITE_BFF_URL', () => {
    vi.stubEnv('VITE_BFF_URL', 'http://localhost:4787');
    // DEV is left at its real vitest-run value (truthy), matching how the
    // app actually runs under `vite dev`.
    expect(bffBaseUrl()).toBe('');
  });

  it('is the absolute VITE_BFF_URL (trimmed of trailing slashes) in a prod build talking to a separately-hosted BFF', () => {
    vi.stubEnv('VITE_BFF_URL', 'https://bff.example.com/');
    setProdMode();
    expect(bffBaseUrl()).toBe('https://bff.example.com');
  });

  it('AC5: "same-origin" resolves to a relative (empty) base in a prod build, for a BFF serving its own built SPA', () => {
    vi.stubEnv('VITE_BFF_URL', 'same-origin');
    setProdMode();
    expect(bffBaseUrl()).toBe('');
  });
});
