import { describe, expect, it } from "vitest";
import { foldTrace, LiveWorkLog, sanitizeLiveSetupWorklog, sanitizePublicSetupWorklog } from "../server/fold.js";
import type { AgentEvent, StepTrace } from "../harness/index.js";
import type { ToolStep } from "../server/wire-types.js";

/**
 * `foldTrace` (floor path) and `LiveWorkLog` (live path) must both
 * carry a `TraceStep`/`AgentEvent`'s `input`/`detail` (or `summary`/`error`)
 * onto the produced `ToolStep`, so the UI's work log can expand a step to
 * show what a tool call ran and what happened. The collapsed fields
 * (id/label/state/kind/depth) must stay exactly as before.
 */
describe("foldTrace (floor path): carries input/detail onto ToolStep", () => {
  it("carries a success step's input and detail through untouched", () => {
    const trace: StepTrace = {
      steps: [
        {
          id: "call-1",
          tool: "query",
          outcome: "success",
          ordinal: 0,
          input: { sql: "select * from customers" },
          detail: "3 rows",
        },
      ],
    };

    expect(foldTrace(trace)).toEqual([
      { id: "call-1", label: "query", state: "done", kind: "tool", input: { sql: "select * from customers" }, detail: "3 rows" },
    ]);
  });

  it("carries an error step's input and detail (the error message) through untouched", () => {
    const trace: StepTrace = {
      steps: [
        {
          id: "call-1",
          tool: "query",
          outcome: "error",
          ordinal: 0,
          input: { sql: "select * from bogus_table" },
          detail: 'relation "bogus_table" does not exist',
        },
      ],
    };

    expect(foldTrace(trace)).toEqual([
      {
        id: "call-1",
        label: "query",
        state: "error",
        kind: "tool",
        input: { sql: "select * from bogus_table" },
        detail: 'relation "bogus_table" does not exist',
      },
    ]);
  });

  it("omits input/detail entirely when the TraceStep has neither (backward compatible)", () => {
    const trace: StepTrace = { steps: [{ id: "call-1", tool: "query", outcome: "success", ordinal: 0 }] };

    const [step] = foldTrace(trace);
    expect(step).toEqual({ id: "call-1", label: "query", state: "done", kind: "tool" });
    expect(step).not.toHaveProperty("input");
    expect(step).not.toHaveProperty("detail");
  });
});

