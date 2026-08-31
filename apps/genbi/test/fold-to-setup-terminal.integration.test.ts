/**
 * Fold-to-gate integration test (Setup dispatcher capture/replay, deliverable #4).
 *
 * `test/parse-setup-terminal.test.ts` exercises `parseSetupTerminal` against hand-written
 * `SetupWorklogEntry[]` fixtures. Every one of those fixtures is typed by a human, so none of
 * them can catch a format divergence between what `server/fold.ts`'s `LiveWorkLog` actually
 * produces and what the gate (`harness/setup/runner.ts`) expects to read — that seam had zero
 * integration coverage, and it is exactly where a since-removed fixture in
 * `test/parse-setup-terminal.test.ts` (a hand-authored `"Exit code: 0\nFinal output:\n…"` string)
 * fabricated a shape the real pipeline never produces.
 *
 * This test closes that gap the principled way: it feeds real `AgentEvent`s through the REAL
 * `LiveWorkLog` (`server/fold.ts`, unmodified, imported directly) to get a REAL `ToolStep[]`, then
 * hands that straight to the REAL, unmodified `parseSetupTerminal` (`harness/setup/runner.ts`). No
 * layer in between is stubbed or hand-shaped.
 *
 * ## Where the event content itself comes from
 *
 * `AgentEvent` is this harness's OWN internal vocabulary (`harness/events/types.ts`), not a
 * foreign dispatcher's wire format — constructing valid instances of it here is authoring input
 * to `fold.ts`, not fabricating `fold.ts`'s own output (which a hand-authored fixture claiming to
 * be another layer's output would be). The one place a belief about an external format sneaks in
 * is the `summary` string on the `Bash` tool_result events below: it is modeled on
 * `summarizeResultContent` in warble's `dispatcher/claude-agent-sdk/src/events.ts` (read directly,
 * not guessed) — `truncate(<raw stdout text, or joined text blocks, or JSON.stringify fallback>)`,
 * with NO `"Exit code: N"` wrapping anywhere in that function. That reading is what grounds this
 * file's claims about dispatched's `detail` shape for a SUCCESSFUL dispatched result; it is not a
 * cassette-backed fact for the remaining synthetic constructions below (AC2's truncated-summary
 * setup, and AC4's guardrail-denial input, which has no recording — see that test's own comment
 * for why). The FAILURE shape is no longer a guess: AC3 and the dedicated dispatcher-contract
 * test below it, and AC9 at the bottom, all replay a real recorded cassette through the real
 * `parseWarbleChatEventLine` / `mapChatEventToAgentEvent` mapper rather than hand-shaping a
 * `tool_result`.
 *
 * ## What changed here (the fix this file now documents)
 *
 * `classifyRecordedSchemaDiscovery`/`classifyRecordedContextLifecycle` used to require a
 * structured `exitCode` regexed out of `ToolStep.detail` (`execExitCode`, since replaced) before
 * counting any command as successful. Dispatched's `detail` never carries that shape — it's the
 * command's raw, 240-char-truncated stdout — so a genuinely successful dispatched discovery command
 * could never satisfy the gate; see `harness/setup/runner.ts`'s `execSucceeded` doc comment for the
 * full account. The fix reads the *structured* `ToolStep.state` that `LiveWorkLog.ingest` already
 * derives from the event's own `status` field at fold time (`server/fold.ts`), for `Bash`-labeled
 * (dispatched) entries specifically — in-process/Codex-local entries still trust only the structured exit
 * code folded into `detail`, unchanged. The first test below is the direct regression proof: it now
 * asserts the OPPOSITE outcome from before the fix, on the exact same synthetic input.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LiveWorkLog } from "../server/fold.js";
import { classifyRecordedSchemaDiscovery, parseSetupTerminal } from "../harness/setup/runner.js";
import type { SetupTerminalContext } from "../harness/setup/runner.js";
import type { AgentEvent } from "../harness/events/types.js";
import { createAgentEventEmitter } from "../harness/events/index.js";
import { createChatEventMapperState, mapChatEventToAgentEvent, parseWarbleChatEventLine } from "../harness/route/chat-event-mapper.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function makeContext(name: string): SetupTerminalContext {
  const root = mkdtempSync(path.join(tmpdir(), "wren-harness-fold-to-setup-terminal-"));
  return { root, name };
}

function scaffold(context: SetupTerminalContext): void {
  mkdirSync(path.join(context.root, context.name), { recursive: true });
  writeFileSync(path.join(context.root, context.name, "wren_project.yml"), "name: test\n");
}

function writeMdl(context: SetupTerminalContext, modelNames: readonly string[], measureCount = 0): void {
  const targetDir = path.join(context.root, context.name, "target");
  mkdirSync(targetDir, { recursive: true });
  const mdl = {
    catalog: "wren",
    schema: "public",
    models: modelNames.map((name) => ({ name })),
    relationships: [],
    views: [],
    cubes:
      measureCount > 0
        ? [
            {
              name: "metrics",
              baseObject: modelNames[0] ?? "missing_model",
              measures: Array.from({ length: measureCount }, (_, index) => ({ name: `measure_${index}`, expression: "COUNT(*)" })),
            },
          ]
        : [],
  };
  writeFileSync(path.join(targetDir, "mdl.json"), JSON.stringify(mdl));
}

/**
 * Builds the real `tool.call` + `tool.result` `AgentEvent` pair a dispatched Bash invocation
 * produces, per `harness/events/types.ts`'s `ToolCallEvent`/`ToolResultEvent`. `summary` is the
 * plain (truncated) content a real dispatcher would report — see this file's doc comment for
 * where that shape was checked. `ok` defaults to `true`; pass `false` to model a genuine command
 * failure OR a blocked/guardrail-denied execution — both collapse to the same wire shape
 * (`status: "error"`) from this harness's point of view, which is exactly the fact Defect 4's fix
 * relies on (see `execSucceeded`'s doc comment in `harness/setup/runner.ts`).
 */
