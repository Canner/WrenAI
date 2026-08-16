import { describe, expect, it } from "vitest";
import type { AuthChoice } from "../harness/index.js";
import { canonicalizeProposal, hashEnrichmentOperation, normalizeEnrichmentConfidence } from "../server/enrichment.js";
import {
  composeDraftPrompt,
  composeInspectPrompt,
  createModeBEnrichmentDraftRunner,
  DRAFT_ENRICHMENT_AGENT_ID,
  type EnrichmentDispatchInput,
  INSPECT_CONTEXT_AGENT_ID,
  parseDraftTerminalJson,
  translateDraftTerminal,
} from "../server/enrichment-runner.js";

describe("parseDraftTerminalJson", () => {
  it("parses a bare JSON terminal", () => {
    expect(parseDraftTerminalJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("tolerates a stray ```json code fence despite draft.md forbidding one", () => {
    expect(parseDraftTerminalJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("throws EnrichmentContractError on unparseable text", () => {
    expect(() => parseDraftTerminalJson("not json")).toThrow(/did not return a parseable JSON terminal/);
  });
});

describe("translateDraftTerminal", () => {
  it("translates grill mode's single-operation-under-enrichment_proposal shape, mapping warble's own field names", () => {
    const finalText = JSON.stringify({
      enrichment_proposal: {
        relative_sink: "knowledge/rules/business.md",
        recommended_yaml: "Term: order",
        confidence: 0.9,
        changeKind: "knowledge_append",
        summary: "Append a glossary entry",
      },
    });
    expect(translateDraftTerminal(finalText)).toEqual({
      operations: [
        {
          sink: "knowledge/rules/business.md",
          changeKind: "knowledge_append",
          summary: "Append a glossary entry",
          draft: "Term: order",
          confidence: 0.9,
        },
      ],
    });
  });

  it("translates a multi-operation `operations` array shape", () => {
    const finalText = JSON.stringify({
      enrichment_proposal: {
        operations: [
          { sink: "knowledge/a.md", changeKind: "knowledge_append", summary: "a", draft: "A", confidence: 0.5 },
          { relative_sink: "cubes/revenue/metadata.yml", changeKind: "new_cube", summary: "b", recommended_yaml: "cube: revenue", confidence: 0.8 },
        ],
      },
    });
    expect(translateDraftTerminal(finalText)).toEqual({
      operations: [
        { sink: "knowledge/a.md", changeKind: "knowledge_append", summary: "a", draft: "A", confidence: 0.5 },
        { sink: "cubes/revenue/metadata.yml", changeKind: "new_cube", summary: "b", draft: "cube: revenue", confidence: 0.8 },
      ],
    });
  });

  it("drops a forged hash/id/risk/projectRevision anywhere in the model's JSON -- structural defense in depth ahead of canonicalizeProposal", () => {
    const finalText = JSON.stringify({
      enrichment_proposal: {
        id: "forged-proposal-id",
        hash: "forged-proposal-hash",
        projectRevision: "forged-revision",
        relative_sink: "knowledge/rules/business.md",
        recommended_yaml: "Term: order",
        confidence: 0.9,
        changeKind: "knowledge_append",
        summary: "Append a glossary entry",
        id_: undefined,
        risk: "low",
        id2: "op-forged",
      },
    });
    const translated = translateDraftTerminal(finalText) as { operations: readonly Record<string, unknown>[] };
    expect(translated.operations).toHaveLength(1);
    const op = translated.operations[0]!;
    expect(Object.keys(op).sort()).toEqual(["changeKind", "confidence", "draft", "sink", "summary"]);
    expect(op["hash"]).toBeUndefined();
    expect(op["id"]).toBeUndefined();
    expect(op["risk"]).toBeUndefined();
    expect(op["projectRevision"]).toBeUndefined();
  });

  it("throws EnrichmentContractError when the terminal has no enrichment_proposal object", () => {
    expect(() => translateDraftTerminal(JSON.stringify({ not_a_proposal: true }))).toThrow(/did not contain an enrichment_proposal object/);
  });
});

describe("confidence display labels", () => {
  it("accepts safe model labels without changing host-derived risk", () => {
    const proposal = canonicalizeProposal({ operations: [{
      sink: "cubes/revenue/metadata.yml",
      changeKind: "new_cube",
      summary: "Add a revenue cube",
      draft: "cube: revenue",
      confidence: "high",
    }] }, "revision-1");

    expect(proposal.operations[0]).toMatchObject({ confidence: "high", risk: "high" });
    expect(normalizeEnrichmentConfidence(0.85)).toBe("0.85");
  });

  it("keeps display-only confidence out of proposal and approval-bound operation hashes", () => {
    const operation = {
      sink: "cubes/revenue/metadata.yml",
      changeKind: "new_cube",
      summary: "Add a revenue cube",
      draft: "cube: revenue",
    } as const;
    const high = canonicalizeProposal({ operations: [{ ...operation, confidence: "high" }] }, "revision-1");
    const numeric = canonicalizeProposal({ operations: [{ ...operation, confidence: 0.85 }] }, "revision-1");

    expect(high.id).toBe(numeric.id);
    expect(high.hash).toBe(numeric.hash);
    expect(hashEnrichmentOperation(high.operations[0]!)).toBe(hashEnrichmentOperation(numeric.operations[0]!));
  });

  it.each([
    undefined,
    { label: "high" },
    "x".repeat(65),
    "api_key=secret-value",
    "provider: claude",
  ])("uses a neutral label for missing or unsafe confidence: %j", (confidence) => {
    expect(normalizeEnrichmentConfidence(confidence)).toBe("Not provided");
    const proposal = canonicalizeProposal({ operations: [{
      sink: "knowledge/rules/business.md",
      changeKind: "knowledge_append",
      summary: "Add a business term",
      draft: "Term: margin",
      confidence,
    }] }, "revision-1");
    expect(proposal.operations[0]).toMatchObject({ confidence: "Not provided", risk: "low" });
  });
});

describe("composeInspectPrompt", () => {
  it("grill mode names the mode and states no probe consent was recorded, without implying one was granted", () => {
    const prompt = composeInspectPrompt("grill");
    expect(prompt).toContain('mode is "grill"');
    expect(prompt).toContain("No one-time database-probe consent has been recorded");
    expect(prompt).toContain("do not perform any live database probe");
  });

  it("autopilot mode forbids live database probes outright", () => {
    const prompt = composeInspectPrompt("autopilot");
    expect(prompt).toContain('mode is "autopilot"');
    expect(prompt).toContain("live database probes are forbidden");
  });
});

describe("composeDraftPrompt", () => {
  it("restates the pinned project revision and mode, lists every changeKind literal, and forbids claiming a hash/digest/id/risk", () => {
    const prompt = composeDraftPrompt("grill", "rev-123", "gap inventory text");
    expect(prompt).toContain('project revision "rev-123"');
    expect(prompt).toContain('run mode "grill"');
    for (const kind of ["knowledge_append", "new_cube", "new_view", "new_relationship", "mdl_metric", "calculated_column", "conflict", "ambiguous"]) {
      expect(prompt).toContain(kind);
    }
    expect(prompt).toContain("Do not invent or claim a");
    expect(prompt).toContain("gap inventory text");
  });
});

describe("createModeBEnrichmentDraftRunner (injected dispatch, no live model turn)", () => {
  it("dispatches inspect_context then draft_enrichment, folding turn 1's output into turn 2's composed question, against the bound project", async () => {
    const calls: EnrichmentDispatchInput[] = [];
    const runner = createModeBEnrichmentDraftRunner({
      getAuthChoice: () => ({ mode: "subscription", provider: "claude" }),
      dispatch: async (input) => {
        calls.push(input);
        if (input.agentId === INSPECT_CONTEXT_AGENT_ID) {
          return { finalText: "GAP: no glossary entry for 'order'" };
        }
        return {
          finalText: JSON.stringify({
            enrichment_proposal: {
              relative_sink: "knowledge/rules/business.md",
              recommended_yaml: "Term: order",
              confidence: 0.9,
              changeKind: "knowledge_append",
              summary: "Append a glossary entry",
              hash: "forged",
              id: "forged",
            },
          }),
        };
      },
    });

    const draft = await runner.draft({ projectPath: "/tmp/project", mode: "grill", projectRevision: "rev-abc" });

    expect(calls).toHaveLength(2);
    expect(calls[0]!.agentId).toBe(INSPECT_CONTEXT_AGENT_ID);
    expect(calls[0]!.userProject).toBe("/tmp/project");
    expect(calls[1]!.agentId).toBe(DRAFT_ENRICHMENT_AGENT_ID);
    expect(calls[1]!.userProject).toBe("/tmp/project");
    // Turn 2's question folds in turn 1's finalText verbatim.
    expect(calls[1]!.question).toContain("GAP: no glossary entry for 'order'");
    expect(calls[1]!.question).toContain('project revision "rev-abc"');

    // Full pipeline through the host's own trust boundary: canonicalizeProposal
    // independently recomputes id/hash/risk and ignores anything forged upstream.
    const proposal = canonicalizeProposal(draft, "rev-abc");
    expect(proposal.projectRevision).toBe("rev-abc");
    expect(proposal.operations).toHaveLength(1);
    expect(proposal.operations[0]!.sink).toBe("knowledge/rules/business.md");
    expect(proposal.operations[0]!.risk).toBe("low");
    expect(proposal.id).not.toBe("forged");
    expect(proposal.hash).not.toBe("forged");
    expect(proposal.operations[0]!.id).not.toBe("forged");
  });

  it("rejects a draft call when the live auth choice is not Claude subscription, without ever dispatching (no live model turn, no subprocess spawn)", async () => {
    // Deliberately no `dispatch` override: this proves the *production*
    // `defaultDispatch` path rejects before calling `runModeBDefault` at all,
    // so this stays safe to run without a live model or a real Mode B
    // subprocess.
    const guarded = createModeBEnrichmentDraftRunner({ getAuthChoice: () => ({ mode: "api-key", adapter: "mock" }) });
    await expect(guarded.draft({ projectPath: "/tmp/project", mode: "grill", projectRevision: "rev-abc" })).rejects.toThrow(
      /requires Claude subscription auth/,
    );
  });

  it("propagates a translation failure (unparseable or shapeless terminal) as EnrichmentContractError rather than a raw parse error", async () => {
    const runner = createModeBEnrichmentDraftRunner({
      getAuthChoice: () => ({ mode: "subscription", provider: "claude" }),
      dispatch: async (input) => ({ finalText: input.agentId === INSPECT_CONTEXT_AGENT_ID ? "gaps" : "not json at all" }),
    });
    await expect(runner.draft({ projectPath: "/tmp/project", mode: "autopilot", projectRevision: "rev-xyz" })).rejects.toThrow(
      /did not return a parseable JSON terminal/,
    );
  });
});

describe("createModeBEnrichmentDraftRunner readiness() -- the same live answer draft() itself would give, without ever dispatching", () => {
  it("reports available for Claude subscription auth", () => {
    const runner = createModeBEnrichmentDraftRunner({ getAuthChoice: () => ({ mode: "subscription", provider: "claude" }) });
    expect(runner.readiness?.()).toEqual({ available: true });
  });

  it("reports unavailable with a stable reason code for Codex subscription auth -- the exact defect this seam fixes", () => {
    const runner = createModeBEnrichmentDraftRunner({ getAuthChoice: () => ({ mode: "subscription", provider: "codex" }) });
    expect(runner.readiness?.()).toEqual({ available: false, reason: "requires_claude_subscription" });
  });

  it("reports unavailable with the same reason code for a non-subscription auth mode (api-key)", () => {
    const runner = createModeBEnrichmentDraftRunner({ getAuthChoice: () => ({ mode: "api-key", adapter: "mock" }) });
    expect(runner.readiness?.()).toEqual({ available: false, reason: "requires_claude_subscription" });
  });

  it("re-reads the live auth choice on every call, matching draft()'s own live (non-frozen) read", () => {
    let authChoice: AuthChoice = { mode: "subscription", provider: "codex" };
    const runner = createModeBEnrichmentDraftRunner({ getAuthChoice: () => authChoice });
    expect(runner.readiness?.()).toEqual({ available: false, reason: "requires_claude_subscription" });
    authChoice = { mode: "subscription", provider: "claude" };
    expect(runner.readiness?.()).toEqual({ available: true });
  });

  it("never dispatches (no live model turn, no subprocess spawn) -- readiness is a pure read", () => {
    let dispatched = false;
    const runner = createModeBEnrichmentDraftRunner({
      getAuthChoice: () => ({ mode: "subscription", provider: "codex" }),
      dispatch: async () => {
        dispatched = true;
        return { finalText: "unused" };
      },
    });
    runner.readiness?.();
    expect(dispatched).toBe(false);
  });
});