describe("sanitizePublicSetupWorklog: builds a bounded inspection projection", () => {
  it("redacts an id/label/detail that look like a session anchor or resume key, without a known value to match against", () => {
    const worklog: ToolStep[] = [
      {
        id: "resume_session_id: sess_live_abc123",
        label: 'sdk_session_id="sess_live_abc123"',
        state: "running",
        kind: "tool",
        detail: "anchor: sess_live_abc123 established",
      },
    ];

    const [step] = sanitizePublicSetupWorklog(worklog);
    const serialized = JSON.stringify(step);
    expect(serialized).not.toContain("sess_live_abc123");
    expect(step!.id).toContain("[REDACTED]");
    expect(step!.label).toContain("[REDACTED]");
    expect(step!.inspection?.output).toContain("[REDACTED]");
    expect(step).not.toHaveProperty("input");
    expect(step).not.toHaveProperty("detail");
  });

  it("redacts a provider name embedded in a label or detail", () => {
    const worklog: ToolStep[] = [
      { id: "call-1", label: "invoking codex runner", state: "done", kind: "tool", detail: "anthropic session established" },
    ];

    const [step] = sanitizePublicSetupWorklog(worklog);
    expect(step!.label).not.toContain("codex");
    expect(step!.inspection?.output).not.toContain("anthropic");
  });

  it("keeps only a sanitized command/action summary, bounded output, and safe duration", () => {
    const longOutput = "result ".repeat(200);
    const worklog: ToolStep[] = [
      {
        id: "call-1",
        label: "setup_execution",
        state: "done",
        kind: "tool",
        input: { command: "cd /Users/example/private-project && wren context build PASSWORD=secret" },
        detail: `${longOutput} /private/tmp/diagnostic PASSWORD=secret`,
        durationMs: 1_250,
      } as ToolStep & { durationMs: number },
    ];

    const [step] = sanitizePublicSetupWorklog(worklog);
    expect(step).toMatchObject({
      id: "call-1",
      label: "setup_execution",
      inspection: {
        action: expect.stringContaining("[REDACTED_PATH]"),
        durationMs: 1_250,
      },
    });
    expect(step!.inspection?.action).not.toContain("secret");
    expect(step!.inspection?.output).not.toContain("/private/tmp/diagnostic");
    expect(step!.inspection?.output).not.toContain("secret");
    expect(step!.inspection?.output?.length).toBeLessThanOrEqual(512);
    expect(step).not.toHaveProperty("input");
    expect(step).not.toHaveProperty("detail");
  });

  it("puts actionable details on the error field for failed rows", () => {
    const [step] = sanitizePublicSetupWorklog([
      { id: "call-1", label: "setup_execution", state: "error", kind: "tool", detail: "connection refused; retry after checking the host" },
    ]);

    expect(step!.inspection).toEqual({ error: "connection refused; retry after checking the host" });
    expect(step).not.toHaveProperty("detail");
  });

  it("preserves an already-sanitized inspection through recovery sanitization without restoring raw fields", () => {
    const persisted = sanitizePublicSetupWorklog([
      {
        id: "call-1",
        label: "setup_execution",
        state: "done",
        kind: "tool",
        input: { command: "wren context build" },
        detail: "Built 3 models.",
      },
    ]);
    const [recovered] = sanitizePublicSetupWorklog(persisted);

    expect(recovered).toEqual({
      id: "call-1",
      label: "setup_execution",
      state: "done",
      kind: "tool",
      inspection: { action: "wren context build", output: "Built 3 models." },
    });
    expect(recovered).not.toHaveProperty("input");
    expect(recovered).not.toHaveProperty("detail");
  });

  it("strictly formats every runtime-controlled field before persistence", () => {
    const secrets = ["equals-secret", "colon-secret", "json-secret", "flag-secret", "shell-secret", "user-secret"];
    const paths = ["/etc/private-config", "/opt/company/private", "C:\\Users\\private\\config"];
    const longEmoji = "😀".repeat(600);
    const [step] = sanitizePublicSetupWorklog([{
      id: `\u001b[31m${longEmoji}`,
      label: `https://example.test/private?token=url-secret ${longEmoji}`,
      parent: `/etc/private-parent ${longEmoji}`,
      state: "error",
      kind: "tool",
      input: {
        command: `curl https://user:url-secret@example.test/private --password=${secrets[0]} password: ${secrets[1]} \"password\":\"${secrets[2]}\" --token ${secrets[3]} SECRET ${secrets[4]} --user user:${secrets[5]} ${paths.join(" ")}`,
      },
      detail: `\u001b[2Kfailure ${paths.join(" ")} ${longEmoji}`,
    }]);

    const serialized = JSON.stringify(step);
    for (const unsafe of [...secrets, ...paths, "url-secret", "https://example.test", "\u001b"]) {
      expect(serialized).not.toContain(unsafe);
    }
    expect(step).toMatchObject({
      id: expect.stringContaining("…"),
      label: expect.stringContaining("[REDACTED_URL]"),
      parent: expect.stringContaining("[REDACTED_PATH]"),
      inspection: {
        action: expect.stringContaining("[REDACTED_URL]"),
        error: expect.stringContaining("[REDACTED_PATH]"),
      },
    });
    for (const field of [step!.id, step!.label, step!.parent!, step!.inspection!.action!, step!.inspection!.error!]) {
      expect(field).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
      expect(field).not.toMatch(/[\ud800-\udbff]$/);
    }
    expect(Array.from(step!.id).length).toBeLessThanOrEqual(160);
    expect(Array.from(step!.label).length).toBeLessThanOrEqual(160);
    expect(Array.from(step!.parent!).length).toBeLessThanOrEqual(160);
    expect(Array.from(step!.inspection!.action!).length).toBeLessThanOrEqual(512);
    expect(Array.from(step!.inspection!.error!).length).toBeLessThanOrEqual(512);
  });

  it("redacts escaped JSON credentials in every public work-log field", () => {
    const secrets = ["escaped-password", "double-token", "nested-api-key"] as const;
    const [passwordSecret, tokenSecret, apiKeySecret] = secrets;
    const escapedJson = (depth: number, key: string, secret: string) => {
      const slash = "\\".repeat(depth);
      return `{${slash}"${key}${slash}":${slash}"${secret}${slash}"}`;
    };
    const [step] = sanitizePublicSetupWorklog([{
      id: `call ${escapedJson(1, "password", passwordSecret)}`,
      label: `tool ${escapedJson(2, "token", tokenSecret)}`,
      parent: `parent ${escapedJson(4, "apiKey", apiKeySecret)}`,
      state: "error",
      kind: "tool",
      input: { command: `run ${escapedJson(1, "api_key", apiKeySecret)}` },
      inspection: { error: `failed ${escapedJson(2, "PASSWORD", passwordSecret)} ${escapedJson(4, "TOKEN", tokenSecret)}` },
    }]);

    const serialized = JSON.stringify(step);
    for (const secret of secrets) expect(serialized).not.toContain(secret);
    expect(step).toMatchObject({
      id: expect.stringContaining("password=[REDACTED]"),
      label: expect.stringContaining("token=[REDACTED]"),
      parent: expect.stringContaining("apiKey=[REDACTED]"),
      inspection: {
        action: expect.stringContaining("api_key=[REDACTED]"),
        error: expect.stringContaining("PASSWORD=[REDACTED]"),
      },
    });
  });
});

