import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { createInterface } from "node:readline";
import os from "node:os";
import path from "node:path";
import { enforceCompliance } from "../compliance/index.js";
import { compileProfile } from "../compile/pipeline.js";
import { resolveWarbleBinary } from "../compile/resolve-binary.js";
import { createAgentEventEmitter } from "../events/index.js";
import type { AgentEventInput } from "../events/index.js";
import {
  createChatEventMapperState,
  mapChatEventToAgentEvent,
  parseWarbleChatEventLine,
} from "./chat-event-mapper.js";
import { resolveAgentSdkCli } from "./agent-sdk-cli.js";
import type { ResolvedCli } from "./agent-sdk-cli.js";
import type { ModeBOptions, ModeBResult } from "./types.js";

const MODE_B_AGENT_ID = "answer_query";

export interface AgentSdkChatCommand {
  readonly command: string;
  readonly args: readonly string[];
  /** Fed to the child process over stdin, never interpolated into `args`. */
  readonly input: string;
}

export interface BuildAgentSdkChatArgsOptions {
  readonly irPath: string;
  readonly userProject: string;
  readonly question: string;
  readonly outDir: string;
  readonly warbleBin: string;
  /**
   * Which warble component `chat` dispatches, forwarded
   * verbatim as `--component <agentId>`. Defaults to `MODE_B_AGENT_ID`
   * (`"answer_query"`) when unset — the original default from before this
   * option existed. Named `agentId`
   * to match `ModeAOptions.agentId` (intent routing), even though
   * Mode B has no per-agent bundle concept of its own — it's the same
   * "which compiled thing to run" knob, just a component id on the warble
   * IR side rather than an agent id on a compiled vercel bundle.
   */
  readonly agentId?: string;
  /**
   * The "hybrid" passthrough: forwarded verbatim as `--models-config
   * <modelsConfig>` when set, omitted entirely otherwise (existing callers
   * that don't hybrid-route are byte-for-byte unaffected). This lets the
   * subscription main loop (Mode B) route one step onto a non-Anthropic
   * model per warble's own `ModelConfig.fromYaml` mechanism — see
   * `runModeBDefault`'s doc comment for the known limitations this inherits.
   */
  readonly modelsConfig?: string;
  /** Forwarded as `--max-turns <n>` when set; omitted otherwise so warble's default applies. */
  readonly maxTurns?: number;
  /**
   * Session resume: forwarded verbatim as `--resume <id>` when set, so the dispatcher resumes
   * the SAME agent-sdk conversation instead of starting a fresh one. See
   * `ModeBOptions.resumeSessionId`.
   */
  readonly resume?: string;
}

/**
 * Builds the argv (and stdin input) for a `warble-agent-sdk chat` invocation
 * without spawning anything — the validated shape from the earlier spike:
 * `echo "<question>" | <agent-sdk-cli> chat <ir.json> --project <userProject>
 * --component <agentId, default "answer_query"> --out <dir> --warble-bin
 * <warble> [--models-config <path>] --stream-json`. `--stream-json` is always
 * passed so `spawnChat` can incrementally parse per-step/per-tool NDJSON
 * events off stdout instead of only getting the plain final-answer line. The
 * question is always routed through `input` (stdin), never interpolated into
 * `args`, so it can never break argv parsing — there is no shell involved
 * either (`spawn`, not `exec`).
 *
 * `warble-agent-sdk chat` is a line-per-turn REPL over stdin — one
 * line is one turn. A question containing a newline (e.g. the BFF's
 * multi-turn Ask composing the last ~5 turns of prior context ahead of the
 * follow-up) would silently become *multiple* turns if sent as-is — only the
 * last turn's answer would ever be returned. The dispatcher can't be changed
 * (it's a separate, soon-public repo), so instead of rejecting a multi-line
 * question, `encodeQuestionForStdin` collapses its interior newlines into a
 * literal `\n` escape so the whole thing still crosses stdin as exactly one
 * line/turn; an LLM reads a literal `\n` in prose as a line break just fine.
 * A single-line question has nothing to collapse and passes through
 * unchanged. An empty/whitespace-only question is never a meaningful turn at
 * all and is still rejected here, before anything is spawned.
 */
export function buildAgentSdkChatArgs(
  cli: ResolvedCli,
  options: BuildAgentSdkChatArgsOptions,
): AgentSdkChatCommand {
  if (options.question.trim().length === 0) {
    throw new Error("Mode B question must not be empty or whitespace-only");
  }
  return {
    command: cli.command,
    args: [
      ...cli.prefixArgs,
      "chat",
      options.irPath,
      "--project",
      options.userProject,
      "--component",
      options.agentId ?? MODE_B_AGENT_ID,
      "--out",
      options.outDir,
      "--warble-bin",
      options.warbleBin,
      ...(options.modelsConfig !== undefined ? ["--models-config", options.modelsConfig] : []),
      ...(options.maxTurns !== undefined ? ["--max-turns", String(options.maxTurns)] : []),
      ...(options.resume !== undefined ? ["--resume", options.resume] : []),
      "--stream-json",
    ],
    input: `${encodeQuestionForStdin(options.question)}\n`,
  };
}

