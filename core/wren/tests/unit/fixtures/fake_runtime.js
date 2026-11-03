#!/usr/bin/env node
// A scripted stand-in for the private runtime (`warble-private-service/1`), for host tests that
// must observe what the host sends, not what a model does. It speaks the same line-delimited
// JSON protocol on stdin/stdout:
//
//   init       -> {protocol, ir: "0.9", schema: "1"}; the payload is kept (apiKey redacted)
//   authorize  -> true (no policy is evaluated here)
//   cancel     -> true; marks the owner cancelled
//   invoke     -> behaviour chosen by the JSON in `request` (see below)
//   echo_init  -> the stored init payload, so a test can assert `limits` and the rest
//   hang       -> never replies
//   stray      -> replies with an id the host never sent (a protocol violation)
//   ops        -> every op and tool_result received so far, in order (`ops` itself excluded)
//
// `invoke` behaviours (`request` is a JSON string with a "behavior" key):
//   "evidence" (default) reply {evidence: "fake-token"}
//   "echo"               reply the parsed request
//   "hang"               never reply
//   "late_tool_call"     hang until cancelled, then send a tool_call and a late reply for the
//                        cancelled owner, as a real runtime can before it notices the cancel
//   "with_calls"         reply {value, calls}: the usage envelope of a limits-aware runtime
//   "fail_with_calls"    reply the failure envelope of a limits-aware runtime:
//                        {error, diagnostic, calls, turns, toolCalls} (all taken from the request)
//   "slow"               reply after `delay_ms`
//   "script"             call the host's tools one after another, whatever each answer was
//                        (a `tool_denied` does not stop it, as a runtime that has not yet noticed
//                        a cancel would carry on), then reply {evidence: <the last token any
//                        tool result carried>}. `steps` is [{tool, args}]. The behaviour may be
//                        given as the `question` of an ask, so a service-level test can drive it.
//                        `calls` (any value) is sent along with the final reply, and `fail`
//                        ({diagnostic, calls, turns, toolCalls}) ends it with a failure envelope
//                        instead of a value.
const readline = require("node:readline");

const PROTOCOL = "warble-private-service/1";
let init = null;
const seen = [];
const cancelled = new Set();
const waiting = new Map();
const toolWaiters = new Map();
let sequence = 0;

const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");

function redacted(message) {
  const copy = JSON.parse(JSON.stringify(message));
  if (copy.model && copy.model.apiKey) copy.model.apiKey = "<redacted>";
  return copy;
}

function parseRequest(raw) {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function callTool(owner, name, args) {
  const id = ++sequence;
  send({ type: "tool_call", id, owner, name, args });
  return new Promise((resolve) => toolWaiters.set(id, resolve));
}

function failure(m, spec) {
  send({
    id: m.id,
    error: "service_unavailable",
    diagnostic: spec.diagnostic,
    calls: spec.calls,
    turns: spec.turns,
    toolCalls: spec.toolCalls,
  });
}

async function script(m, steps, extra) {
  let token = "fake-token";
  for (const step of steps) {
    const result = await callTool(m.id, step.tool, step.args || {});
    if (result.value && typeof result.value.evidence === "string") token = result.value.evidence;
  }
  if (extra.fail) return failure(m, extra.fail);
  send({ id: m.id, value: { evidence: token }, ...("calls" in extra ? { calls: extra.calls } : {}) });
}

function invoke(m) {
  const request = parseRequest(m.request);
  const named = parseRequest(request.question);
  switch (request.behavior || named.behavior || "evidence") {
    case "script":
      return void script(m, named.steps || request.steps || [], named.steps ? named : request);
    case "fail_with_calls":
      return failure(m, request);
    case "echo":
      return send({ id: m.id, value: request });
    case "hang":
      return;
    case "with_calls":
      return send({
        id: m.id,
        value: { evidence: "fake-token" },
        calls: [{ turn: 1, elapsedMs: 5, input: 1, output: 2, reasoning: 0, cacheRead: 0, stopReason: "stop", rawStopReason: "stop", toolCalls: 0, status: "ok" }],
      });
    case "late_tool_call":
      waiting.set(m.id, () => {
        send({ type: "tool_call", id: ++sequence, owner: m.id, name: "late", args: {} });
        send({ id: m.id, value: { evidence: "late" } });
      });
      return;
    case "slow":
      return void setTimeout(
        () => !cancelled.has(m.id) && send({ id: m.id, value: { evidence: "fake-token" } }),
        Number(request.delay_ms || 100),
      );
    default:
      return send({ id: m.id, value: { evidence: "fake-token" } });
  }
}

const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const m = JSON.parse(line);
  if (m.type === "tool_result") {
    seen.push({ type: "tool_result", owner: m.owner, error: m.error || null });
    const waiter = toolWaiters.get(m.id);
    if (waiter) {
      toolWaiters.delete(m.id);
      waiter(m);
    }
    return;
  }
  if (m.op !== "ops" && m.op !== "echo_init") seen.push({ op: m.op, owner: m.owner || null });
  switch (m.op) {
    case "init":
      if (init || m.protocol !== PROTOCOL) return send({ id: m.id, error: "service_unavailable" });
      init = redacted(m);
      return send({ id: m.id, value: { protocol: PROTOCOL, ir: "0.9", schema: "1" } });
    case "echo_init":
      return send({ id: m.id, value: init });
    case "ops":
      return send({ id: m.id, value: seen });
    case "authorize":
      return send({ id: m.id, value: true });
    case "cancel": {
      cancelled.add(m.owner);
      send({ id: m.id, value: true });
      const release = waiting.get(m.owner);
      if (release) {
        waiting.delete(m.owner);
        release();
      }
      return;
    }
    case "invoke":
      return invoke(m);
    case "hang":
      return;
    case "stray":
      return send({ id: "never-sent", value: 1 });
    default:
      return send({ id: m.id, error: "service_unavailable" });
  }
});
