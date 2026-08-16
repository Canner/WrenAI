import { execFile } from "node:child_process";
import { WarbleCommandFailedError } from "../compile/errors.js";
import type { ResolvedCli } from "./agent-sdk-cli.js";

// Mirrors `compile/pipeline.ts`'s `WARBLE_COMMAND_TIMEOUT_MS` — a generous
// ceiling for a local, normally-sub-second command; guards against a hang,
// not meant to ever fire in normal operation.
const AGENT_SDK_MANIFEST_TIMEOUT_MS = 2 * 60 * 1000;

export interface AgentSdkManifestCommand {
  readonly command: string;
  readonly args: readonly string[];
}

export interface BuildAgentSdkManifestArgsOptions {
  readonly irPath: string;
  /** Omitted for a raw bootstrap profile, which has no bound project yet. */
  readonly userProject?: string;
}

/**
 * Builds the argv for a `warble-agent-sdk manifest` invocation without
 * spawning anything: `<agent-sdk-cli> manifest <ir.json> --project
 * <userProject> --include-unavailable`. The display-only flag keeps an
 * unsupported declared component visible without making it executable.
 * Omitting `--out` is deliberate — the dispatcher's
 * `manifest` subcommand writes the manifest JSON to stdout only when no
 * `--out` is given (resolution summaries always go to stderr), so stdout
 * stays pure JSON for `runAgentSdkManifest` to parse.
 */
export function buildAgentSdkManifestArgs(
  cli: ResolvedCli,
  options: BuildAgentSdkManifestArgsOptions,
): AgentSdkManifestCommand {
  return {
    command: cli.command,
    args: [
      ...cli.prefixArgs,
      "manifest",
      options.irPath,
      "--include-unavailable",
      ...(options.userProject !== undefined ? ["--project", options.userProject] : []),
    ],
  };
}

/**
 * Runs a `warble-agent-sdk manifest` invocation (built by
 * {@link buildAgentSdkManifestArgs}) to completion and returns its stdout — a
 * single JSON blob, not a stream, so this mirrors `compile/pipeline.ts`'s
 * buffered `runWarble` rather than `mode-b.ts`'s streaming `spawnChat`
 * (there's no incremental per-step output to relay for a describe/introspect
 * call). Reuses `WarbleCommandFailedError` since it's already the generic
 * "an external warble-family CLI exited non-zero" error shape.
 */
export function runAgentSdkManifest(command: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      { maxBuffer: 32 * 1024 * 1024, timeout: AGENT_SDK_MANIFEST_TIMEOUT_MS },
      (error, stdout, stderr) => {
        if (error) {
          const exitCode = typeof error.code === "number" ? error.code : 1;
          const clarifiedStderr =
            stderr.length > 0
              ? stderr
              : error.killed === true
                ? `warble-agent-sdk manifest subprocess timed out after ${AGENT_SDK_MANIFEST_TIMEOUT_MS}ms`
                : error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
                  ? "warble-agent-sdk manifest subprocess exceeded the 32 MiB output buffer"
                  : stderr;
          reject(new WarbleCommandFailedError(command, args, exitCode, clarifiedStderr, stdout));
          return;
        }
        resolve(stdout);
      },
    );
  });
}
