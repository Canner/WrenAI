import { describe, expect, it } from "vitest";
import { classifyIntent } from "../server/route-intent.js";

const ALL_AGENTS = ["explore_model", "answer_query", "generate_dashboard", "explain_change"] as const;

describe("classifyIntent (deterministic intent router)", () => {
  it.each([
    "Why did revenue drop last quarter?",
    "Can you explain the change in churn?",
    "What caused the spike in signups?",
    "What drove the increase in refunds?",
    "What led to this outcome?",
    "What's the reason for the dip?",
    "What was the driver behind this?",
    "Revenue fell because of what?",
  ])("routes explanation intent to explain_change: %s", (question) => {
    expect(classifyIntent(question, ALL_AGENTS).agentId).toBe("explain_change");
  });

  it.each([
    "Build me a dashboard of revenue",
    "Show a chart of orders",
    "Plot the trend over time",
    "Graph monthly signups",
    "Visualize customer growth",
    "Visualise customer growth",
    "Give me a breakdown of sales",
    "Revenue by region",
    "Orders by month",
  ])("routes dashboard intent to generate_dashboard: %s", (question) => {
    expect(classifyIntent(question, ALL_AGENTS).agentId).toBe("generate_dashboard");
  });

  it.each(["What is total revenue?", "Who is our top customer?", "List all orders from last week"])(
    "defaults to answer_query for a plain question: %s",
    (question) => {
      expect(classifyIntent(question, ALL_AGENTS).agentId).toBe("answer_query");
    },
  );

  it("prefers explanation over dashboard when a question matches both", () => {
    expect(classifyIntent("Why did revenue trend down over time?", ALL_AGENTS).agentId).toBe("explain_change");
  });

  it("falls back to answer_query when the rule-matched agent isn't in the bundle", () => {
    expect(classifyIntent("Why did revenue drop?", ["answer_query"]).agentId).toBe("answer_query");
    expect(classifyIntent("Show me a dashboard", ["answer_query"]).agentId).toBe("answer_query");
  });

  it("falls back to answer_query when availableAgentIds is empty", () => {
    expect(classifyIntent("Why did revenue drop?", []).agentId).toBe("answer_query");
  });

  it("is case-insensitive", () => {
    expect(classifyIntent("WHY did revenue drop?", ALL_AGENTS).agentId).toBe("explain_change");
    expect(classifyIntent("SHOW ME A DASHBOARD", ALL_AGENTS).agentId).toBe("generate_dashboard");
  });

  // Every classification also carries a short human `reason` for WHY
  // that route was chosen — surfaced as the turn's "Route" decision entry.
  describe("reason", () => {
    it("labels an explanation route and names the matched keyword", () => {
      const { agentId, reason } = classifyIntent("Why did revenue drop?", ALL_AGENTS);
      expect(agentId).toBe("explain_change");
      expect(reason).toBe("explanation intent (why)");
    });

    it("labels a dashboard route and names the matched keyword", () => {
      const { agentId, reason } = classifyIntent("Show me a chart of revenue", ALL_AGENTS);
      expect(agentId).toBe("generate_dashboard");
      expect(reason).toBe("dashboard intent (chart)");
    });

    it("labels the plain default route", () => {
      expect(classifyIntent("What is total revenue?", ALL_AGENTS).reason).toBe("default → answer_query");
    });

    it("labels the fallback (rule matched, but agent not in the bundle) as the default route", () => {
      expect(classifyIntent("Show me a dashboard", ["answer_query"]).reason).toBe("default → answer_query");
    });

    it("lowercases the matched keyword regardless of question casing", () => {
      expect(classifyIntent("WHY did revenue drop?", ALL_AGENTS).reason).toBe("explanation intent (why)");
    });
  });
});
