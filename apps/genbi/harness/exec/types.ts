import type { ExecutionPolicy } from "./policy.js";

/**
 * A command's declared read/write intent. The harness does not parse or
 * sniff shell commands to infer this — the caller (a native tool) states it
 * up front, and a read-only policy rejects `"write"` commands outright.
 */
export type ExecMode = "read" | "write";

export interface ExecCommand {
  readonly mode: ExecMode;
  readonly command: string;
  readonly args?: readonly string[];
  /** Working directory the command runs in. Defaults to the process's cwd when omitted. */
  readonly cwd?: string;
  /** Maximum time (ms) the subprocess may run before being killed. Omitted means no timeout. */
  readonly timeoutMs?: number;
}

export interface ExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  /**
   * Set (`true`) when `cmd.command` itself could not be launched — a spawn
   * `ENOENT` (the binary isn't on `PATH`/doesn't exist), as opposed to the
   * command running and exiting non-zero on its own. Node's spawn error
   * carries this as the *string* `"ENOENT"` on `error.code`, not a number,
   * so callers must check `notFound` rather than inferring it from
   * `exitCode` — `exitCode` is set to `1` in this case only as a
   * conservative "not success" fallback for code that ignores `notFound`,
   * never as the real signal. Omitted (not just `false`) on an ordinary
   * exit so existing structural equality checks on `ExecResult` are
   * unaffected. See `createLocalExecutionEnv`'s `runSubprocess`.
   */
  readonly notFound?: boolean;
  /** Set (`true`) when the subprocess was killed because it exceeded `ExecCommand.timeoutMs`. Node's `execFile` sets `error.killed === true` for its own `timeout` option (and NOT for maxBuffer-exceeded — verified: `error.code` is `null` for timeout, not a number, not `"ENOENT"`). Omitted (not `false`) on an ordinary exit, same convention as `notFound`. */
  readonly timedOut?: boolean;
  /** Set (`true`) when the subprocess's combined stdout/stderr exceeded the exec backend's `maxBuffer` and was killed. Node reports this as `error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"` (verified on Node 23), distinct from both `notFound` and `timedOut`. Omitted (not `false`) on an ordinary exit. */
  readonly maxBufferExceeded?: boolean;
}

export interface FetchRequest {
  readonly url: string;
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface FetchResponse {
  readonly status: number;
  readonly body: string;
}

/**
 * The pluggable seam side-effecting native tools execute through instead of
 * touching the filesystem/network/subprocess directly — mirroring the
 * "injectable, defaulted" shape of `ProviderRegistry` and
 * `NativeToolRegistry`. v1 ships exactly one backend
 * ({@link createLocalExecutionEnv} in `./local.js`); no microVM / delegated /
 * egress-proxy / credential-broker backend exists yet (out of scope for
 * this milestone — tracked separately as hosted-runtime hardening).
 */
export interface ExecutionEnv {
  exec(cmd: ExecCommand, policy: ExecutionPolicy): Promise<ExecResult>;
  readFile(path: string, policy: ExecutionPolicy): Promise<string>;
  writeFile(path: string, data: string, policy: ExecutionPolicy): Promise<void>;
  fetch(req: FetchRequest, policy: ExecutionPolicy): Promise<FetchResponse>;
}
