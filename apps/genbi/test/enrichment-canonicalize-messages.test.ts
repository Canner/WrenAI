import { describe, expect, it } from "vitest";
import { canonicalizeProposal, EnrichmentContractError } from "../server/enrichment.js";

/**
 * `canonicalizeProposal` used to collapse every structural defect -- an
 * unknown changeKind, a missing sink, a sink of the wrong shape -- into one
 * message: "runtime returned an incompatible enrichment operation". That was
 * undiagnosable without reading the source, and it hid a real bug: the
 * "wrong shape" case fired even for a genuinely real project layout (a
 * two-level `knowledge/<category>/<file>.md` sink, rejected by the old
 * one-level pattern), and there was nothing in the message to tell the two
 * apart.
 *
 * Each check below now throws a message naming exactly which check failed.
 * None of them may echo the raw value that failed -- that is what
 * `DISPLAY_SECRET`/`DISPLAY_INTERNAL` redaction inside `display()` exists to
 * strip from `summary`/`draft`, and reintroducing the raw sink into the
 * changeKind-mismatch message would leak whatever path or content a runtime
 * proposed, unredacted, straight into an agent/user-visible error (see
 * `server/app.ts`'s direct surfacing of `EnrichmentContractError.message`).
 */

const validOperation = () => ({
  changeKind: "knowledge_append",
  sink: "knowledge/rules/general.md",
  summary: "a short summary",
  draft: "a short draft",
  confidence: "high",
});

describe("canonicalizeProposal — distinct, diagnosable rejection messages", () => {
  it("names an unparseable proposal shape distinctly from an operation-level defect", () => {
    expect(() => canonicalizeProposal(null, "rev-1")).toThrow(EnrichmentContractError);
    expect(() => canonicalizeProposal(null, "rev-1")).toThrow(/proposal must be an object/i);
    expect(() => canonicalizeProposal({ operations: "not-an-array" }, "rev-1")).toThrow(/proposal must be an object/i);
  });

  it("names an empty operations array distinctly from a too-large one", () => {
    expect(() => canonicalizeProposal({ operations: [] }, "rev-1")).toThrow(/no operations/i);
    const tooMany = Array.from({ length: 21 }, () => validOperation());
    expect(() => canonicalizeProposal({ operations: tooMany }, "rev-1")).toThrow(/exceeds the 20-operation limit/i);
  });

  it("names an unknown changeKind, without echoing whatever bogus value was sent", () => {
    const bogusKind = "sk-super-secret-looking-kind";
    try {
      canonicalizeProposal({ operations: [{ ...validOperation(), changeKind: bogusKind }] }, "rev-1");
      expect.unreachable("expected a throw");
    } catch (error) {
      expect(error).toBeInstanceOf(EnrichmentContractError);
      const message = (error as Error).message;
      expect(message).toMatch(/unknown changeKind/i);
      expect(message).not.toContain(bogusKind);
    }
  });

  it("names a missing/oversized sink, without echoing it", () => {
    expect(() => canonicalizeProposal({ operations: [{ ...validOperation(), sink: "" }] }, "rev-1")).toThrow(/sink is missing, empty, or exceeds/i);

    const longSink = `knowledge/rules/${"a".repeat(200)}.md`;
    try {
      canonicalizeProposal({ operations: [{ ...validOperation(), sink: longSink }] }, "rev-1");
      expect.unreachable("expected a throw");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toMatch(/sink is missing, empty, or exceeds/i);
      expect(message).not.toContain(longSink);
    }
  });

  it("names a sink/changeKind layout mismatch, naming the changeKind but never the offending path", () => {
    const secretishSink = "knowledge/general.md"; // the old, wrong one-level shape
    try {
      canonicalizeProposal({ operations: [{ ...validOperation(), sink: secretishSink }] }, "rev-1");
      expect.unreachable("expected a throw");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toMatch(/does not match the required layout for changeKind "knowledge_append"/);
      expect(message).not.toContain(secretishSink);
    }
  });

  it("names which display field failed (summary vs draft), still redacting rather than throwing on redactable content", () => {
    expect(() => canonicalizeProposal({ operations: [{ ...validOperation(), summary: 123 }] }, "rev-1")).toThrow(/summary must be a string/i);
    expect(() => canonicalizeProposal({ operations: [{ ...validOperation(), draft: "" }] }, "rev-1")).toThrow(/draft is empty/i);
    const overlong = "x".repeat(600);
    expect(() => canonicalizeProposal({ operations: [{ ...validOperation(), summary: overlong }] }, "rev-1")).toThrow(/summary exceeds the 512-character limit/i);
  });

  it("accepts the real two-level knowledge layout this whole suite exists to fix", () => {
    expect(() => canonicalizeProposal({ operations: [validOperation()] }, "rev-1")).not.toThrow();
  });
});
