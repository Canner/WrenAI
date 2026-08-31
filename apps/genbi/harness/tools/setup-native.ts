import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { tool, type Tool } from "ai";
import { z } from "zod";
import type { ExecutionEnv, ExecutionPolicy } from "../exec/index.js";
import { SetupCommandDeniedError, SetupExecCwdScopeError, SetupExecutionInputError, SetupWriteScopeError } from "./errors.js";

/**
 * `setup_execution` (native realization): the ONE native tool
 * `connect_source` and `build_context` both bind to (see
 * `providers/setup.provider.yaml`) — a scope-limited exec + write pair
 * mirroring the `setup_execution` guardrail's semantics on the dispatched
 * (claude-agent-sdk) side of the same onboarding flow, so an api-key/in-process
 * session can drive the same setup components under an equivalent, not
 * merely similarly-named, permission boundary.
 *
 * DESTRUCTIVE/REDIRECTION below are copied VERBATIM from warble's
 * claude-agent-sdk dispatcher (`dispatcher/claude-agent-sdk/src/guardrails.ts`,
 * `GuardConfig.setupScope` branch) rather than reinvented — the brief for
 * this work is explicit that a hand-rolled second copy that drifts from the
 * original is an exploitable gap, not a stylistic choice. All three of
 * DESTRUCTIVE/REDIRECTION/the dotenv-read pair below are checked FIRST and
 * unconditionally, before any other permission logic, exactly as that
 * dispatcher orders its own two, and are never relaxed because the scope is a
 * setup scope.
 *
 * The dotenv-read pair (DOTENV_READER_COMMANDS + DOTENV_PATH) is a
 * genbi-side addition neither DESTRUCTIVE nor REDIRECTION covers: the setup
 * credential design (see `credentialBoundary` in `server/compose.ts` and the
 * onboarding skill) writes an EMPTY `.env` template and never reads it back —
 * but nothing enforced that until this pair was added. Observed live (real
 * `gpt-4.1`, in-process): the agent ran `cat <project>/.env` through this same
 * `exec` action, it succeeded (neither DESTRUCTIVE nor REDIRECTION matches a
 * plain read), and the full stdout — a connection string, or for
 * postgres/snowflake/bigquery, a password/API-key/service-account value — was
 * handed back to the model AND persisted verbatim into the BFF's
 * `turns.trace_json` (see `redactSetupExecutionOutput` below, the persistence-side
 * companion to this pair). A counterpart change belongs in warble's
 * claude-agent-sdk dispatcher (same file/branch as DESTRUCTIVE/REDIRECTION
 * above) so the dispatched side of this same setup scope gets the identical
 * guard — kept in the same shape and same position here so that copy can
 * mirror it byte-for-byte.
 */
const DESTRUCTIVE = /\b(rm|sudo|dd|mkfs|shutdown|reboot|kill|chmod|chown|mv|cp)\b/;
/** Shell output redirection — an artifact/warehouse write escape (same rationale/regex as the dispatcher side). */
const REDIRECTION = /(^|[^>])>>?[^>]/;
/**
 * Reader commands that can print a file's contents: `cat`, `head`, `tail`,
 * `less`, `more`, `od`, `xxd`, `strings`, `grep`, `awk`, `sed`. Matched as a
 * whole word (`\b`) so a lookalike substring inside another word — `cat`
 * inside "concatenate", `sed` inside "used", `od` inside "produce" — never
 * matches.
 */
const DOTENV_READER_COMMANDS = /\b(cat|head|tail|less|more|od|xxd|strings|grep|awk|sed)\b/;
/**
 * A `.env`/`.env.<suffix>` path token (`.env`, `project/.env`,
 * `.env.local`, `.env.production`, …), matched precisely: the literal
 * `.env` must be preceded by start-of-string/whitespace/quote/`/`/`=` and
 * followed by end-of-string/whitespace/quote/`/`, with an optional
 * `.<suffix>` in between. This is what keeps a file named `.environment`
 * (no boundary right after `.env` — the next character is `i`, not one of
 * the above) and a bare directory named `env/` (no leading dot at all) from
 * tripping the match, even though both contain the substring "env" — both
 * are exercised in `test/setup-native.test.ts`.
 */