describe("sanitizeLiveSetupWorklog (live path): shape-redacts, then drops input/detail outright", () => {
  it("drops input and detail entirely, even when neither looks anchor- or provider-shaped", () => {
    const worklog: ToolStep[] = [
      { id: "call-1", label: "query", state: "running", kind: "tool", depth: 0, input: { sql: "select 1" }, detail: "3 rows" },
    ];

    const [step] = sanitizeLiveSetupWorklog(worklog);
    expect(step).toEqual({ id: "call-1", label: "query", state: "running", kind: "tool", depth: 0 });
    expect(step).not.toHaveProperty("input");
    expect(step).not.toHaveProperty("detail");
    expect(step).not.toHaveProperty("inspection");
  });

  it("scrubs a bare session anchor value that hides in detail text with no key-shaped context (no pattern could catch it if it weren't dropped outright)", () => {
    // A tool's free-text summary can echo a bare anchor value with no surrounding
    // `key: value` shape at all (e.g. "resumed sess_live_abc123 successfully") —
    // SETUP_INTERNAL_DIAGNOSTIC only matches key-shaped occurrences, so this exact
    // case is the one by-shape redaction alone cannot catch. Dropping detail/input
    // outright is what actually closes it for the live path.
    const worklog: ToolStep[] = [
      { id: "call-1", label: "setup_execution", state: "done", kind: "tool", detail: "resumed sess_live_abc123 successfully" },
    ];

    const [step] = sanitizeLiveSetupWorklog(worklog);
    expect(JSON.stringify(step)).not.toContain("sess_live_abc123");
    expect(step).not.toHaveProperty("detail");
    expect(step).not.toHaveProperty("inspection");
  });

  it("still shape-redacts id/label (the fields it keeps) in addition to dropping input/detail", () => {
    const worklog: ToolStep[] = [
      { id: "call-1", label: "invoking anthropic provider", state: "running", kind: "tool", input: { anchor: "sess_live_abc123" }, detail: "anchor: sess_live_abc123" },
    ];

    const [step] = sanitizeLiveSetupWorklog(worklog);
    expect(step!.label).not.toContain("anthropic");
    expect(step).not.toHaveProperty("input");
    expect(step).not.toHaveProperty("detail");
    expect(step).not.toHaveProperty("inspection");
  });

  it("never leaks either side of an anchor rotation: pre-rotation and post-rotation snapshots both come out scrubbed", () => {
    // Simulates a subscription attempt rotating from one SDK session anchor to
    // another mid-turn (e.g. the terminal-contract correction path retrying with
    // a fresh session). Each snapshot is sanitized independently by the live
    // path — neither the old nor the new anchor value should ever survive.
    const preRotation: ToolStep[] = [
      { id: "call-1", label: "setup_execution", state: "running", kind: "tool", detail: "sdk_session_id: sess_live_before999" },
    ];
    const postRotation: ToolStep[] = [
      { id: "call-1", label: "setup_execution", state: "running", kind: "tool", detail: "sdk_session_id: sess_live_before999" },
      { id: "call-2", label: "setup_execution", state: "running", kind: "tool", detail: "sdk_session_id: sess_live_after111" },
    ];

    const before = sanitizeLiveSetupWorklog(preRotation);
    const after = sanitizeLiveSetupWorklog(postRotation);

    expect(JSON.stringify(before)).not.toContain("sess_live_before999");
    expect(JSON.stringify(after)).not.toContain("sess_live_before999");
    expect(JSON.stringify(after)).not.toContain("sess_live_after111");
    for (const frame of [...before, ...after]) {
      expect(frame).not.toHaveProperty("detail");
      expect(frame).not.toHaveProperty("input");
      expect(frame).not.toHaveProperty("inspection");
    }
  });
});

