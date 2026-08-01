/**
 * Deterministic (no LLM) intent router: picks which compiled
 * agent should serve a question. Mirrors `classifyClarify`'s shape (a plain
 * regex classifier, no dependencies) so intent routing stays exactly as
 * auditable and replay-safe as the clarify pre-flight — same reason: a
 * question's classification must be reproducible on SSE replay without
 * re-invoking any LLM.
 *
 * This function IS the intent taxonomy — extend the regexes
 * here, don't grow a second classification path elsewhere. Rules, in
 * priority order:
 *
 *  1. Explanation intent ("why", "explain", "what caused/drove/led to",
 *     "reason", "driver", "because") -> "explain_change" (the narrative
 *     bundle agent).
 *  2. Dashboard intent ("dashboard", "chart", "graph", "plot",
 *     "visuali[sz]e", "trend", "over time", "breakdown", "by <dimension>")
 *     -> "generate_dashboard".
 *  3. Everything else -> "answer_query" (the existing default).
 *
 * Explanation is checked first because a question can plausibly match both
 * ("why did revenue trend down over time?") — explaining the driver is the
 * more specific ask.
 *
 * `availableAgentIds` guards against routing to an agent the compiled bundle
 * doesn't actually have (e.g. a profile that never declared
 * `generate_dashboard`): when the rule-matched id isn't present, this falls
 * back to `"answer_query"` — never throws, never returns an unknown id.
 *
 * Returns the chosen `agentId` alongside a short human `reason` for
 * WHY that route was picked — surfaced as the turn's "Route" decision entry in
 * the work log (see `server/turn.ts`). The routing LOGIC is unchanged; the
 * reason is purely a display label.
 */
export interface IntentDecision {
  readonly agentId: string;
  /** Short human label for why this agent was chosen, e.g. `dashboard intent (chart)` or `default → answer_query`. */
  readonly reason: string;
}

export function classifyIntent(question: string, availableAgentIds: readonly string[]): IntentDecision {
  const q = question.trim();

  const explainMatch = q.match(/\b(why|explain|what\s+(?:caused|drove|led to)|reason|driver|because)\b/i);
  const dashboardMatch = q.match(
    /\b(dashboard|chart|graph|plot|visuali[sz]e|trend|over time|breakdown|by\s+(?:region|month|quarter|year|week|day|category|product|customer|segment))\b/i,
  );

  // Exact candidate-selection logic: explanation has priority over dashboard, and
  // a rule-matched id that the bundle lacks falls straight back to answer_query
  // (it does NOT then reconsider a lower-priority rule).
  const candidate = explainMatch ? "explain_change" : dashboardMatch ? "generate_dashboard" : "answer_query";

  if (availableAgentIds.includes(candidate)) {
    if (candidate === "explain_change" && explainMatch) {
      return { agentId: candidate, reason: `explanation intent (${keyword(explainMatch)})` };
    }
    if (candidate === "generate_dashboard" && dashboardMatch) {
      return { agentId: candidate, reason: `dashboard intent (${keyword(dashboardMatch)})` };
    }
    return { agentId: candidate, reason: "default → answer_query" };
  }
  return { agentId: "answer_query", reason: "default → answer_query" };
}

/** The matched intent keyword, lowercased — group 1 when present, else the whole match. */
function keyword(match: RegExpMatchArray): string {
  return (match[1] ?? match[0]).toLowerCase();
}