function bashCallAndResult(
  seqBase: number,
  callId: string,
  command: string,
  summary: string,
  options?: { readonly ok?: boolean; readonly error?: string },
): AgentEvent[] {
  const ok = options?.ok ?? true;
  return [
    {
      runId: "run-1",
      seq: seqBase,
      kind: "tool.call",
      stepId: "step-1",
      callId,
      tool: "Bash",
      input: { command },
      depth: 0,
      status: "running",
    },
    {
      runId: "run-1",
      seq: seqBase + 1,
      kind: "tool.result",
      stepId: "step-1",
      callId,
      tool: "Bash",
      status: ok ? "success" : "error",
      ...(ok ? { summary } : { error: options?.error ?? summary }),
    },
  ];
}

function foldEvents(events: readonly AgentEvent[]): ReturnType<LiveWorkLog["snapshot"]> {
  const workLog = new LiveWorkLog();
  let worklog: ReturnType<LiveWorkLog["snapshot"]> = [];
  for (const event of events) {
    const snapshot = workLog.ingest(event);
    if (snapshot !== undefined) worklog = snapshot;
  }
  return worklog;
}

/**
 * Replays one recorded dispatcher cassette (`test/fixtures/cassettes/<name>.ndjson`) through the
 * REAL dispatched mapper — `parseWarbleChatEventLine` -> `mapChatEventToAgentEvent` -> a real
 * `AgentEventEmitter` — exactly as the AC9 test at the bottom of this file does inline. Extracted
 * here only for the two cassette-driven tests that follow it; AC9 itself is left exactly as
 * written (it is not in scope for this change) rather than migrated onto this helper.
 *
 * Returns the live `emitter` (not just the collected `events`) so a caller that needs to extend a
 * recorded turn with additional, clearly-synthetic events can `emit` them onto the SAME run,
 * keeping `runId` and the monotonic `seq` counter consistent with the recording they follow.
 */
function replayCassette(name: string): {
  readonly emitter: ReturnType<typeof createAgentEventEmitter>;
  readonly events: AgentEvent[];
  readonly finalAnswerText: string | undefined;
} {
  const cassettePath = path.join(__dirname, "fixtures", "cassettes", `${name}.ndjson`);
  const raw = readFileSync(cassettePath, "utf8");
  const lines = raw.split("\n").filter((line) => line.trim().length > 0);

  const events: AgentEvent[] = [];
  const emitter = createAgentEventEmitter((event) => events.push(event));
  const mapperState = createChatEventMapperState();
  let finalAnswerText: string | undefined;
  for (const line of lines) {
    const parsed = parseWarbleChatEventLine(line);
    if (parsed === undefined) continue;
    if (parsed.t === "answer") {
      finalAnswerText = parsed.text;
      continue;
    }
    const mapped = mapChatEventToAgentEvent(parsed, mapperState);
    if (mapped !== undefined) emitter.emit(mapped);
  }
  return { emitter, events, finalAnswerText };
}

