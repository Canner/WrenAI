/**
 * Thrown when an `agent.tools[]` entry declares `source: "native"` under a
 * name the injected native-tool registry has no factory for.
 */
export class UnknownNativeToolError extends Error {
  constructor(name: string) {
    super(`no native tool registered for name: "${name}"`);
    this.name = "UnknownNativeToolError";
  }
}

/**
 * Thrown when an `agent.tools[]` entry declares `source: "mcp:<server>/<name>"`
 * for a server id that has no entry in the runtime-injected `McpServerConfigMap`.
 * This is the "server-missing" half of tool-level fail-fast — it fires before
 * any MCP connection is attempted.
 */
export class McpServerNotConfiguredError extends Error {
  constructor(serverId: string) {
    super(
      `agent declares a tool from MCP server "${serverId}" but no server ` +
        `config was provided (expected an entry in the McpServerConfigMap)`,
    );
    this.name = "McpServerNotConfiguredError";
  }
}

/**
 * Thrown when a declared `mcp:<server>/<name>` tool's server connects
 * successfully but its discovered tool set does not include `<name>`. This
 * is the "tool-missing" half of tool-level fail-fast.
 */
export class McpToolNotExposedError extends Error {
  constructor(serverId: string, toolName: string) {
    super(`MCP server "${serverId}" does not expose a tool named "${toolName}"`);
    this.name = "McpToolNotExposedError";
  }
}

/** Thrown when an `agent.tools[]` entry's `source` is not `"native"` or `"mcp:<server>/<name>"`. */
export class UnsupportedToolSourceError extends Error {
  constructor(source: string) {
    super(`unsupported tool source: "${source}" (expected "native" or "mcp:<server>/<name>")`);
    this.name = "UnsupportedToolSourceError";
  }
}

/** Thrown when the native `query` tool's underlying `wren` CLI invocation exits non-zero. */
export class WrenQueryExecutionError extends Error {
  constructor(sql: string, exitCode: number, stderr: string) {
    super(`wren query failed with exit code ${exitCode} for SQL: ${sql}\n${stderr}`);
    this.name = "WrenQueryExecutionError";
  }
}

/**
 * Thrown when the `wren` binary cannot be found — either at preflight (not on
 * `PATH` before a native-tool run even starts, see `resolveWrenBinary`) or
 * mid-run (a spawn `ENOENT` on a `query` tool call, e.g. `wren` was
 * uninstalled/moved after preflight passed; see `ExecResult.notFound` in
 * `harness/exec/types.ts`). Deliberately its own error, distinct from
 * `WrenQueryExecutionError`, so a missing binary is never mistaken for an
 * ordinary nonzero exit (which the repair-fold loop may otherwise retry).
 */
export class WrenBinaryNotFoundError extends Error {
  constructor(detail: string) {
    super(`could not find the "wren" binary: ${detail}\nfix: install wren and ensure it is on PATH.`);
    this.name = "WrenBinaryNotFoundError";
  }
}

/**
 * Thrown when the native `semantic_introspect` tool's underlying
 * `wren context show -o json` invocation either exits non-zero or exits zero
 * but prints stdout that doesn't parse as JSON. Both cases share this one
 * error type because introspection has no per-call input (no SQL) to report
 * alongside an exit-code failure — `detail` carries whichever of the two
 * happened. (The `query` tool only wraps its non-zero-exit case in
 * `WrenQueryExecutionError`; a `parseWrenJsonl` failure there surfaces as a
 * raw parse error — introspection wraps both.) Kept distinct from
 * `WrenQueryExecutionError` so a caller can still tell "the query tool
 * failed" from "introspection failed" apart; a missing binary still surfaces
 * as `WrenBinaryNotFoundError`, checked before either failure mode here.
 */
export class WrenIntrospectExecutionError extends Error {
  constructor(detail: string) {
    super(`wren context show failed: ${detail}`);
    this.name = "WrenIntrospectExecutionError";
  }
}

/**
 * Thrown when the `setup_execution` native tool's `exec` action is asked to
 * run a command matching the destructive/redirection denylist (verbatim
 * from warble's claude-agent-sdk dispatcher guardrails — see
 * `harness/tools/setup-native.ts`'s doc comment). Thrown BEFORE the command
 * is ever handed to `ExecutionEnv.exec`, so a rejection has zero side
 * effects — nothing is spawned.
 */
export class SetupCommandDeniedError extends Error {
  constructor(command: string, reason: string) {
    super(`setup command denied (${reason}): ${command}`);
    this.name = "SetupCommandDeniedError";
  }
}

/**
 * Thrown when the `setup_execution` native tool's `write` action is asked to
 * write outside the setup workspace root — either the nominal
 * `path.relative`-based check, or the realpath-based re-check that catches a
 * symlink escape (mirroring `harness/route/artifact-content.ts`'s two-phase
 * containment pattern). Thrown BEFORE `ExecutionEnv.writeFile` is ever
 * called, so a rejection has zero side effects — nothing is written.
 */
export class SetupWriteScopeError extends Error {
  constructor(requestedPath: string, scope: string) {
    super(`setup write path "${requestedPath}" escapes the setup workspace scope "${scope}"`);
    this.name = "SetupWriteScopeError";
  }
}

/**
 * Thrown when the `setup_execution` native tool's `exec` action is given a
 * `cwd` that resolves outside the setup workspace root — the same two-phase
 * containment check as `SetupWriteScopeError` (nominal `path.relative`, then
 * a realpath re-check for a symlink escape), applied to the exec cwd instead
 * of a write path. Thrown BEFORE `ExecutionEnv.exec` is ever called, so a
 * rejection has zero side effects — nothing is spawned.
 */
export class SetupExecCwdScopeError extends Error {
  constructor(requestedCwd: string, scope: string) {
    super(`setup exec cwd "${requestedCwd}" escapes the setup workspace scope "${scope}"`);
    this.name = "SetupExecCwdScopeError";
  }
}

/**
 * Thrown when the `setup_execution` native tool's flat input object is
 * missing the field its declared `action` requires — e.g. `action: "exec"`
 * with no `command`, or `action: "write"` with no `path`/`content`. The
 * tool's exposed `inputSchema` must be a single top-level object rather than
 * a discriminated union (see `harness/tools/setup-native.ts`'s module doc
 * comment for why), so the per-action required-field combination a
 * discriminated union would otherwise enforce at the schema level is instead
 * checked in `execute`, BEFORE `assertCommandAllowed`/`assertWriteWithinScope`
 * or any actual exec/write — a rejection here has zero side effects.
 */
export class SetupExecutionInputError extends Error {
  constructor(action: string, missingField: string) {
    super(`setup_execution action "${action}" requires a "${missingField}" field`);
    this.name = "SetupExecutionInputError";
  }
}
