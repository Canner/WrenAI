/**
 * Serves the built SPA (`vite build`'s `dist/`) from the same Hono app as
 * the BFF's own `/api/*` routes, so a published build can run as one
 * process on one port instead of a separate static host in front of the
 * BFF. Mounting is opt-in: `server/app.ts`'s `createApp` only calls
 * `mountSpaFallback` when `TurnDeps.staticDir` is wired, and `server/bin.ts`
 * (the only place that wires real production values) only wires it when
 * `<staticDir>/index.html` actually exists — a dev boot with no `dist/`
 * never touches this module, so the vite-proxied dev flow is unaffected.
 *
 * MUST be mounted last, after every `/api/*` route `createApp` registers.
 * Hono resolves an overlapping match by registration order — whichever
 * matching, non-`next()`-calling handler was registered first wins — so a
 * catch-all mounted any earlier would shadow real routes (worst case: an
 * SSE route that still "connects" but silently never streams an event).
 * Both middlewares below additionally check the path themselves rather
 * than relying on mount order alone, so an `/api/*` request that somehow
 * reaches this module (no earlier route matched it) still 404s instead of
 * getting HTML.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";

function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

export function mountSpaFallback(app: Hono, staticDir: string): void {
  // Real files (including `/` -> `index.html`, handled internally by
  // `serveStatic`) are served as-is. `/api/*` is excluded up front so a
  // request under it is never resolved against `staticDir` at all.
  app.use("*", async (c, next) => {
    if (isApiPath(c.req.path)) return next();
    return serveStatic({ root: staticDir })(c, next);
  });

  // Anything serveStatic didn't find. Three cases:
  //  - `/api/*` with no matching route: a real 404, never HTML.
  //  - `/assets/...` (Vite's own hashed-bundle convention) with no matching
  //    file: a real 404 — a missing/renamed build asset must not silently
  //    resolve to `index.html`.
  //  - anything else: a client-side route; serve `index.html` so the SPA's
  //    own router can take over.
  app.get("*", (c) => {
    if (isApiPath(c.req.path) || c.req.path.startsWith("/assets/")) return c.notFound();
    const indexPath = path.join(staticDir, "index.html");
    if (!existsSync(indexPath)) return c.notFound();
    return c.html(readFileSync(indexPath, "utf8"));
  });
}