/**
 * Collapses every newline variant inside `question` into a literal
 * two-character `\n` escape so the result always fits on a single stdin
 * line/turn, no matter how many lines the caller composed into it. CRLF and
 * lone CR are normalized to LF first so every newline style escapes
 * uniformly. A question with no interior newline has nothing to normalize or
 * escape and is returned byte-for-byte unchanged.
 */
function encodeQuestionForStdin(question: string): string {
  return question.replace(/\r\n|\r/g, "\n").replace(/\n/g, "\\n");
}

/**
 * Mode B ("subscription"): compile the profile to IR only (`mode: "native"` —
 * no vercel bundle; the claude-agent-sdk dispatcher reads IR directly and
 * drives its own Claude Agent SDK `query()` loop at runtime, so no adapter/
 * tier binding is assembled here), then shell the warble-agent-sdk CLI's
 * `chat` subcommand, feeding the question over stdin and returning its
 * finishing text.
 *
 * The "hybrid" passthrough: `options.modelsConfig`, when set, becomes
 * `--models-config <path>` on the `chat` invocation (see
 * `buildAgentSdkChatArgs`), letting the subscription main loop route one
 * step (e.g. `resolve_intent`'s `cheap` tier) onto a non-Anthropic model via
 * warble's own `ModelConfig.fromYaml` binding
 * (`dispatcher/claude-agent-sdk/src/models.ts`). This harness only forwards
 * the path — it never parses the YAML or the resulting per-tier routing
 * itself, and inherits warble's own hybrid-mode holes as of this writing
 * (tracked upstream, not fixed here): the render stage wall-hits on any
 * non-`render: none` component under a non-Anthropic tier, the
 * `openai_compat` local client has no streaming/retry, and net cost savings
 * are unproven. Weak local models are also known to call tools unreliably —
 * a separate, model-quality issue rather than a wiring bug. See the opt-in
 * live hybrid tests (`test/hybrid-live.test.ts`) for how to exercise this
 * against a real endpoint.
 *
 * As a belt-and-suspenders measure, `route()` already runs the compliance gate
 * (`enforceCompliance`) before ever calling this function, but
 * `runModeBDefault` is also exported from the package root — an embedder
 * that imports it directly bypasses `route()`, and with it that gate,
 * entirely. Re-running `enforceCompliance` here makes the executor safe
 * regardless of entry point: `route()`'s call and this one are the same
 * pure, idempotent decision (subscription + hosted always throws,
 * subscription + personal always allows), so double-gating through
 * `route()` costs nothing and closes the direct-import hole.
 *
 * Session resume (Plan A): `options.resumeSessionId`, when set, is forwarded as `--resume <id>` so
 * the dispatcher resumes the SAME agent-sdk conversation for this turn instead of starting a fresh
 * one — the agent keeps whatever it already read/listed/fetched, rather than re-orienting from
 * scratch on every turn. The turn's own session id (for resuming a LATER turn) comes back on
 * `ModeBResult.sessionId` on success, and — since a resumable session id from a failed turn is just
 * as useful as one from a successful turn (an `error_max_turns` failure is exactly the case this
 * exists for) — is still recoverable from a thrown `ModeBSessionError`'s `sessionId` field when this
 * function rejects. This is deliberately independent of `irPath`/`resumeFromDisk`-style setup-state
 * reconstruction elsewhere in the harness (`server/compose.ts`): this option resumes the actual SDK
 * conversation, not a disk-state prompt rebuild.
 */
