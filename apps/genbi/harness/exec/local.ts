import { execFile } from "node:child_process";
import { mkdir, readFile as readFileAsync, writeFile as writeFileAsync } from "node:fs/promises";
import path from "node:path";
import { EgressNotAllowedError, PathTraversalError, ReadOnlyViolationError, WriteScopeNotGrantedError } from "./errors.js";
import type { ExecCommand, ExecResult, ExecutionEnv, FetchRequest, FetchResponse } from "./types.js";

const DEFAULT_MAX_BUFFER_BYTES = 32 * 1024 * 1024;

/** The minimal shape `local.ts` needs from a fetch response — matches the global `Response`. */
export interface RawFetchResponse {
  readonly status: number;
  text(): Promise<string>;
}

export type FetchImpl = (
  url: string,
  init: { readonly method: string; readonly headers?: Readonly<Record<string, string>>; readonly body?: string },
) => Promise<RawFetchResponse>;

export interface LocalExecutionEnvOptions {
  /** Base directory `artifactWriteScope` (and any relative path) resolves against. Defaults to `process.cwd()`. */
  readonly rootDir?: string;
  /** Overridable for hermetic tests; defaults to the global `fetch`. */
  readonly fetchImpl?: FetchImpl;
  /** Overridable for hermetic tests; defaults to spawning `cmd.command` with `cmd.args` (no shell). */
  readonly execImpl?: (cmd: ExecCommand) => Promise<ExecResult>;
  /** Overridable for hermetic tests; defaults to 32 MiB (matches compile/pipeline.ts + route/dispatched.ts). */
  readonly maxBufferBytes?: number;
}

/**
 * The v1 `local` `ExecutionEnv` backend: in-process file I/O confined
 * to a scoped workspace, a no-shell subprocess runner gated by
 * `policy.readOnly`, and a basic host allowlist for `fetch`. This is not a
 * sandbox — it adds exactly the checks the guardrail mapping
 * (`harness/guardrails/`) requires so a locked `read_only_execution` or
 * `scoped_write` guardrail has real teeth here, not just prose in a prompt.
 * No microVM/delegated/egress-proxy/credential-broker backend exists yet
 * (out of scope for this milestone).
 */
export function createLocalExecutionEnv(options: LocalExecutionEnvOptions = {}): ExecutionEnv {
  const rootDir = options.rootDir ?? process.cwd();
  const fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
  const maxBufferBytes = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
  const execImpl = options.execImpl ?? ((cmd: ExecCommand) => runSubprocess(cmd, maxBufferBytes));

  return {
    async exec(cmd, policy) {
      if (cmd.mode === "write" && policy.readOnly) {
        throw new ReadOnlyViolationError(cmd.command);
      }
      return execImpl(cmd);
    },

    async readFile(filePath, policy) {
      const resolved = resolveWithinScope(rootDir, policy.artifactWriteScope, filePath);
      return readFileAsync(resolved, "utf-8");
    },

    async writeFile(filePath, data, policy) {
      // read_only_execution and a locked scoped_write guardrail coexist by
      // design (see EnforcementPolicy's doc comment) — writing the output
      // artifact is gated purely on artifactWriteScope, never on readOnly.
      if (policy.artifactWriteScope === undefined) {
        throw new WriteScopeNotGrantedError(filePath);
      }
      const resolved = resolveWithinScope(rootDir, policy.artifactWriteScope, filePath);
      await mkdir(path.dirname(resolved), { recursive: true });
      await writeFileAsync(resolved, data, "utf-8");
    },

    async fetch(req, policy) {
      const host = new URL(req.url).host;
      const allowed = policy.allowedHosts ?? [];
      if (!allowed.includes(host)) {
        throw new EgressNotAllowedError(host);
      }
      const response = await fetchImpl(req.url, {
        method: req.method ?? "GET",
        ...(req.headers ? { headers: req.headers } : {}),
        ...(req.body !== undefined ? { body: req.body } : {}),
      });
      const body = await response.text();
      return { status: response.status, body } satisfies FetchResponse;
    },
  };
}

/**
 * Resolves `requestedPath` against `scope` (itself resolved against
 * `rootDir` when relative) and rejects anything that escapes it — the
 * directory-traversal check `writeFile`/`readFile` both rely on. A
 * `scope` of `undefined` confines reads to `rootDir` directly; `writeFile`
 * rejects that case itself before ever reaching here.
 */
function resolveWithinScope(rootDir: string, scope: string | undefined, requestedPath: string): string {
  const scopeAbs = path.resolve(rootDir, scope ?? ".");
  const targetAbs = path.resolve(scopeAbs, requestedPath);
  const relative = path.relative(scopeAbs, targetAbs);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new PathTraversalError(requestedPath, scopeAbs);
  }
  return targetAbs;
}

function runSubprocess(cmd: ExecCommand, maxBufferBytes: number): Promise<ExecResult> {
  return new Promise((resolve) => {
    const options = {
      maxBuffer: maxBufferBytes,
      ...(cmd.cwd !== undefined ? { cwd: cmd.cwd } : {}),
      ...(cmd.timeoutMs !== undefined ? { timeout: cmd.timeoutMs } : {}),
    };
    const child = execFile(cmd.command, cmd.args ? [...cmd.args] : [], options, (error, stdout, stderr) => {
      // A spawn failure (the binary isn't on PATH/doesn't exist)
      // reports its error as `error.code === "ENOENT"` — a STRING. The old
      // `typeof error.code === "number"` check treated that as "not a real
      // exit code" and fell through to the generic `error ? 1 : 0`,
      // flattening a missing-binary condition into an indistinguishable
      // `exitCode: 1` with empty `stderr` (the process never ran, so it
      // never wrote anything) — laundering a clear "not found" into what
      // looks like an ordinary command failure.
      if (error && error.code === "ENOENT") {
        resolve({ stdout, stderr, exitCode: 1, notFound: true });
        return;
      }
      // guardrail-enforcement fix: `statementTimeoutSec` is only real
      // enforcement if a hung `wren`/`warble` subprocess actually gets killed
      // and reported distinguishably, rather than left to run forever. Node
      // sets `error.killed === true` for its own `timeout` option; `stderr`
      // is often empty in this case (the process was killed mid-run, not
      // given a chance to explain itself), so a fallback message is supplied.
      if (error && error.killed === true) {
        resolve({
          stdout,
          stderr: stderr.length > 0 ? stderr : `subprocess "${cmd.command}" timed out after ${cmd.timeoutMs}ms`,
          exitCode: 1,
          timedOut: true,
        });
        return;
      }
      // Same rationale as above, for the other silent-killer: an oversized
      // result set previously died on execFile's default 1 MiB `maxBuffer`
      // as an opaque exit-1 with empty stderr, indistinguishable from any
      // other failure.
      if (error && error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
        resolve({
          stdout,
          stderr: stderr.length > 0 ? stderr : `subprocess "${cmd.command}" exceeded the ${maxBufferBytes}-byte output buffer`,
          exitCode: 1,
          maxBufferExceeded: true,
        });
        return;
      }
      const exitCode = error && typeof error.code === "number" ? error.code : error ? 1 : 0;
      resolve({ stdout, stderr, exitCode });
    });

    // ExecCommand has no stdin/input field: every command routed through this
    // backend is deliberately non-interactive. Leaving execFile's writable
    // stdin pipe open falsely promises that input may arrive later, so a bare
    // interpreter or any other stdin reader waits forever. End it immediately
    // to deliver EOF; if a future caller needs input, that must become an
    // explicit ExecCommand contract which writes the payload and then ends.
    child.stdin?.end();
  });
}
