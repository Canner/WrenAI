import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { serve } from "@hono/node-server";
import { afterEach, describe, expect, it } from "vitest";
import { resolveArtifactsDir } from "../harness/index.js";
import { createApp } from "../server/app.js";
import { Store, type NativeSessionVendor } from "../server/db.js";
import { NATIVE_ENRICHMENT_SUBMIT_MCP_TOOL_NAME, resolveEnrichmentBinding } from "../server/enrichment.js";
import { NativeArtifactService } from "../server/native-artifacts.js";
import type { TurnDeps } from "../server/turn.js";

/**
 * AC#6: an end-to-end proposal-to-ledger check over a REAL socket -- a BFF
 * listening on a spare, OS-assigned port (`port: 0`), reached with a
 * hand-crafted JSON-RPC `tools/call` body over actual `fetch`, not the
 * in-process Hono `.request()` helper the rest of this suite uses. That
 * helper never opens a socket or serializes/parses real HTTP bodies, so it
 * cannot see a defect in the transport layer itself (headers, chunked JSON,
 * content-type negotiation) the way `native-artifacts.test.ts`'s own
 * "real Streamable HTTP lifecycle" test does for `save_dashboard`. This is
 * the same treatment for `submit_context_proposal`. No model call is made
 * anywhere in this flow -- `verifyEnrichmentProposal` is a deterministic
 * stub, and submitting a proposal never dispatches a runtime turn.
 */

const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

function project(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "genbi-real-transport-enrich-"));
  dirs.push(dir);
  mkdirSync(path.join(dir, "target"));
  writeFileSync(path.join(dir, "wren_project.yml"), "name: demo\n");
  writeFileSync(path.join(dir, "target", "mdl.json"), '{"models":[{"name":"orders"}]}');
  return dir;
}

const passVerification = async (proposal: { hash: string; projectRevision: string }) =>
  ({ status: "verified" as const, proposalHash: proposal.hash, projectRevision: proposal.projectRevision, stepsRun: [] });

const validOperations = [
  { sink: "knowledge/rules/general.md", changeKind: "knowledge_append", summary: "Append a rule", draft: "Orders are counted at fulfilment." },
];

function createFixture(vendor: NativeSessionVendor = "codex") {
  const projectDir = project();
  const store = new Store(":memory:");
  const binding = store.activateEnrichmentBinding(resolveEnrichmentBinding(projectDir));
  const outDir = path.join(projectDir, "out");
  const row = store.createNativeSession({
    id: `real-transport-enrich-${vendor}`, purpose: "context_enrichment", vendor, agent: "draft_enrichment",
    scopeKind: "bound_project", scopeId: `scope-real-transport-${vendor}`, projectIdentity: binding.identity,
    bindingGeneration: binding.generation, projectRevision: binding.revision,
  });
  store.transitionNativeSession(row.id, "running", { started: true });
  const mcpUrlPlaceholder = "http://127.0.0.1:0/api/native-sessions/mcp"; // rewritten once the real port is known
  const service = new NativeArtifactService({
    store, artifactsRoot: resolveArtifactsDir(outDir), expectedMcpUrl: mcpUrlPlaceholder, mcpUrl: mcpUrlPlaceholder,
    getBinding: () => binding,
  });
  const descriptor = service.issue(store.getNativeSession(row.id)!, binding);
  const deps: TurnDeps = {
    store,
    route: async () => { throw new Error("no runtime turn should ever be dispatched by a proposal submission"); },
    baseRouteOptions: { authChoice: { mode: "api-key", adapter: "mock" }, profileSource: "/fixture/profile", userProject: projectDir, outDir },
    nativeArtifacts: service,
    verifyEnrichmentProposal: passVerification,
  };
  return { store, credential: descriptor.credential, app: createApp(deps) };
}

describe("submit_context_proposal over a real BFF socket on a spare port [no model call]", () => {
  it("accepts a hand-crafted JSON-RPC tools/call over a real HTTP transport and leaves the enrichment ledger non-empty", async () => {
    const fixture = createFixture();
    const server = serve({ fetch: fixture.app.fetch, hostname: "127.0.0.1", port: 0 });
    if (!server.listening) await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("spare-port enrichment probe did not receive a TCP address");
    const endpoint = `http://127.0.0.1:${address.port}/api/native-sessions/mcp`;

    try {
      expect(fixture.store.getLatestEnrichmentRun()).toBeUndefined();

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${fixture.credential}`,
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: NATIVE_ENRICHMENT_SUBMIT_MCP_TOOL_NAME, arguments: { operations: validOperations } },
        }),
      });

      expect(response.status).toBe(200);
      const body = await response.json() as { result: { structuredContent: { runId: string; operationCount: number } } };
      expect(body.result.structuredContent.operationCount).toBe(1);

      // The ledger this feature exists to reach is genuinely non-empty --
      // read back over the same real socket, not just the in-process store.
      const run = fixture.store.getLatestEnrichmentRun();
      expect(run).toBeDefined();
      expect(run!.id).toBe(body.result.structuredContent.runId);
      const operationsResponse = await fetch(`http://127.0.0.1:${address.port}/api/context/enrichment/${run!.id}`);
      expect(operationsResponse.status).toBe(200);
      const operationsBody = await operationsResponse.json() as { operations: { sink: string }[] };
      expect(operationsBody.operations).toHaveLength(1);
      expect(operationsBody.operations[0]!.sink).toBe("knowledge/rules/general.md");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      fixture.store.close();
    }
  });
});