describe("fold-to-gate integration: real LiveWorkLog output through the real setup terminal gate", () => {
  it("AC1: a dispatched turn with successful, allowlist-matching discovery now passes the gate", () => {
    // Three Bash calls mirroring the setup flow's discovery -> validate -> build sequence. Each
    // `summary` is plain content, exactly the shape `summarizeResultContent` (warble's
    // claude-agent-sdk mapper) actually produces for a Bash tool_result today — no "Exit code: N"
    // wrapper, because the commands below never print that text themselves.
    const events: AgentEvent[] = [
      ...bashCallAndResult(1, "call-1", 'wren --sql "SELECT table_name FROM information_schema.tables" -o json', '[{"table_name":"customers"}]'),
      ...bashCallAndResult(3, "call-2", "wren context validate", "validated"),
      ...bashCallAndResult(5, "call-3", "wren context build", "built"),
    ];

    const worklog = foldEvents(events);

    // Sanity check on the intermediate real artifact this test is about: fold really did produce
    // plain, unwrapped detail strings, not a fabricated "Exit code: 0..." shape, AND a structured
    // `state` field the gate now reads directly.
    expect(worklog).toHaveLength(3);
    for (const step of worklog) {
      expect(step.label).toBe("Bash");
      expect(step.detail).not.toMatch(/exit\s+code/i);
      expect(step.state).toBe("done");
    }
    expect(worklog[0]?.detail).toBe('[{"table_name":"customers"}]');
    expect(worklog[1]?.detail).toBe("validated");
    expect(worklog[2]?.detail).toBe("built");

    const context: SetupTerminalContext = { ...makeContext("acme"), stepKey: "context", worklog };
    scaffold(context);
    writeMdl(context, ["customers"], 1);

    const result = parseSetupTerminal("SETUP_STATUS: ok - built MDL with 1 model and 1 measure", context);

    // THE FIX, DEMONSTRATED: the gate now trusts `ToolStep.state` (folded from the event's own
    // `status`) for Bash-labeled entries, so this genuinely-successful discovery -> validate ->
    // build sequence is accepted. Before the fix this asserted `status: "error"` /
    // `kind: "host_contract"` — see this file's header comment for why that was a structural,
    // not incidental, rejection. If this ever regresses back to "error", that is exactly the
    // signal this test exists to catch.
    expect(result.status).toBe("ok");
  });

  it("AC2: the discovery signal survives detail truncated to the real 240-char cap, because it no longer lives in detail", () => {
    // Dispatched's `detail` is the command's raw stdout truncated to 240 chars by warble's own mapper
    // before this harness ever sees it (see this file's header comment). Simulate that cap exactly
    // — a `summary` already truncated to 240 chars, the way it would arrive over the wire — and
    // confirm success still comes through, because the gate now derives success from the folded
    // `state` field, never from parsing `detail` text.
    const truncated = "x".repeat(240);
    expect(truncated).toHaveLength(240);
    const events: AgentEvent[] = [
      ...bashCallAndResult(1, "call-1", 'wren --sql "SELECT table_name FROM information_schema.tables" -o json', truncated),
      ...bashCallAndResult(3, "call-2", "wren context validate", "validated"),
      ...bashCallAndResult(5, "call-3", "wren context build", "built"),
    ];

    const worklog = foldEvents(events);
    expect(worklog[0]?.detail).toHaveLength(240);
    expect(worklog[0]?.state).toBe("done");

    const context: SetupTerminalContext = { ...makeContext("acme-truncated"), stepKey: "context", worklog };
    scaffold(context);
    writeMdl(context, ["customers"], 1);

    const result = parseSetupTerminal("SETUP_STATUS: ok - built MDL with 1 model and 1 measure", context);
    expect(result.status).toBe("ok");
  });

  it("AC3 (real cassette): a genuinely failing dispatched discovery command, replayed through the REAL mapper, is classified failed, and the gate still reports context_schema_discovery_failed", () => {
    // `test/fixtures/cassettes/chat__build_context__discovery-failed.ndjson` is a real recording of
    // a dispatched build_context turn against a project the CLI itself refuses to query because
    // `target/mdl.json` is missing: the agent's one allowlist-matching discovery command (`wren
    // --sql ... information_schema.tables ...`) genuinely exits 1. This is the exact recording that
    // settled the independent reviewer's blocking concern on this fix (see this file's header, and
    // the dedicated dispatcher-contract test right after this one): a non-blocked, nonzero-exit Bash
    // command comes back as `{"t":"tool_result","ok":false,"error":"Exit code 1\n..."}`, never
    // `ok:true`. Previously this test hand-built that exact `ok:false`/`error:` shape as a literal;
    // the failing-discovery half below is now driven from the recording itself, through the same
    // real mapper -> emitter -> fold pipeline the AC9 test at the bottom of this file uses — no
    // hand-shaped `tool_result` for that half.
    const { emitter, events: recordedEvents, finalAnswerText } = replayCassette("chat__build_context__discovery-failed");
    // `finalAnswerText` is the agent's own prose answer (the `answer` line), not the raw tool
    // error — it mentions the failure in its own words ("The command failed with exit code 1"),
    // so this only sanity-checks that a final answer was recorded at all; the raw `error:` text
    // ("Exit code 1\n...") is asserted below, straight off the folded `ToolStep.detail`.
    expect(finalAnswerText).toBeDefined();
    expect(finalAnswerText).toMatch(/exit code 1/i);

    const discoveryOnlyWorklog = foldEvents(recordedEvents);
    const recordedBashSteps = discoveryOnlyWorklog.filter((step) => step.label === "Bash");
    expect(recordedBashSteps).toHaveLength(1);
    expect(recordedBashSteps[0]?.state).toBe("error");
    expect(recordedBashSteps[0]?.detail).toContain("Exit code 1");

    // Direct classifier-level proof, on the real recorded worklog alone — no synthetic events
    // anywhere in this assertion.
    expect(classifyRecordedSchemaDiscovery(discoveryOnlyWorklog)).toMatchObject({
      kind: "failed",
      command: 'wren --sql "SELECT table_name FROM information_schema.tables" -o json',
    });

    // The recording is a single turn that stops after the one failed command, so there is no
    // recording of an agent proceeding to validate/build regardless — but that continuation is a
    // realistic sequence this test still needs to exercise: `classifyRecordedContextLifecycle`
    // treats a worklog containing ONLY the failed discovery attempt as "missing_discovery" (nothing
    // ever ran after it), which routes the gate to the generic `context_schema_discovery_missing`
    // diagnostic, not the more specific `context_schema_discovery_failed` one this test is about —
    // that more specific diagnostic exists precisely for the case where the agent pressed on and
    // validate/build ran anyway (see `classifyRecordedContextLifecycle`'s "out_of_order" branch and
    // `parseSetupTerminal`'s use of it). These two follow-on calls remain SYNTHETIC — emitted onto
    // the SAME run (`emitter`, continuing its `runId`/`seq` from the recording) rather than replayed
    // from a cassette, because no recording of this exact turn continuing past the failure exists.
    emitter.emit({ kind: "tool.call", stepId: "step-1", callId: "call-validate", tool: "Bash", input: { command: "wren context validate" }, depth: 0, status: "running" });
    emitter.emit({ kind: "tool.result", stepId: "step-1", callId: "call-validate", tool: "Bash", status: "success", summary: "validated" });
    emitter.emit({ kind: "tool.call", stepId: "step-1", callId: "call-build", tool: "Bash", input: { command: "wren context build" }, depth: 0, status: "running" });
    emitter.emit({ kind: "tool.result", stepId: "step-1", callId: "call-build", tool: "Bash", status: "success", summary: "built" });

    const worklog = foldEvents(recordedEvents);
    const context: SetupTerminalContext = { ...makeContext("acme-real-failed-discovery"), stepKey: "context", worklog };
    scaffold(context);
    writeMdl(context, ["customers"], 1);

    const result = parseSetupTerminal("SETUP_STATUS: ok - built MDL with 1 model and 1 measure", context);
    expect(result.status).toBe("error");
    expect(result.diagnostic).toMatchObject({ kind: "host_contract", code: "context_schema_discovery_failed" });
  });

  it("dispatcher contract (regression pin): a real recorded nonzero-exit Bash result maps to a non-successful outcome, so it cannot satisfy the discovery gate", () => {
    // This pins a fact about the DISPATCHER this harness ships — warble's claude-agent-sdk
    // dispatcher (`dispatcher/claude-agent-sdk/src/events.ts` in the warble repo) — NOT a guarantee
    // documented by Anthropic's own Bash-tool docs. Those docs describe `is_error` only for
    // invocation-level failures (e.g. a blocked/denied command), leaving open whether a command
    // that ran and merely exited nonzero might come back reported as `is_error: false`. An
    // independent reviewer raised exactly that gap as a blocking concern on `execSucceeded`
    // (`harness/setup/runner.ts`), which trusts a dispatched (`Bash`) entry's folded `state` — "done"
    // for success, "error" for anything else — as the ONLY signal available for that mode (there is
    // no structured exit code in dispatched's `detail`; see `execSucceeded`'s own doc comment). It was
    // settled with one live dispatcher invocation against a project with an unreachable/unbuilt data
    // source, recorded at `test/fixtures/cassettes/chat__build_context__discovery-failed.ndjson`.
    //
    // This test replays that exact recording and pins the resulting relationship so a FUTURE change
    // to the dispatcher's own `ok` semantics — e.g. if it ever started reporting a genuine command
    // failure as `ok:true` — breaks a test here, rather than silently letting a failed discovery
    // command satisfy the gate again.
    const { events } = replayCassette("chat__build_context__discovery-failed");
    const worklog = foldEvents(events);
    const bashSteps = worklog.filter((step) => step.label === "Bash");
    expect(bashSteps).toHaveLength(1);

    // recorded ok:false -> folded state "error" (never "done") -> `execSucceeded` returns `false`
    // (never `true`) for dispatched -> the discovery-allowlist match this command satisfies is
    // classified "failed", never "successful". If the dispatcher ever reported this same real
    // failure as `ok:true`, `state` below would flip to "done" and this assertion would fail.
    expect(bashSteps[0]?.state).toBe("error");
    expect(bashSteps[0]?.state).not.toBe("done");
    expect(classifyRecordedSchemaDiscovery(worklog).kind).toBe("failed");
    expect(classifyRecordedSchemaDiscovery(worklog).kind).not.toBe("successful");
  });

  it("AC4 (SYNTHETIC — no recording exists for this scenario): a blocked/guardrail-denied dispatched execution never counts as successful discovery", () => {
    // Unlike AC3 above, this input is still hand-constructed: capturing a real guardrail/denylist
    // rejection would require a live dispatcher invocation against a command the setup denylist
    // actually blocks (`harness/tools/setup-native.ts`'s in-process denylist, or its dispatched analogue),
    // and no such recording was made in the packet that settled AC3's cassette — only the
    // genuine-command-failure case (a project whose data source was unreachable) was probed live.
    // So this test keeps constructing its `ok:false`/`error:` input by hand, same as before.
    //
    // A guardrail denial and a genuine command failure are wire-indistinguishable in this harness's
    // own vocabulary — both are just `AgentEvent.status: "error"` on the tool.result (see
    // `execSucceeded`'s doc comment). This test's point is exactly that indistinguishability: no
    // matter which one actually happened, the outcome must be the same — never "successful". AC3's
    // real recording above already proves the genuine-failure half of that claim; this test covers
    // the denial half the only way available without a live probe against a denylisted command.
    const events: AgentEvent[] = bashCallAndResult(
      1,
      "call-1",
      'wren --sql "SELECT table_name FROM information_schema.tables" -o json',
      "",
      { ok: false, error: "Bash command blocked by policy: command matches the setup denylist" },
    );

    const worklog = foldEvents(events);
    expect(worklog[0]?.state).toBe("error");

    const discovery = classifyRecordedSchemaDiscovery(worklog);
    expect(discovery.kind).not.toBe("successful");
    expect(discovery.kind).toBe("failed");
  });

  it("AC9 (real cassette): the recorded already-built retry turn, replayed through the REAL dispatched NDJSON mapper, has no discovery evidence — confirming Defect 2's premise on a real recording, not a synthetic guess", () => {
    // `test/fixtures/cassettes/chat__build_context__already-built.ndjson` is a real recording of a
    // Dispatched dispatcher turn against a project whose earlier attempt had already succeeded: the
    // agent re-validates, finds `target/mdl.json` already built, inspects the existing project
    // files, runs one cross-model row-count query, and reports `SETUP_STATUS: error` — hedging about
    // an unrelated host SDK version mismatch. None of its five Bash commands match the
    // schema-discovery allowlist (`wren context validate`/`build`, a `test -f ... || wren context
    // build` guard, `cat`/`ls`, and a plain row-count query — no `information_schema` or equivalent
    // evidence anywhere). This test replays that EXACT recording through the real
    // `parseWarbleChatEventLine`/`mapChatEventToAgentEvent` mapper (`harness/route/chat-event-mapper.ts`)
    // — not through hand-built `AgentEvent`s — into the real `LiveWorkLog`, to prove that reading
    // holds on the real wire shape, not just on this file's own synthetic constructions elsewhere.
    //
    // This cassette's own outcome is NOT the thing Defect 2 changes: because the agent's final line
    // is `SETUP_STATUS: error` (not `ok`), the `context` step's "ok" discovery gate never even runs
    // against it, and the message doesn't claim a zero-table/model outcome, so `parseSetupTerminal`
    // passes the agent's own error message through unchanged — this recording predates the fix, and
    // by design a single already-recorded turn can't retroactively gain discovery evidence it never
    // ran. Defect 2's actual fix (`composeExplicitCorrectiveRetry` in `server/app.ts`) acts on the
    // NEXT turn's prompt, mandating a fresh discovery command regardless of how "already built" the
    // project looks — this test's job is only to establish, from the real recording, that this
    // turn's worklog genuinely has zero discovery evidence, which is exactly the situation that
    // retry-prompt fix exists to prevent from recurring.
    const cassettePath = path.join(__dirname, "fixtures", "cassettes", "chat__build_context__already-built.ndjson");
    const raw = readFileSync(cassettePath, "utf8");
    const lines = raw.split("\n").filter((line) => line.trim().length > 0);

    const events: AgentEvent[] = [];
    const emitter = createAgentEventEmitter((event) => events.push(event));
    const mapperState = createChatEventMapperState();
    let finalAnswerText: string | undefined;
    for (const line of lines) {
      const parsed = parseWarbleChatEventLine(line);
      if (parsed === undefined) continue;
      if (parsed.t === "answer") {
        finalAnswerText = parsed.text;
        continue;
      }
      const mapped = mapChatEventToAgentEvent(parsed, mapperState);
      if (mapped !== undefined) emitter.emit(mapped);
    }

    expect(finalAnswerText).toBeDefined();
    expect(finalAnswerText).toContain("SETUP_STATUS: error");

    const worklog = foldEvents(events);
    // Five real Bash calls, all recorded as having succeeded (`ok: true` in the cassette), plus the
    // one enclosing `build_context` step entry the real mapper's `step_start`/`step_finish` pair
    // also folds in — confirming the real mapper + fold pipeline produces a `state: "done"` worklog
    // here, exactly the shape `execSucceeded` now trusts for dispatched.
    const bashSteps = worklog.filter((step) => step.label === "Bash");
    expect(bashSteps).toHaveLength(5);
    for (const step of bashSteps) {
      expect(step.state).toBe("done");
    }

    // The premise Defect 2 responds to, proven against the real recording: none of these five
    // commands is recognized schema-discovery evidence.
    expect(classifyRecordedSchemaDiscovery(worklog)).toMatchObject({ kind: "none" });

    const context: SetupTerminalContext = { ...makeContext("acme-already-built"), stepKey: "context", worklog };
    scaffold(context);
    writeMdl(context, ["customers", "orders", "raw_customers", "raw_orders", "raw_payments"]);

    const result = parseSetupTerminal(finalAnswerText!, context);
    // The agent's own SETUP_STATUS: error is passed through unreframed here — this turn's message
    // doesn't claim a zero-table/model outcome, and none of its recorded commands failed, so
    // `parseSetupTerminal`'s reframing branches don't apply. That's the correct behavior for THIS
    // turn; it is the NEXT turn's composed prompt (Defect 2, not this classifier) that has to make
    // sure a retry against an already-built project still re-runs discovery.
    //
    // `parseSetupTerminal` only extracts the text AFTER "SETUP_STATUS: error - " on the terminal
    // line itself (`SETUP_STATUS_LINE`'s own capture group), not the whole multi-paragraph answer —
    // derive that same substring from the real answer text rather than hand-typing it, so this
    // assertion stays anchored to the actual cassette content.
    const lastLine = finalAnswerText!.trim().split("\n").pop()!;
    const expectedMessage = lastLine.replace(/^SETUP_STATUS:\s*error\s*[-:]?\s*/i, "");
    expect(result.status).toBe("error");
    expect(result.message).toBe(expectedMessage);
  });
});