export async function runModeBDefault(options: ModeBOptions): Promise<ModeBResult> {
  // Live-event layer: emits run.start/answer/run.finish/error on
  // options.onEvent directly, plus — now that `chat --stream-json` streams
  // per-step/per-tool NDJSON over stdout — step.*/tool.* events mapped in
  // from that stream via `chat-event-mapper.ts` as `spawnChat` reads each
  // line (see there for the mapping). Mapped events are best-effort: a
  // malformed/unrecognized NDJSON line is dropped, not fatal to the turn.
  enforceCompliance(options.authChoice, { deployment: options.deployment ?? "personal" });

  // `SubscriptionAuthChoice.provider` is "claude" | "codex", but the
  // only Ask back-end this function drives is the Claude Agent SDK
  // dispatcher (`warble-agent-sdk chat`). Codex is selected by route() and
  // runs through the separate codex:local adapter.
  // Without this check, a `provider: "codex"` choice would silently run the
  // Claude dispatcher anyway (misrouting the request to the wrong model
  // family) instead of failing loudly. Fail before compiling or spawning
  // anything.
  if (options.authChoice.provider !== "claude") {
    throw new Error(
      `runModeBDefault only supports the Claude subscription provider. ` +
        `Codex Ask must be dispatched through the codex:local route and will not fall back.`,
    );
  }
  if (options.signal?.aborted) throw new Error("warble-agent-sdk chat was cancelled before start");

  // Which warble component `chat` dispatches; defaults to
  // MODE_B_AGENT_ID ("answer_query") — the original default from before this
  // option existed. See `ModeBOptions.agentId`.
  const agentId = options.agentId ?? MODE_B_AGENT_ID;

  const emitter = createAgentEventEmitter(options.onEvent);
  emitter.emit({ kind: "run.start", mode: "B", agentId });

  try {
    // Setup-flow bypass (`ModeBOptions.irPath`): skip compileProfile entirely
    // and dispatch the caller-supplied IR directly. Used by the setup
    // wizard's `ModeBSetupRunner`, which has no bound wren project to
    // compile a profile against — it dispatches the fixed, warble-committed
    // genbi-setup IR instead.
    const irPath = options.irPath ?? (await compileProfile({
      profileSource: options.profileSource,
      userProject: options.userProject,
      mode: "native",
      ...(options.warbleBin !== undefined ? { warbleBin: options.warbleBin } : {}),
      ...(options.workDir !== undefined ? { workDir: options.workDir } : {}),
    })).irPath;
    if (options.signal?.aborted) throw new Error("warble-agent-sdk chat was cancelled during preparation");

    const warbleBin = options.warbleBin ?? (await resolveWarbleBinary());
    if (options.signal?.aborted) throw new Error("warble-agent-sdk chat was cancelled during preparation");
    const cli = await resolveAgentSdkCli(options.agentSdkBin);
    if (options.signal?.aborted) throw new Error("warble-agent-sdk chat was cancelled during preparation");
    const outDir = options.outDir ?? (await mkdtemp(path.join(os.tmpdir(), "wren-harness-agent-sdk-")));
    if (options.signal?.aborted) throw new Error("warble-agent-sdk chat was cancelled during preparation");

    const command = buildAgentSdkChatArgs(cli, {
      irPath,
      userProject: options.userProject,
      question: options.question,
      outDir,
      warbleBin,
      agentId,
      ...(options.modelsConfig !== undefined ? { modelsConfig: options.modelsConfig } : {}),
      ...(options.maxTurns !== undefined ? { maxTurns: options.maxTurns } : {}),
      ...(options.resumeSessionId !== undefined ? { resume: options.resumeSessionId } : {}),
    });

    const { finalText, sessionId } = await spawnChat(
      command,
      (event) => emitter.emit(event),
      options.chatTimeoutMs ?? CHAT_TIMEOUT_MS,
      options.signal,
    );
    // `spawnChat` resolves with whatever trimmed final-answer text
    // the process produced, even if that's empty — e.g. the CLI exits 0 but
    // never printed a terminal answer line (a dispatcher bug, an unexpected
    // output-format change, or a turn that produced no text). Treat that as
    // a failure rather than a silent empty "answer".
    if (finalText.length === 0) {
      throw new Error(
        "warble-agent-sdk chat exited successfully but produced no stdout — expected the turn's " +
          "final answer text; got empty output",
      );
    }
    emitter.emit({ kind: "answer", text: finalText });
    emitter.emit({ kind: "run.finish", status: "answer" });
    return { finalText, ...(sessionId !== undefined ? { sessionId } : {}) };
  } catch (error) {
    emitter.emit({ kind: "error", message: describeModeBError(error) });
    emitter.emit({ kind: "run.finish", status: "error" });
    throw error;
  }
}

function describeModeBError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : JSON.stringify(error);
}

/**
 * A `spawnChat` turn that failed (non-zero exit, timeout, or spawn error) but still surfaced a
 * resumable SDK session id along the way (the dispatcher's `{t:"session",id}` NDJSON line — see
 * `chat-event-mapper.ts` and warble's own `DispatchSessionError`, which is what makes this possible
 * on a failed turn like `error_max_turns` in the first place, not just a successful one).
 * `sessionId` is `null` when the dispatcher emitted the session line but the SDK itself never
 * produced an id; it is simply absent as a property when `error` is a plain `Error` (e.g. a spawn
 * failure before any NDJSON was ever read) — callers should treat "not a `ModeBSessionError`" the
 * same as "no session id available", never as a hard failure of their own.
 */
export class ModeBSessionError extends Error {
  constructor(
    message: string,
    readonly sessionId: string | null,
  ) {
    super(message);
    this.name = "ModeBSessionError";
  }
}

