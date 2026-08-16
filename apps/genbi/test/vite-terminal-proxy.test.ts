import { describe, expect, it, vi } from 'vitest';
import config from '../vite.config.js';

describe('Vite terminal proxy', () => {
  it('forwards the native terminal WebSocket under the /api proxy', async () => {
    vi.stubEnv('VITE_BFF_URL', 'http://127.0.0.1:4788');
    const resolved = typeof config === 'function'
      ? await config({ command: 'serve', mode: 'test', isSsrBuild: false, isPreview: false })
      : config;
    expect(resolved.server?.proxy).toMatchObject({ '/api': { target: 'http://127.0.0.1:4788', ws: true } });
    vi.unstubAllEnvs();
  });
});
