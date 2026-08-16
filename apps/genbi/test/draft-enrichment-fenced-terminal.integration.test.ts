/**
 * Regression pin (now fixed) for a live 2026-08-09 Grill run: `draft_enrichment`'s real recorded
 * terminal was prose followed by a ```json fenced block, which `parseDraftTerminalJson`'s
 * fence regex used to fully anchor to the whole trimmed string (`/^```(?:json)?\s*([\s\S]*?)\s*```$/`
 * in `server/enrichment-runner.ts`) -- so any leading prose made the whole terminal unparseable and
 * the run produced no proposal at all.
 *
 * Investigation established this is model variance against a correct, present instruction, not
 * prompt/contract drift: `genbi-enrich-context/components/draft_enrichment/steps/draft.md` (warble
 * repo) has a single-commit history and its "Your FINAL message must be one JSON object only. Do
 * not include prose or Markdown fences." line is byte-identical in the compiled `ir.golden.json`
 * the runtime actually dispatches. So the durable fix belongs in THIS repo's host layer, not in
 * warble's prompt wording -- a prompt cannot be made deterministic by repeating an instruction the
 * model already received. `parseDraftTerminalJson`'s fence match is no longer anchored to the whole
 * string, duplicating (not importing) the fence-matching approach the unrelated answer-rendering
 * path in `harness/render/envelope.ts`'s `extractJsonObjectText` already uses, since that function
 * is private to its module and its extra brace-scanning fallback isn't needed here.
 *
 * The tests below now assert the FIXED behavior against the real recorded terminal, in place of the
 * `it.fails` pin this file originally carried while the fix lived on a separate branch.
 *
 * It also pins the severity finding that makes the fenced terminal the real driver of this
 * regression rather than the model's invented `project_revision`: `translateDraftTerminal` already
 * discards every forged field down to 5 named ones (see the "drops a forged hash/id/risk/
 * projectRevision" case in `test/enrichment-runner.test.ts`), so the invented hash in the real
 * cassette is a contract violation, not a trust breach -- proven here against the ACTUAL recorded
 * payload, not a hand-authored one. The fenced terminal is what actually breaks the run, because it
 * makes the terminal unparseable before that field-stripping ever runs.
 *
 * The cassette fixtures (`chat__inspect_context__grill-fenced-terminal.ndjson` and
 * `chat__draft_enrichment__grill-fenced-terminal.ndjson`) are two real recorded turns from that run
 * (the inspection turn and the draft turn it fed), scrubbed by `harness/replay/sanitize.mjs` --
 * absolute local paths, provider tool-use ids, the SDK session id, and the recording machine's unix
 * username all replaced with synthetic, per-file-consistent placeholders (see
 * `test/fixtures/cassettes/README.md` for the naming convention this follows).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseWarbleChatEventLine } from "../harness/route/chat-event-mapper.js";
import { canonicalizeProposal } from "../server/enrichment.js";
import { translateDraftTerminal } from "../server/enrichment-runner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Extracts a recorded turn's final `"answer"` text from a cassette, via the real line parser. */
function readCassetteAnswerText(name: string): string {
  const cassettePath = path.join(__dirname, "fixtures", "cassettes", `${name}.ndjson`);
  const raw = readFileSync(cassettePath, "utf8");
  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  for (const line of lines) {
    const parsed = parseWarbleChatEventLine(line);
    if (parsed?.t === "answer") return parsed.text;
  }
  throw new Error(`cassette ${name} has no "answer" line`);
}

describe("draft_enrichment fenced-terminal regression (2026-08-09 Grill run)", () => {
  const inspectAnswerText = readCassetteAnswerText("chat__inspect_context__grill-fenced-terminal");
  const draftAnswerText = readCassetteAnswerText("chat__draft_enrichment__grill-fenced-terminal");

  it("inspect_context's recorded companion turn is intact (free-text gap inventory, not itself subject to the JSON contract)", () => {
    expect(inspectAnswerText.length).toBeGreaterThan(0);
    expect(inspectAnswerText).toMatch(/ENRICHMENT_GAPS INVENTORY/i);
  });

  it("the recorded draft_enrichment terminal is prose followed by a fenced block, not a bare JSON object", () => {
    expect(draftAnswerText.trim().startsWith("{")).toBe(false);
    expect(draftAnswerText).toMatch(/```json/);
    // The production fence regex is fully anchored to the whole trimmed string, so it does not
    // match here -- this is the precise mechanism by which the real run's terminal became
    // unparseable (see this file's doc comment).
    const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(draftAnswerText.trim());
    expect(fenced).toBeNull();
  });

  it(
    "fixed: translateDraftTerminal parses the real prose-preceded fenced terminal, discarding the model's invented project_revision the same way the bare-fence case already does",
    () => {
      const translated = translateDraftTerminal(draftAnswerText) as { operations: readonly Record<string, unknown>[] };
      expect(translated.operations).toHaveLength(1);
      const op = translated.operations[0]!;
      expect(Object.keys(op).sort()).toEqual(["changeKind", "confidence", "draft", "sink", "summary"]);
      expect(op["sink"]).toBe("cubes/customer_analytics/metadata.yml");
      expect(op["changeKind"]).toBe("new_cube");
      expect(op["projectRevision"]).toBeUndefined();
      expect(op["hash"]).toBeUndefined();
      expect(op["id"]).toBeUndefined();
      expect(op["risk"]).toBeUndefined();
    },
  );

  it("severity check: even if the fence were tolerated, translateDraftTerminal already discards the model's invented project_revision -- proven against the real recorded payload", () => {
    // `translateDraftTerminal` already tolerates a BARE fenced block (see
    // test/enrichment-runner.test.ts's "tolerates a stray ```json code fence" case); only the
    // PROSE-PRECEDED fence in the real recording is the unresolved defect pinned above. Strip the
    // prose here (a test-only extraction, not a production code path) to isolate the severity claim
    // from the parsing defect.
    const fenceMatch = /```json\s*([\s\S]*?)\s*```/.exec(draftAnswerText);
    expect(fenceMatch?.[1]).toBeDefined();
    const bareJson = fenceMatch![1]!.trim();
    const translated = translateDraftTerminal(bareJson) as { operations: readonly Record<string, unknown>[] };
    expect(translated.operations).toHaveLength(1);
    const op = translated.operations[0]!;
    expect(Object.keys(op).sort()).toEqual(["changeKind", "confidence", "draft", "sink", "summary"]);
    expect(op["projectRevision"]).toBeUndefined();
    expect(op["hash"]).toBeUndefined();
    expect(op["id"]).toBeUndefined();
    expect(op["risk"]).toBeUndefined();
  });
});

describe("draft_enrichment string-confidence regression (2026-08-10 Grill run)", () => {
  it("canonicalizes the real string label without trusting the model's impact or Auto-pilot fields", () => {
    const answer = readCassetteAnswerText("chat__draft_enrichment__string-confidence");
    const translated = translateDraftTerminal(answer);
    const proposal = canonicalizeProposal(translated, "host-revision");

    expect(proposal.operations).toHaveLength(1);
    expect(proposal.operations[0]).toMatchObject({
      sink: "cubes/orders_analytics/metadata.yml",
      changeKind: "new_cube",
      confidence: "high",
      risk: "high",
    });
  });
});