// guardrail-enforcement fix: a hung `warble-agent-sdk chat` invocation
// previously blocked forever. This is a hang-guard CEILING (turns finish when
// done; it only fires on a genuine hang), so it's set generously: a cold Ask
// right after setup — a fresh, un-warmed project where answer_query explores
// before it queries — was observed to legitimately need >5 min, so 10 minutes
// is the default. Override via `ModeBOptions.chatTimeoutMs`
// (`--chat-timeout-ms` / `WREN_HARNESS_CHAT_TIMEOUT_MS`).
const CHAT_TIMEOUT_MS = 10 * 60 * 1000;

export interface SpawnChatResult {
  readonly finalText: string;
  /**
   * The SDK session id this turn ran under (the dispatcher's `{t:"session",id}` line), or
   * `undefined` if no such line was ever read (e.g. an older dispatcher build, or the process
   * died before emitting one).
   */
  readonly sessionId: string | null | undefined;
}

/**
 * Runs one `warble-agent-sdk chat --stream-json` turn, reading stdout INCREMENTALLY
 * (line-by-line, via `readline`) rather than buffering the whole process output like the
 * previous `execFile`-based version did — that's what lets `onEvent` fire live, per line, as the
 * turn runs, instead of only after the process exits. Each line is parsed with
 * `parseWarbleChatEventLine` and either captured as the turn's final answer (`t: "answer"`), its
 * resumable session id (`t: "session"` — tracked so it can be surfaced on BOTH a successful
 * resolve and a failed reject, since a resumable session id is just as useful after an
 * `error_max_turns` failure as after a success; see `ModeBSessionError`), or mapped to this
 * harness's `AgentEvent` vocabulary via `mapChatEventToAgentEvent` and forwarded to `onEvent`. A
 * line that fails to parse is silently dropped (never fatal to the turn — see that module's doc
 * comment). `onEvent` is always called unconditionally here; it is `runModeBDefault`'s
 * `emitter.emit`, which is already a documented no-op when the caller supplied no sink.
 */
function spawnChat(
  command: AgentSdkChatCommand,
  onEvent: (event: AgentEventInput) => void,
  timeoutMs: number = CHAT_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<SpawnChatResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new ModeBSessionError("warble-agent-sdk chat was cancelled before spawn", null)); return; }
    const child = spawn(command.command, [...command.args], {
      detached: process.platform !== "win32",
    });

    let settled = false;
    let stopReason: "timeout" | "cancelled" | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let answerText: string | undefined;
    let sessionId: string | null | undefined;
    let stderrText = "";
    const mapperState = createChatEventMapperState();

    const terminate = (childSignal: NodeJS.Signals): void => {
      if (child.pid !== undefined && process.platform !== "win32") {
        try {
          process.kill(-child.pid, childSignal);
          return;
        } catch {
          // Fall through to the direct child when it did not form a group.
        }
      }
      child.kill(childSignal);
    };
    const stop = (reason: "timeout" | "cancelled") => {
      if (settled || stopReason !== undefined) return;
      stopReason = reason;
      terminate("SIGTERM");
      killTimer = setTimeout(() => terminate("SIGKILL"), 1_000);
    };
    const timer = setTimeout(() => stop("timeout"), timeoutMs);
    const cancel = () => stop("cancelled");
    signal?.addEventListener("abort", cancel, { once: true });

    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      signal?.removeEventListener("abort", cancel);
      fn();
    };

    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.on("line", (line) => {
      const raw = parseWarbleChatEventLine(line);
      if (raw === undefined) return;
      if (raw.t === "answer") {
        answerText = raw.text;
        return;
      }
      if (raw.t === "session") {
        sessionId = raw.id;
        return;
      }
      const mapped = mapChatEventToAgentEvent(raw, mapperState);
      if (mapped !== undefined) onEvent(mapped);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrText += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      settle(() =>
        reject(new ModeBSessionError(`warble-agent-sdk chat failed to start: ${error.message}`, sessionId ?? null)),
      );
    });

    child.on("close", (code, signal) => {
      settle(() => {
        if (stopReason === "timeout") {
          reject(
            new ModeBSessionError(
              `warble-agent-sdk chat failed (timed out after ${timeoutMs}ms): ${stderrText}`,
              sessionId ?? null,
            ),
          );
          return;
        }
        if (stopReason === "cancelled") {
          reject(new ModeBSessionError("warble-agent-sdk chat was cancelled", sessionId ?? null));
          return;
        }
        if (code !== 0) {
          const exitCode = code ?? signal ?? "unknown";
          reject(
            new ModeBSessionError(
              `warble-agent-sdk chat failed (exit ${exitCode}): ${stderrText || "(no stderr output)"}`,
              sessionId ?? null,
            ),
          );
          return;
        }
        resolve({ finalText: (answerText ?? "").trim(), sessionId });
      });
    });

    child.stdin?.end(command.input);
  });
}
