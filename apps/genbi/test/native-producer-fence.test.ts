import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNativeProducerCassette, nativeProducerCassetteKey, produceNoninteractiveNative, replayNoninteractiveNative } from "../harness/native-producer/index.js";
import type { NativeProducerRequest, NativeProducerResponse } from "../harness/native-producer/index.js";
import { createNativeProducerHostFence } from "../server/native-producer-fence.js";
import { Store } from "../server/db.js";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe("native producer host fence", () => {
  it("keeps private binding identity inside the host fence and rejects stale results and cassettes", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "genbi-native-producer-fence-")); roots.push(root);
    const store = new Store(path.join(root, "state.sqlite"));
    let binding = { path: path.join(root, "project"), identity: "project-identity", generation: 4, revision: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" };
    store.createNativeSession({ id: "native-session-1", purpose: "analysis", vendor: "codex", agent: "genbi-analysis", scopeKind: "bound_project", scopeId: "scope", projectIdentity: binding.identity, bindingGeneration: binding.generation, projectRevision: binding.revision });
    store.transitionNativeSession("native-session-1", "running", { started: true });
    store.createNativeArtifact({ id: "artifact-1", sessionId: "native-session-1", nativeSessionId: "native-session-1", name: "Dashboard", location: "native/artifact-1.json", projectIdentity: binding.identity, bindingGeneration: binding.generation, projectRevision: binding.revision, vendor: "codex", agent: "genbi-analysis", digest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", idempotencyKey: "artifact-save-0001" });
    const fence = createNativeProducerHostFence({ store, getBinding: () => binding, nativeSessionId: "native-session-1" });
    const request: NativeProducerRequest = { version: "1", vendor: "codex", agentId: "answer_query", input: "question", idempotencyKey: "headless-run-0001", scope: { bindingDigest: fence.bindingDigest } };
    const artifact = { id: "artifact-1", kind: "dashboard" as const, digest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", idempotencyKey: "artifact-save-0001" };
    expect(fence.validateRun(request)).toBe(true);
    expect(fence.validateRoute(request, binding.path)).toBe(true);
    expect(fence.validateArtifact(artifact, request)).toBe(true);
    expect(fence.validateArtifact({ ...artifact, idempotencyKey: "other-key" }, request)).toBe(false);
    expect(fence.validateRoute({ ...request, scope: { bindingDigest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" } }, binding.path)).toBe(false);
    expect(JSON.stringify({ request, artifact, bindingDigest: fence.bindingDigest })).not.toContain("native-session-1");
    expect(JSON.stringify({ request, artifact, bindingDigest: fence.bindingDigest })).not.toContain(binding.identity);
    const response: NativeProducerResponse = {
      version: "1", status: "completed",
      lifecycle: [{ state: "accepted" }, { state: "running" }, { state: "completed" }],
      result: { text: "saved dashboard" }, artifacts: [artifact],
    };
    const cassette = createNativeProducerCassette(nativeProducerCassetteKey(request), request, response, fence);
    expect(JSON.stringify(cassette)).not.toContain("native-session-1");
    expect(JSON.stringify(cassette)).not.toContain(binding.identity);
    let releaseDispatch: (() => void) | undefined;
    const delayed = new Promise<void>((resolve) => { releaseDispatch = resolve; });
    const dispatch = vi.fn(async () => {
      await delayed;
      return { text: "late result" };
    });
    const pending = produceNoninteractiveNative(request, { fence, dispatch });
    binding = { ...binding, revision: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" };
    releaseDispatch?.();
    await expect(pending).resolves.toMatchObject({ error: { code: "scope_mismatch" } });
    expect(dispatch).toHaveBeenCalledOnce();
    expect(replayNoninteractiveNative(request, cassette, fence)).toMatchObject({ error: { code: "scope_mismatch" } });
    store.close();
  });
});