describe("LiveWorkLog (live path): captures input from tool.call and detail from tool.result", () => {
  it("captures input at tool.call time, then success detail (summary) at tool.result time", () => {
    const log = new LiveWorkLog();

    log.ingest({
      kind: "tool.call",
      runId: "r",
      seq: 1,
      stepId: "generate_sql",
      callId: "call-1",
      tool: "query",
      input: { sql: "select * from customers" },
      depth: 0,
      status: "running",
    } as AgentEvent);

    let snapshot = log.snapshot();
    expect(snapshot).toEqual([
      { id: "call-1", label: "query", state: "running", kind: "tool", depth: 0, input: { sql: "select * from customers" } },
    ]);

    log.ingest({
      kind: "tool.result",
      runId: "r",
      seq: 2,
      stepId: "generate_sql",
      callId: "call-1",
      tool: "query",
      status: "success",
      summary: "3 rows",
    } as AgentEvent);

    snapshot = log.snapshot();
    expect(snapshot).toEqual([
      { id: "call-1", label: "query", state: "done", kind: "tool", depth: 0, input: { sql: "select * from customers" }, detail: "3 rows" },
    ]);
  });

  it("captures the error message as detail when tool.result reports status: error", () => {
    const log = new LiveWorkLog();

    log.ingest({
      kind: "tool.call",
      runId: "r",
      seq: 1,
      stepId: "generate_sql",
      callId: "call-1",
      tool: "query",
      input: { sql: "select * from bogus_table" },
      depth: 0,
      status: "running",
    } as AgentEvent);

    log.ingest({
      kind: "tool.result",
      runId: "r",
      seq: 2,
      stepId: "generate_sql",
      callId: "call-1",
      tool: "query",
      status: "error",
      error: 'relation "bogus_table" does not exist',
    } as AgentEvent);

    expect(log.snapshot()).toEqual([
      {
        id: "call-1",
        label: "query",
        state: "error",
        kind: "tool",
        depth: 0,
        input: { sql: "select * from bogus_table" },
        detail: 'relation "bogus_table" does not exist',
      },
    ]);
  });

  it("leaves detail unset when tool.call has no input and tool.result has no summary/error (backward compatible)", () => {
    const log = new LiveWorkLog();

    log.ingest({
      kind: "tool.call",
      runId: "r",
      seq: 1,
      stepId: "s1",
      callId: "call-1",
      tool: "write_artifact",
      depth: 0,
      status: "running",
    } as AgentEvent);

    log.ingest({
      kind: "tool.result",
      runId: "r",
      seq: 2,
      stepId: "s1",
      callId: "call-1",
      tool: "write_artifact",
      status: "success",
    } as AgentEvent);

    const [step] = log.snapshot();
    expect(step).toEqual({ id: "call-1", label: "write_artifact", state: "done", kind: "tool", depth: 0 });
    expect(step).not.toHaveProperty("input");
    expect(step).not.toHaveProperty("detail");
  });

  it("step.start produces kind \"step\" (not \"subagent\" — Mode A has no sub-agent mechanism), and step.finish with no detail leaves it unset", () => {
    const log = new LiveWorkLog();

    log.ingest({ kind: "step.start", runId: "r", seq: 1, stepId: "generate_sql", name: "generate_sql", tier: "strong", depth: 0 } as AgentEvent);
    log.ingest({ kind: "step.finish", runId: "r", seq: 2, stepId: "generate_sql", name: "generate_sql", status: "ok" } as AgentEvent);

    expect(log.snapshot()).toEqual([{ id: "generate_sql", label: "generate_sql", state: "done", kind: "step", depth: 0 }]);
  });

  it("step.finish carries its detail (the step's own reasoning/output) onto the ToolStep", () => {
    const log = new LiveWorkLog();

    log.ingest({ kind: "step.start", runId: "r", seq: 1, stepId: "generate_sql", name: "generate_sql", tier: "strong", depth: 0 } as AgentEvent);
    log.ingest({
      kind: "step.finish",
      runId: "r",
      seq: 2,
      stepId: "generate_sql",
      name: "generate_sql",
      status: "ok",
      detail: "Top customer by revenue is Acme.",
    } as AgentEvent);

    expect(log.snapshot()).toEqual([
      { id: "generate_sql", label: "generate_sql", state: "done", kind: "step", depth: 0, detail: "Top customer by revenue is Acme." },
    ]);
  });

  it("an errored step.finish's detail (the error description) is carried through too", () => {
    const log = new LiveWorkLog();

    log.ingest({ kind: "step.start", runId: "r", seq: 1, stepId: "generate_sql", name: "generate_sql", tier: "strong", depth: 0 } as AgentEvent);
    log.ingest({
      kind: "step.finish",
      runId: "r",
      seq: 2,
      stepId: "generate_sql",
      name: "generate_sql",
      status: "error",
      detail: "model unavailable",
    } as AgentEvent);

    expect(log.snapshot()).toEqual([
      { id: "generate_sql", label: "generate_sql", state: "error", kind: "step", depth: 0, detail: "model unavailable" },
    ]);
  });
});
