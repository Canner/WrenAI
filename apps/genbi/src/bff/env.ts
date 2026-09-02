/**
 * Env gate + base URL for the live BFF wiring. This is the single feature
 * flag every store checks before calling the BFF over HTTP/SSE — with no
 * `VITE_BFF_URL` set, `isBffEnabled()` is `false` everywhere and the app
 * behaves exactly as Phase 1a (fixtures only, no network calls attempted).
 */
export function isBffEnabled(): boolean {
  return Boolean(import.meta.env.VITE_BFF_URL);
}

/** `VITE_BFF_URL` sentinel selecting same-origin mode — see `bffBaseUrl` below. */
const SAME_ORIGIN = 'same-origin';

/**
 * Base URL to fetch the BFF against.
 *
 * In dev, requests go out as a same-origin relative path (empty base) so the
 * Vite dev-server proxy (`server.proxy` in `vite.config.ts`) can forward them
 * to `VITE_BFF_URL` without the browser ever making a cross-origin request —
 * no CORS involved. A production build has no such proxy, so it talks to
 * `VITE_BFF_URL` directly; a deployed BFF must then allow CORS, or share an
 * origin with the UI. Setting `VITE_BFF_URL=same-origin` selects that second
 * option explicitly: the build resolves to a relative path (empty base),
 * same as dev, for a BFF that serves the built SPA itself (see
 * `server/spa.ts`) so the browser only ever talks to one origin — no CORS
 * needed either way. See the README's "Connecting to the BFF" section.
 */
export function bffBaseUrl(): string {
  if (!isBffEnabled()) return '';
  if (import.meta.env.DEV) return '';
  const raw = (import.meta.env.VITE_BFF_URL as string).trim();
  if (raw === SAME_ORIGIN) return '';
  return raw.replace(/\/+$/, '');
}
