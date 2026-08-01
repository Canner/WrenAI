import { describe, expect, it } from "vitest";
import { classifyClarify } from "../server/clarify.js";
import { composeClarifyFollowUp, composeInput } from "../server/compose.js";

describe("classifyClarify (D1 heuristic)", () => {
  it("asks for a time range on an ambiguous comparative with no time qualifier", () => {
    const result = classifyClarify("Which product sells better?");
    expect(result).not.toBeNull();
    expect(result?.prompt).toBe("Which time range should I use?");
    expect(result?.chips).toEqual(["This month", "This quarter", "Last 12 months"]);
  });

  it("does not clarify when a time qualifier is already present", () => {
    expect(classifyClarify("Which product sold better this quarter?")).toBeNull();
    expect(classifyClarify("Compare Q1 revenue vs Q2 2026")).toBeNull();
  });

  it("does not clarify a plain, unambiguous question", () => {
    expect(classifyClarify("What is total revenue?")).toBeNull();
  });

  it("returns null for empty/whitespace-only input", () => {
    expect(classifyClarify("")).toBeNull();
    expect(classifyClarify("   ")).toBeNull();
  });
});

describe("composeInput (D3 context composition)", () => {
  it("joins prior turns as User/Assistant pairs, bounded to the last 5", () => {
    const turns = Array.from({ length: 8 }, (_, i) => ({ question: `q${i}`, answerSummary: `a${i}` }));
    const composed = composeInput(turns, "final question");
    const pairCount = composed.split("\n\n").length;
    expect(pairCount).toBe(6); // 5 bounded prior turns + the final question
    expect(composed).not.toContain("q0");
    expect(composed).not.toContain("q1");
    expect(composed).not.toContain("q2");
    expect(composed).toContain("q3");
    expect(composed).toContain("q7");
    expect(composed.endsWith("final question")).toBe(true);
  });

  it("falls back to '(no answer)' when a prior turn has no summary", () => {
    const composed = composeInput([{ question: "q0", answerSummary: undefined }], "q1");
    expect(composed).toContain("Assistant: (no answer)");
  });

  it("composes a clarify follow-up as the pending question plus the follow-up in parens", () => {
    expect(composeClarifyFollowUp("Which time range should I use?", "this quarter")).toBe(
      "Which time range should I use? (this quarter)",
    );
  });
});
