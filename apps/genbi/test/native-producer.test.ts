import { describe, expect, it, vi } from "vitest";
import {
  NATIVE_PRODUCER_VERSION,
  createNativeProducerCassette,
  createRouteNativeProducer,
  nativeProducerCassetteKey,
  produceNoninteractiveNative,
  replayNoninteractiveNative,
} from "../harness/native-producer/index.js";
import type { NativeProducerDispatch, NativeProducerHostFence, NativeProducerRequest, NativeProducerScope } from "../harness/native-producer/index.js";
import type { RouteOptions, RouteResult } from "../harness/route/types.js";

const scope: NativeProducerScope = { bindingDigest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" };

function fence(): NativeProducerHostFence {
  return {
    bindingDigest: scope.bindingDigest,
    validateRun: (value) => value.scope.bindingDigest === scope.bindingDigest && value.idempotencyKey === "headless-run-0001",
    validateRoute: (value, userProject) => value.scope.bindingDigest === scope.bindingDigest && userProject === "project",
    validateArtifact: (artifact) => artifact.idempotencyKey.startsWith("artifact-save-"),
  };
}

function request(vendor: "claude" | "codex" = "claude"): NativeProducerRequest {
  return { version: NATIVE_PRODUCER_VERSION, vendor, agentId: "answer_query", input: "show monthly orders", scope, idempotencyKey: "headless-run-0001" };
}

function producer(dispatch: NativeProducerDispatch, extra: { timeoutMs?: number; signal?: AbortSignal } = {}) {
  return produceNoninteractiveNative(request(), { fence: fence(), dispatch, ...extra });
}

describe("noninteractive native producer", () => {
  it.each(["claude", "codex"] as const)("normalizes the %s offline seam into the same bounded contract", async (vendor) => {
    const dispatch = vi.fn(async (input) => {
      input.onEvent({ kind: "tool.call", runId: "private-run", seq: 1, stepId: "generate", callId: "private-call", tool: "wren.run_sql", input: { sql: "select secret=hidden" }, depth: 0, status: "running" });
      return {
        text: "Orders are 42",
        artifacts: [{ id: "artifact-1", kind: "dashboard" as const, digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", idempotencyKey: "artifact-save-0001" }],
      };
    });
    const result = await produceNoninteractiveNative(request(vendor), { fence: fence(), dispatch });

    expect(result).toMatchObject({
      version: "1", status: "completed",
      lifecycle: [{ state: "accepted" }, { state: "running" }, { state: "completed" }],
      result: { text: "Orders are 42" },
      artifacts: [{ id: "artifact-1", idempotencyKey: "artifact-save-0001" }],
    });
    expect(JSON.stringify(result)).not.toContain("private-run");
    expect(JSON.stringify(result)).not.toContain("private-call");
    expect(JSON.stringify(result)).not.toContain("select secret");
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it("fails closed for malformed output, unsupported versions, and scope changes", async () => {
    const dispatch: NativeProducerDispatch = async () => ({ text: "" });
    await expect(producer(dispatch)).resolves.toMatchObject({ status: "failed", error: { code: "malformed_output" } });
    await expect(produceNoninteractiveNative({ ...request(), version: "2" }, { fence: fence(), dispatch })).resolves.toMatchObject({ error: { code: "unsupported_version" } });
    await expect(produceNoninteractiveNative({ ...request(), scope: { bindingDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" } }, { fence: fence(), dispatch })).resolves.toMatchObject({ error: { code: "scope_mismatch" } });
  });

  it("reconstructs hostile cassette values or rejects them before replay", async () => {
    const response = await producer(async () => ({ text: "result" }));
    const cassette = createNativeProducerCassette(nativeProducerCassetteKey(request()), request(), response, fence());
    for (const hostile of [
      { ...cassette, response: { ...cassette.response, lifecycle: [{ state: "accepted", raw: "terminal" }, { state: "running" }, { state: "completed" }] } },
      { ...cassette, response: { ...cassette.response, result: { text: "show monthly orders" } } },
      { ...cassette, response: { ...cassette.response, result: { text: "token=not-a-secret" } } },
      { ...cassette, response: { ...cassette.response, result: { text: "result\u001b[2J" } } },
      { ...cassette, response: { ...cassette.response, result: { text: '{"tool_call":"private"}' } } },
      { ...cassette, response: { ...cassette.response, result: { text: "mcp_server=private" } } },
    ]) expect(replayNoninteractiveNative(request(), hostile, fence())).toMatchObject({ error: { code: "missing_replay" } });
  });

  it("fails closed for timeout, cancellation, and producer errors without fallback", async () => {
    const hanging: NativeProducerDispatch = ({ signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true }));
    await expect(producer(hanging, { timeoutMs: 1 })).resolves.toMatchObject({ error: { code: "timeout" } });
    const controller = new AbortController();
    const cancelled = producer(hanging, { signal: controller.signal });
    controller.abort();
    await expect(cancelled).resolves.toMatchObject({ error: { code: "cancelled" } });
    await expect(producer(async () => { throw new Error("private dispatcher stderr"); })).resolves.toMatchObject({ error: { code: "producer_failed" } });
  });

  it.each(["claude", "codex"] as const)("stops the %s seam when cancellation wins during preparation", async (vendor) => {
    const controller = new AbortController();
    let spawnAttempted = false;
    const dispatch: NativeProducerDispatch = async ({ signal }) => {
      await Promise.resolve(); // compile/resolve-sized asynchronous preparation seam
      if (signal.aborted) throw new DOMException("cancelled", "AbortError");
      spawnAttempted = true;
      return { text: "unexpected" };
    };
    const pending = produceNoninteractiveNative(request(vendor), { fence: fence(), dispatch, signal: controller.signal });
    controller.abort();
    await expect(pending).resolves.toMatchObject({ error: { code: "cancelled" } });
    expect(spawnAttempted).toBe(false);
  });

  it("captures and replays only the stable sanitized contract", async () => {
    const response = await producer(async () => ({ text: "result" }));
    const cassette = createNativeProducerCassette(nativeProducerCassetteKey(request()), request(), response, fence());
    expect(JSON.stringify(cassette)).not.toContain("show monthly orders");
    expect(replayNoninteractiveNative(request(), cassette, fence())).toEqual(response);
    expect(replayNoninteractiveNative(request(), undefined, fence())).toMatchObject({ error: { code: "missing_replay" } });
    expect(replayNoninteractiveNative(request(), { ...cassette, key: "claude__answer_query__different" }, fence())).toMatchObject({ error: { code: "missing_replay" } });
    expect(replayNoninteractiveNative(request(), { ...cassette, version: "2" }, fence())).toMatchObject({ error: { code: "unsupported_version" } });
    expect(replayNoninteractiveNative({ ...request(), vendor: "codex" }, cassette, fence())).toMatchObject({ error: { code: "scope_mismatch" } });
  });

  it("rejects replay artifact provenance that does not belong to the cassette scope", async () => {
    const response = await producer(async (input) => ({
      text: "result",
      artifacts: [{ id: "artifact-2", kind: "report" as const, digest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", idempotencyKey: "artifact-save-0002" }],
    }));
    const cassette = createNativeProducerCassette(nativeProducerCassetteKey(request()), request(), response, fence());
    const mismatched = {
      ...cassette,
      response: {
        ...cassette.response,
        artifacts: [{ ...cassette.response.artifacts[0]!, idempotencyKey: "other-key" }],
      },
    };
    expect(replayNoninteractiveNative(request(), mismatched, fence())).toMatchObject({ error: { code: "scope_mismatch" } });
  });

  it("keeps the selected subscription vendor and does not fall back through the route adapter", async () => {
    const route = vi.fn(async (options: RouteOptions): Promise<RouteResult> => ({ backend: "codex-local", warnings: [], finalText: `result for ${options.agentId}` }));
    const dispatch = createRouteNativeProducer(route, {
      authChoice: { mode: "subscription", provider: "codex" }, profileSource: "profile", userProject: "project",
    });
    const result = await produceNoninteractiveNative(request("codex"), { fence: fence(), dispatch });
    expect(result).toMatchObject({ status: "completed", result: { text: "result for answer_query" } });
    expect(route).toHaveBeenCalledWith(expect.objectContaining({ agentId: "answer_query", question: "show monthly orders" }));
    await expect(produceNoninteractiveNative(request("claude"), { fence: fence(), dispatch })).resolves.toMatchObject({ error: { code: "producer_failed" } });
  });
});