const DOTENV_PATH = /(^|[\s"'/=])\.env(\.[\w.-]+)?(?=$|[\s"'/])/;

// A setup exec may legitimately perform a cold schema discovery or context
// build, so this is a generous hang guard rather than a performance target.
// It matches the existing warble compile/dispatch ceiling. In-process previously
// supplied no timeout at all, allowing one interactive or deadlocked command
// to leave the setup turn (and its explicit recovery retry) running forever.
const SETUP_EXEC_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * Whether `command`'s TEXT references a dotenv-shaped path at all —
 * independent of whether it's paired with a known reader command. Used both
 * by `assertCommandAllowed` (paired with `DOTENV_READER_COMMANDS`, below) and
 * by `redactSetupExecutionOutput` (unpaired — see that function's doc
 * comment for why the persistence-side check is deliberately broader).
 */
function commandReferencesDotenvPath(command: string): boolean {
  return DOTENV_PATH.test(command);
}

export const SETUP_EXECUTION_TOOL_NAME = "setup_execution";

export interface SetupExecutionToolOptions {
  /** Backend the tool's side effects route through — never a direct child_process/fs call. */
  readonly env: ExecutionEnv;
  readonly policy: ExecutionPolicy;
  /**
   * The setup workspace root — the default (and outer bound) for the `exec`
   * action's subprocess `cwd`, and the `write` action's scope boundary.
   * Always caller-supplied and fixed as the ceiling; the `exec` action MAY
   * narrow its own cwd via an optional per-call `cwd` field (see
   * `resolveExecCwd`), but that value is contained by the same two-phase
   * check as the write path and can never resolve outside this root — a
   * command/path can narrow its own working directory within the root, but
   * never broaden either its cwd or its write scope beyond it.
   */
  readonly workspaceRoot: string;
}

/**
 * A single flat top-level object, NOT a `z.discriminatedUnion` — a
 * discriminated union serializes (via `z.toJSONSchema`) to a schema whose
 * TOP level is `{"oneOf": [...]}` with no top-level `"type": "object"`, which
 * both OpenAI's function-calling API and Anthropic's `input_schema` reject
 * outright (confirmed against a real OpenAI `gpt-4.1` call; see
 * `test/native-tool-schema-shape.test.ts` for the offline, no-API-key-spent
 * regression coverage). `command`/`path`/`content` are therefore all
 * optional here — the per-action required-field combination a discriminated
 * union would enforce at the schema level is instead checked in
 * `createSetupExecutionTool`'s `execute`, before any side effect.
 *
 * Flattening the schema drops the model-facing pairing a discriminated union
 * used to encode for free (`exec` needs `command`; `write` needs `path` +
 * `content`) — nothing about the field TYPES says which action requires
 * which field. Since in-process has no turn budget (unlike dispatched's fixed
 * `--max-turns` cap on setup), an under-described schema makes that pairing
 * discoverable only by the model guessing wrong and reading a thrown
 * `SetupExecutionInputError` back — unbounded trial-and-error on the user's
 * own API spend. The `.describe()` calls below and the tool `description` in
 * `createSetupExecutionTool` spell the pairing out explicitly so the model
 * can satisfy it on the first call; the `execute`-time checks remain as the
 * enforced (not just described) guarantee.
 */
export const setupExecutionInputSchema = z.object({
  action: z.enum(["exec", "write"]).describe('Which operation to perform: "exec" runs a shell command; "write" writes a file.'),
  command: z.string().optional().describe('Required when action is "exec": the shell command to run. Not used for "write".'),
  cwd: z
    .string()
    .optional()
    .describe(
      'Optional for both actions: use this directory instead of the workspace root as the command cwd or the base for a relative write path (e.g. the project directory). Absolute or relative to the workspace root, and must resolve within it. Defaults to the workspace root when omitted. For exec, use this instead of "cd <dir> && ..." chaining.',
    ),
  path: z
    .string()
    .optional()
    .describe(
      'Required when action is "write": the file path to write. A relative path is resolved from cwd when supplied, otherwise from the setup workspace root; an absolute path is allowed only within that root. Not used for "exec".',
    ),
  content: z.string().optional().describe('Required when action is "write": the file content to write. Not used for "exec".'),
});

export type SetupExecutionInput = z.infer<typeof setupExecutionInputSchema>;
export type SetupExecutionResult =
  | {
      exitCode: number;
      stdout: string;
      stderr: string;
      notFound?: boolean;
      timedOut?: boolean;
      maxBufferExceeded?: boolean;
    }
  | { written: true; path: string; bytes: number };

/**
 * Rejects a command matching the destructive/redirection/dotenv-read
 * denylist BEFORE it is ever handed to `ExecutionEnv.exec` — a rejection
 * here has run zero subprocess, exactly like the dispatcher-side
 * `canUseTool` handler that denies before invoking the tool at all.
 *
 * The dotenv-read check is checked FIRST (see this module's top doc comment)
 * and requires BOTH `DOTENV_READER_COMMANDS` and `commandReferencesDotenvPath`
 * to match — either alone is over- or under-broad: `DOTENV_READER_COMMANDS`
 * alone would deny an unrelated `cat notes.txt`; `commandReferencesDotenvPath`
 * alone would deny `wren project show .env-example-model` (a path that merely
 * mentions ".env" as a substring of something else, not a read of it) or a
 * legitimate write-scoped `action: "write"` call — though that case can't
 * actually reach here, since `assertCommandAllowed` is only ever called from
 * the `exec` branch, never `write` (see `createSetupExecutionTool` below) —
 * the empty `.env` template write this whole boundary exists to protect stays
 * unaffected by construction, not merely by this check's shape.
 *
 * KNOWN GAPS (a command-text mitigation, not a shell parser — see the exec
 * denylist's overall doc comment): shell indirection that never spells
 * ".env" in the same command string (a variable populated from a
 * base64/hex-decoded literal, or a wrapper script written in a PRIOR call
 * that itself references .env); a reader not in `DOTENV_READER_COMMANDS`
 * (`hexdump`, `wc`, a `python`/`node`/`perl` one-liner, `source .env`/`.
 * .env` sourcing it into the shell's own environment then echoing a
 * variable back); and a recursive/glob read that never names the file
 * literally (`grep -r PASSWORD .`). None of these are caught here.
 */
function assertCommandAllowed(command: string): void {
  if (DOTENV_READER_COMMANDS.test(command) && commandReferencesDotenvPath(command)) {
    throw new SetupCommandDeniedError(command, "matches the dotenv-read denylist");
  }
  if (DESTRUCTIVE.test(command)) {
    throw new SetupCommandDeniedError(command, "matches the destructive-command denylist");
  }
  if (REDIRECTION.test(command)) {
    throw new SetupCommandDeniedError(command, "matches the shell-redirection denylist");
  }
}

/**
 * Redacts `stdout`/`stderr` from an exec result whenever `command`'s TEXT
 * references a dotenv path — the persistence-side companion to
 * `assertCommandAllowed`. Applied INSIDE this tool's own `execute`, not
 * downstream in `harness/loop/executor.ts`, so there is exactly one choke
 * point for this tool: the redacted shape is both what the model sees in the
 * tool-loop AND what `executor.ts` later persists verbatim into
 * `turns.trace_json` (it persists whatever this tool returns as
 * `part.output`, unmodified — see `reportToolCallOutcomes`/
 * `summarizeToolOutput`, which only bound length, not content). There is no
 * second "does this look like a dotenv path" check downstream that could
 * drift from this one.
 *
 * Deliberately UNPAIRED with `DOTENV_READER_COMMANDS` (unlike
 * `assertCommandAllowed`'s check): every KNOWN reader is already denied
 * outright before it runs, so a command only ever reaches this function
 * having already executed — either because it doesn't reference a dotenv
 * path at all (no-op), or because it references one via a reader NOT in
 * `DOTENV_READER_COMMANDS` (the exact "KNOWN GAPS" listed on
 * `assertCommandAllowed`: `hexdump`, `wc`, a `python`/`node`/`perl`
 * one-liner, `source .env`/`. .env` shell-sourcing then echoing a variable,
 * `grep -r` without naming the file literally). Redacting on the broader,
 * unpaired check is defense in depth for exactly the readers the paired
 * check in `assertCommandAllowed` can't enumerate.
 *
 * Deliberately NOT a blanket "omit all setup stdout": that would destroy the
 * exact debuggability this defect (and others) were diagnosed with —
 * reading real commands/outputs back out of `turns.trace_json` in SQLite.
 * Scoping the redaction to commands whose text references a dotenv path
 * keeps every other setup command's output intact for that diagnosis while
 * closing the credential leak. `exitCode`/`notFound`/`timedOut`/
 * `maxBufferExceeded` are left untouched too — only the two fields that can
 * actually CONTAIN file contents are ever replaced, so "did the command
 * succeed/timeout/get truncated" stays diagnosable even for a redacted call.
 *
 * KNOWN GAP: this only redacts the current call's OWN stdout/stderr. A
 * command that reads `.env` indirectly and echoes its contents back through
 * some other channel this tool doesn't see (e.g. a value smuggled into a
 * LATER command's argument list, or into a file this tool then reads without
 * the path itself mentioning "env") is not caught here — a mitigation on the
 * common path, not an airtight seal.
 */
function redactSetupExecutionOutput(
  command: string,
  result: { stdout: string; stderr: string },
): { stdout: string; stderr: string } {
  if (!commandReferencesDotenvPath(command)) {
    return result;
  }
  const REDACTED = "[redacted: command references a dotenv path]";
  return {
    stdout: result.stdout.length > 0 ? REDACTED : result.stdout,
    stderr: result.stderr.length > 0 ? REDACTED : result.stderr,
  };
}

/**
 * Resolves `requestedPath` against `root` and rejects anything that escapes
 * it, via `path.relative` — NEVER a bare `startsWith` (a root of `/x/a` must
 * not admit a sibling `/x/a-evil`; `path.relative("/x/a", "/x/a-evil")` is
 * `"../a-evil"`, which the `..`-prefix check below catches, whereas
 * `"/x/a-evil".startsWith("/x/a")` would wrongly admit it). Mirrors
 * `harness/route/artifact-content.ts`'s `escapesRoot` exactly.
 */
function escapesRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative.startsWith("..") || path.isAbsolute(relative);
}

/**
 * Realpath-resolves the nearest EXISTING ancestor of `target` and re-appends
 * whatever tail components don't exist yet, rather than realpath-ing
 * `target` itself — a write's target commonly doesn't exist yet, and
 * `realpathSync` throws ENOENT on a nonexistent path. Only the existing
 * ancestor chain can possibly BE a symlink, so resolving it (and leaving the
 * not-yet-existing tail literal) is sufficient to catch a symlink escape
 * without requiring the target to already exist. Mirrors
 * `resolveArtifactContent`'s two-phase (nominal, then realpath) containment
 * pattern in `harness/route/artifact-content.ts`, adapted for a write whose
 * target is usually new.
 */
function realpathNearestExisting(target: string): string {
  let candidate = target;
  const tail: string[] = [];
  while (!existsSync(candidate)) {
    const parent = path.dirname(candidate);
    if (parent === candidate) break; // reached the filesystem root without finding anything existing
    tail.unshift(path.basename(candidate));
    candidate = parent;
  }
  const realAncestor = realpathSync(candidate);
  return tail.length > 0 ? path.join(realAncestor, ...tail) : realAncestor;
}

/**
 * Two-phase containment check shared by the `write` action's path scope and
 * the `exec` action's optional `cwd` override (see {@link resolveExecCwd}):
 * (1) a nominal, zero-filesystem-access `path.relative` check against
 * `workspaceRoot`, which rejects an out-of-scope path (including the
 * sibling-prefix case) before touching disk at all; (2) a realpath-based
 * re-check (see {@link realpathNearestExisting}) that catches a symlink
 * escape a nominal check alone would miss. Either phase failing throws
 * whatever error `makeError` constructs, with zero side effects — nothing is
 * written or spawned. Returns the resolved absolute path on success, so a
 * caller that needs it (the exec cwd) doesn't have to resolve it a second
 * time.
 */
function assertWithinScope(workspaceRoot: string, requestedPath: string, makeError: (requestedPath: string, scope: string) => Error): string {
  const nominalTarget = path.isAbsolute(requestedPath) ? path.resolve(requestedPath) : path.resolve(workspaceRoot, requestedPath);
  if (escapesRoot(workspaceRoot, nominalTarget)) {
    throw makeError(requestedPath, workspaceRoot);
  }

  const realRoot = realpathNearestExisting(workspaceRoot);
  const realTarget = realpathNearestExisting(nominalTarget);
  if (escapesRoot(realRoot, realTarget)) {
    throw makeError(requestedPath, workspaceRoot);
  }
  return nominalTarget;
}

/**
 * Resolves a write target from the same optional cwd an exec can use. A
 * relative path is based at cwd (or workspaceRoot when omitted); an absolute
 * path remains absolute. Both cwd itself and the final target pass through
 * the existing nominal + realpath workspace containment check, so adding a
 * project-relative convenience cannot broaden the write scope.
 */
function resolveWritePath(workspaceRoot: string, requestedPath: string, requestedCwd: string | undefined): string {
  const makeError = (requested: string, scope: string) => new SetupWriteScopeError(requested, scope);
  const baseDir = requestedCwd === undefined ? workspaceRoot : assertWithinScope(workspaceRoot, requestedCwd, makeError);
  const target = path.isAbsolute(requestedPath) ? requestedPath : path.resolve(baseDir, requestedPath);
  return assertWithinScope(workspaceRoot, target, makeError);
}

/**
 * Resolves the `exec` action's effective subprocess `cwd`: `workspaceRoot`
 * itself when `requestedCwd` is unset (the unchanged default), otherwise
 * `requestedCwd` run through the same two-phase containment check as the
 * write path (see {@link assertWithinScope}), throwing
 * {@link SetupExecCwdScopeError} on escape. A model can therefore narrow the
 * exec cwd to any directory within `workspaceRoot` (e.g. the project
 * directory), but never broaden it beyond that root.
 */
function resolveExecCwd(workspaceRoot: string, requestedCwd: string | undefined): string {
  if (requestedCwd === undefined) {
    return workspaceRoot;
  }
  return assertWithinScope(workspaceRoot, requestedCwd, (requestedCwd, scope) => new SetupExecCwdScopeError(requestedCwd, scope));
}

/**
 * Builds the combined `setup_execution` tool: `action: "exec"` runs a shell
 * command via `/bin/sh -c`, cwd defaulting to `workspaceRoot` but narrowable
 * per-call via the optional `cwd` field (see {@link resolveExecCwd} — always
 * contained within `workspaceRoot`, never able to escape it), broadened
 * beyond a single fixed binary the way the dispatcher-side `setup_execution`
 * guardrail broadens Bash — but still subject to the same denylist, checked
 * first, never relaxed. `action: "write"` writes a file relative to the same
 * optional cwd (workspaceRoot by default), scoped to `workspaceRoot` by the
 * two-phase containment check above, then delegates the actual write to
 * `env.writeFile` (which applies its OWN, nominal-only
 * `policy.artifactWriteScope` check — this tool's pre-flight check is
 * additional, not a replacement, since `env.writeFile` has no realpath
 * re-check of its own; see `harness/exec/local.ts`).
 */
export async function executeSetupExecution(
  input: SetupExecutionInput,
  options: SetupExecutionToolOptions,
): Promise<SetupExecutionResult> {
  const { env, policy, workspaceRoot } = options;

  if (input.action === "exec") {
    if (input.command === undefined) {
      throw new SetupExecutionInputError("exec", "command");
    }
    assertCommandAllowed(input.command);
    const cwd = resolveExecCwd(workspaceRoot, input.cwd);
    const result = await env.exec(
      { mode: "write", command: "/bin/sh", args: ["-c", input.command], cwd, timeoutMs: SETUP_EXEC_TIMEOUT_MS },
      policy,
    );
    const { stdout, stderr } = redactSetupExecutionOutput(input.command, result);
    return {
      exitCode: result.exitCode,
      stdout,
      stderr,
      ...(result.notFound !== undefined ? { notFound: result.notFound } : {}),
      ...(result.timedOut !== undefined ? { timedOut: result.timedOut } : {}),
      ...(result.maxBufferExceeded !== undefined ? { maxBufferExceeded: result.maxBufferExceeded } : {}),
    };
  }

  if (input.path === undefined) throw new SetupExecutionInputError("write", "path");
  if (input.content === undefined) throw new SetupExecutionInputError("write", "content");
  const writePath = resolveWritePath(workspaceRoot, input.path, input.cwd);
  await env.writeFile(writePath, input.content, policy);
  return { written: true, path: writePath, bytes: input.content.length };
}

export function createSetupExecutionTool(options: SetupExecutionToolOptions): Tool {

  return tool({
    description:
      "Run a shell command or write a file within the setup workspace, subject to a destructive/redirection " +
      'command denylist and a workspace-root scope. Two call shapes: {action: "exec", command, cwd?} runs a ' +
      "shell command (command is required; cwd is optional, defaults to the workspace root, and must resolve " +
      'within it — path/content are unused); {action: "write", path, content, cwd?} writes a file (path and content ' +
      "are both required; a relative path uses cwd when supplied, otherwise the workspace root; command is unused). A call missing the field(s) its action requires, or " +
      "supplying a cwd/path that escapes the workspace root, is rejected before anything runs or is written.",
    inputSchema: setupExecutionInputSchema,
    execute: (input: SetupExecutionInput) => executeSetupExecution(input, options),
  });
}
