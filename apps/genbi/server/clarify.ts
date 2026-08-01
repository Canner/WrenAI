/**
 * Heuristic clarify pre-flight. No LLM call: a plain regex
 * classifier that flags an ambiguous comparative question with no time
 * qualifier and proposes a small set of time-range chips. Deliberately
 * simple and fixed — do not "improve" the heuristic here.
 */
export function classifyClarify(question: string): { prompt: string; chips: string[] } | null {
  const q = question.trim();
  if (!q) return null;
  const hasAmbiguousComparative = /\b(which|compare|vs\.?|versus|better)\b/i.test(q);
  const hasTimeQualifier = /\b(today|yesterday|this (week|month|quarter|year)|last \d+|ytd|year to date|\d{4})\b/i.test(q);
  if (hasAmbiguousComparative && !hasTimeQualifier) {
    return { prompt: "Which time range should I use?", chips: ["This month", "This quarter", "Last 12 months"] };
  }
  return null;
}
