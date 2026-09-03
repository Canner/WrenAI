#!/usr/bin/env node
/**
 * Published-package entry point for `@wrenai/genbi`.
 *
 * This is a thin trampoline: it locates the compiled BFF entry point
 * (`dist-server/server/bin.js`) relative to its own installed location and
 * hands off to it. All real startup logic — port binding, static-SPA
 * wiring — lives in `server/bin.ts`; this wrapper only exists to (a)
 * resolve the port a user should open before the BFF's own "listening"
 * message arrives, and (b) fail with a short message instead of a raw
 * "Cannot find module" stack trace if the installed package is missing its
 * build output.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(packageRoot, 'dist-server', 'server', 'bin.js');

if (!existsSync(entry)) {
  process.stderr.write(
    `genbi: cannot find the built server at ${entry}.\n` +
      'This install looks incomplete or corrupted — reinstall @wrenai/genbi and try again.\n',
  );
  process.exitCode = 1;
} else {
  const port = process.env.PORT ?? '4787';
  process.stdout.write(`Starting Wren GenBI — once ready, open http://127.0.0.1:${port}\n`);
  await import(entry);
}
