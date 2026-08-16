/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import { configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { projectPublicLaunchAttestation } from './launch-attestation-public.js';

/** Reads a full local file but returns only its strict, endpoint-safe projection. */
export function readLocalLaunchAttestationPublic(file: string) {
  return projectPublicLaunchAttestation(JSON.parse(readFileSync(file, 'utf8')));
}

/**
 * The dev proxy's target, from either a real environment variable or an
 * `.env*` file in this package — in that order, matching how Vite resolves
 * `import.meta.env` for the client bundle.
 *
 * `process.env` alone is not enough: Vite does not copy `.env.local` into the
 * config process, so reading only `process.env` here meant the client believed
 * the BFF was live (its `import.meta.env.VITE_BFF_URL` *is* populated from the
 * file) while the proxy it depends on was never installed — the documented
 * `.env.local` flow silently half-worked.
 */
function bffTarget(mode: string): string | undefined {
  const fromFile = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_');
  const target = process.env.VITE_BFF_URL ?? fromFile.VITE_BFF_URL;
  return target !== undefined && target.trim().length > 0 ? target : undefined;
}

/** A local-only endpoint that proves which gated Vite process owns this port. */
function localLaunchAttestationPlugin() {
  return {
    name: 'genbi-local-launch-attestation',
    configureServer(server: { middlewares: { use: (path: string, handler: (request: unknown, response: { statusCode: number; setHeader: (name: string, value: string) => void; end: (value: string) => void }) => void) => void } }) {
      server.middlewares.use('/_genbi/local-launch-attestation', (_request, response) => {
        const file = process.env.WREN_GENBI_LAUNCH_ATTESTATION;
        if (!file || !existsSync(file)) { response.statusCode = 503; response.end('{"error":"local launch attestation is not configured"}'); return; }
        try {
          response.setHeader('content-type', 'application/json');
          response.end(JSON.stringify(readLocalLaunchAttestationPublic(file)));
        } catch { response.statusCode = 503; response.end('{"error":"local launch attestation is unavailable"}'); }
      });
    },
  };
}

// genbi_app is a decoupled SPA: pure client render, no SSR.
// It talks to the harness/BFF only over HTTP/SSE, and builds to static assets
// so a future desktop shell (Tauri preferred) or PWA stays a thin increment.
export default defineConfig(({ mode }) => {
  const target = bffTarget(mode);
  return {
  plugins: [react(), localLaunchAttestationPlugin()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5273,
    // The repo keeps per-session git worktrees under `.git-worktrees/` inside
    // the tree. Vite's file watcher would otherwise pick up churn in those
    // sibling checkouts (wasm examples, doc templates, other apps) and fire a
    // full `page reload` — which wipes in-memory SPA state mid-flow (e.g. the
    // setup wizard snapping back to step 1). Never watch them.
    watch: {
      ignored: ['**/.git-worktrees/**'],
    },
    // Dev-only convenience: forwards same-origin `/api` calls to the live
    // BFF (`VITE_BFF_URL`) so the dev server never hits a browser CORS
    // error. A production build has no such proxy and calls `VITE_BFF_URL`
    // directly — see the README's "Connecting to the BFF" section.
    ...(target
      ? { proxy: {
          '/api': {
            target,
            changeOrigin: true,
            ws: true,
          },
        } }
      : {}),
  },
  build: {
    // Static, client-rendered output — no server runtime required.
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    // Nested per-session worktrees under `.git-worktrees/` carry their own
    // (possibly WIP, possibly failing) copy of this suite. Without this,
    // vitest collects those sibling checkouts' tests too and reports another
    // branch's failures as if they were ours. Keep the runner to this tree.
    exclude: [...configDefaults.exclude, '**/.git-worktrees/**'],
    // Two independent suites share this one Vite config: the React SPA
    // (jsdom, `src/**`) and the BFF/harness backend (node, `test/**`) that
    // used to live in a separate repo with its own bare `vitest.config.ts`
    // (`{ test: { include: ["test/**/*.test.ts"] } }`, no environment/setup
    // overrides — it ran under vitest's node default). `test.projects` keeps
    // that split without a second config file.
    projects: [
      {
        extends: true,
        test: {
          name: 'frontend',
          environment: 'jsdom',
          globals: true,
          setupFiles: ['./src/setupTests.ts'],
          css: false,
          include: ['src/**/*.{test,spec}.{ts,tsx}'],
        },
      },
      {
        extends: true,
        test: {
          name: 'backend',
          environment: 'node',
          include: ['test/**/*.test.ts'],
        },
      },
    ],
  },
  };
});
