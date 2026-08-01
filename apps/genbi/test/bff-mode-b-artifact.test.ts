import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.js";
import { Store } from "../server/db.js";
import type { TurnDeps } from "../server/turn.js";
import type { Bundle, RouteOptions, RouteResult } from "../harness/index.js";
import type { ArtifactDto, SavedEvent } from "../server/wire-types.js";
import { parseSse } from "./bff-sse-helpers.js";

/**
 * Root cause: on Mode B (`backend: "agent-sdk"`), a successful
 * dashboard turn produced a rich answer (`form: "rich"`, a render envelope of
 * kpi_card/chart/table blocks) that rendered inline, but the BFF never
 * persisted an artifact for it — the `artifact` AgentEvent only ever fires on
 * the Mode A `write_artifact` tool path (`harness/loop/executor.ts`). These tests
 * cover `maybeCreateModeBArtifact` (`server/turn.ts`): a Mode B turn routed to
 * an `artifact_write`-capable component (`generate_dashboard`/`explain_change`)
 * must ALSO persist+emit an artifact from its recovered envelope, while a
 * plain `answer_query` rich answer must not.
 */

// Same minimal-but-schema-shaped agent builder as test/bff-intent-routing.test.ts,
// extended with a `capabilities` param so a test can mark an agent artifact-producing.
function agentWithCapabilities(id: string, capabilities: Bundle["agents"][number]["capabilities"]): Bundle["agents"][number] {
  return {
    id,
    verb: id,
    component_type: "analytical",
    realization_kind: "skill",
    trigger: "one_shot",
    outcome: "none",
    steps: [],
    guardrails: {},
    tools: [],
    output_schema: { type: "object", properties: {}, required: [] },
    capabilities,
  };
}

const ARTIFACT_WRITE_CAPABILITY: Bundle["agents"][number]["capabilities"][number] = {
  capability: "artifact_write",
  outcome: "realize-via",
  provided_by: "runtime",
  criticality: "safety-critical",
};

const BUNDLE: Bundle = {
  vercel_bundle_version: "0.1",
  compat: { min_ir_version: "0.3", max_ir_version: "0.3" },
  profile: "genbi-default",
  target: "vercel:headless",
  agents: [
    agentWithCapabilities("answer_query", []),
    agentWithCapabilities("explain_change", [ARTIFACT_WRITE_CAPABILITY]),
    agentWithCapabilities("generate_dashboard", [ARTIFACT_WRITE_CAPABILITY]),
  ],
};

function modeBRoute(finalText: string): (options: RouteOptions) => Promise<RouteResult> {
  return async (): Promise<RouteResult> => ({ backend: "agent-sdk", warnings: [], finalText });
}

function fencedEnvelope(envelope: Record<string, unknown>): string {
  return `Here you go:\n\n\`\`\`json\n${JSON.stringify(envelope)}\n\`\`\`\n`;
}

describe("Mode B dashboard/report turns persist an artifact from the recovered envelope", () => {
  let outDir: string;

  afterEach(() => {
    if (outDir) rmSync(outDir, { recursive: true, force: true });
  });

  function buildDeps(route: TurnDeps["route"]): TurnDeps {
    outDir = mkdtempSync(path.join(tmpdir(), "wren-harness-mode-b-artifact-"));
    const baseRouteOptions: Omit<RouteOptions, "question" | "onEvent"> = {
      authChoice: { mode: "api-key", adapter: "mock" },
      profileSource: "/fixture/profile",
      userProject: "/fixture/project",
      outDir,
    };
    return { store: new Store(":memory:"), route, baseRouteOptions, describeBundle: async () => BUNDLE };
  }

  it("a generate_dashboard turn's rich answer also creates a persisted, publishable 'dashboard' artifact", async () => {
    const envelope = {
      blocks: [
        { type: "kpi_card", label: "Revenue", value: 42000 },
        { type: "chart", chartType: "line", data: [] },
      ],
      summary: "Revenue grew 12% month over month.",
      verified: true,
    };
    const deps = buildDeps(modeBRoute(fencedEnvelope(envelope)));
    const app = createApp(deps);

    const session = (await (await app.request("/api/sessions", { method: "POST", body: "{}" })).json()) as { id: string };
    const { turnId } = (await (
      await app.request(`/api/sessions/${session.id}/turns`, {
        method: "POST",
        body: JSON.stringify({ question: "Show me a dashboard of revenue by month" }),
      })
    ).json()) as { turnId: string };

    const frames = parseSse(await (await app.request(`/api/sessions/${session.id}/stream?turn=${turnId}`)).text());
    // Mode B only knows the answer is artifact-worthy once route() resolves (no
    // native artifact AgentEvent), so the artifact frame trails the worklog
    // frame and leads the terminal answer frame — unlike Mode A's live-onEvent
    // ordering (artifact frame first) covered in bff-artifact-publish.test.ts.
    expect(frames.map((f) => f.event)).toEqual(["worklog", "event", "event", "done"]);
    expect(frames[1]?.data).toMatchObject({ kind: "artifact", artifactKind: "dashboard" });
    expect(frames[2]?.data).toMatchObject({ kind: "answer", answer: { form: "rich", envelope } });

    // A Mode B-created artifact doesn't appear on the Artifacts page until explicitly saved.
    expect((await (await app.request("/api/artifacts")).json()) as ArtifactDto[]).toHaveLength(0);

    const artifactId = (frames[1]?.data as { artifactId: string }).artifactId;
    const artifact = (await (await app.request(`/api/artifacts/${artifactId}`)).json()) as ArtifactDto;
    expect(artifact.sessionId).toBe(session.id);
    expect(artifact.artifactKind).toBe("dashboard");
    // Verified comes from the envelope's own field, never hardcoded —
    // Mode A defaults a freshly-produced artifact to unverified; Mode B doesn't.
    expect(artifact.verified).toBe(true);

    // Self-contained persisted representation: the envelope JSON, verbatim, on disk.
    expect(artifact.location).toBeDefined();
    const location = artifact.location;
    expect(existsSync(location)).toBe(true);
    expect(JSON.parse(readFileSync(location, "utf8"))).toEqual(envelope);
    expect(location.startsWith(path.join(outDir, session.id))).toBe(true);

    await app.request(`/api/sessions/${session.id}/artifacts/${artifactId}/save`, { method: "POST" });
    expect((await (await app.request("/api/artifacts")).json()) as ArtifactDto[]).toHaveLength(1);

    // Publishable via the existing publish route, exactly like a Mode A artifact.
    const publishRes = await app.request(`/api/sessions/${session.id}/artifacts/${artifactId}/publish`, {
      method: "POST",
      body: JSON.stringify({ scope: "public" }),
    });
    expect(publishRes.status).toBe(200);
  });

  it("an explain_change turn's rich answer creates a 'report' artifact (report-type mapping)", async () => {
    const envelope = { blocks: [{ type: "text", text: "Revenue dropped because of churn." }], summary: "Churn drove the drop.", verified: false };
    const deps = buildDeps(modeBRoute(fencedEnvelope(envelope)));
    const app = createApp(deps);

    const session = (await (await app.request("/api/sessions", { method: "POST", body: "{}" })).json()) as { id: string };
    const { turnId } = (await (
      await app.request(`/api/sessions/${session.id}/turns`, { method: "POST", body: JSON.stringify({ question: "Why did revenue drop?" }) })
    ).json()) as { turnId: string };

    const frames = parseSse(await (await app.request(`/api/sessions/${session.id}/stream?turn=${turnId}`)).text());
    const artifactId = (frames.find((f) => f.event === "event" && (f.data as { kind?: string }).kind === "artifact")?.data as { artifactId: string })
      .artifactId;

    // Not listed until saved.
    expect((await (await app.request("/api/artifacts")).json()) as ArtifactDto[]).toHaveLength(0);

    const artifact = (await (await app.request(`/api/artifacts/${artifactId}`)).json()) as ArtifactDto;
    expect(artifact.artifactKind).toBe("report");
    // verified comes straight from the envelope (false here), not defaulted true.
    expect(artifact.verified).toBe(false);

    await app.request(`/api/sessions/${session.id}/artifacts/${artifactId}/save`, { method: "POST" });
    const artifacts = (await (await app.request("/api/artifacts")).json()) as ArtifactDto[];
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.artifactKind).toBe("report");
  });

  it("a plain answer_query rich answer on Mode B does NOT create an artifact", async () => {
    const envelope = { blocks: [{ type: "table", columns: ["month", "total"], rows: [["2024-01", 1000]] }], verified: true };
    const deps = buildDeps(modeBRoute(fencedEnvelope(envelope)));
    const app = createApp(deps);

    const session = (await (await app.request("/api/sessions", { method: "POST", body: "{}" })).json()) as { id: string };
    const { turnId } = (await (
      await app.request(`/api/sessions/${session.id}/turns`, { method: "POST", body: JSON.stringify({ question: "What is total revenue?" }) })
    ).json()) as { turnId: string };

    const frames = parseSse(await (await app.request(`/api/sessions/${session.id}/stream?turn=${turnId}`)).text());
    expect(frames.map((f) => f.event)).toEqual(["worklog", "event", "done"]);
    expect(frames[1]?.data).toMatchObject({ kind: "answer", answer: { form: "rich" } });

    const artifacts = (await (await app.request("/api/artifacts")).json()) as ArtifactDto[];
    expect(artifacts).toHaveLength(0);
  });

  it("a plain-text (non-envelope) Mode B answer does NOT create an artifact, even routed to generate_dashboard", async () => {
    // No JSON envelope recoverable from finalText -> toAnswerOrRefusalEvent falls back to form: "text" -> not "rich" -> no artifact.
    const deps = buildDeps(modeBRoute("Sorry, I could not build that dashboard."));
    const app = createApp(deps);

    const session = (await (await app.request("/api/sessions", { method: "POST", body: "{}" })).json()) as { id: string };
    const { turnId } = (await (
      await app.request(`/api/sessions/${session.id}/turns`, {
        method: "POST",
        body: JSON.stringify({ question: "Show me a dashboard of revenue by month" }),
      })
    ).json()) as { turnId: string };

    const frames = parseSse(await (await app.request(`/api/sessions/${session.id}/stream?turn=${turnId}`)).text());
    expect(frames.map((f) => f.event)).toEqual(["worklog", "event", "done"]);
    expect(frames[1]?.data).toMatchObject({ kind: "answer", answer: { form: "text" } });

    const artifacts = (await (await app.request("/api/artifacts")).json()) as ArtifactDto[];
    expect(artifacts).toHaveLength(0);
  });

  it("replaying an already-resolved turn's stream does not double-create the artifact", async () => {
    const envelope = { blocks: [{ type: "chart", chartType: "bar", data: [] }], summary: "ok", verified: true };
    const deps = buildDeps(modeBRoute(fencedEnvelope(envelope)));
    const app = createApp(deps);

    const session = (await (await app.request("/api/sessions", { method: "POST", body: "{}" })).json()) as { id: string };
    const { turnId } = (await (
      await app.request(`/api/sessions/${session.id}/turns`, {
        method: "POST",
        body: JSON.stringify({ question: "Show me a dashboard of revenue by month" }),
      })
    ).json()) as { turnId: string };

    // First stream: executes the turn and creates the artifact.
    const firstFrames = parseSse(await (await app.request(`/api/sessions/${session.id}/stream?turn=${turnId}`)).text());
    const artifactId = (
      firstFrames.find((f) => f.event === "event" && (f.data as { kind?: string }).kind === "artifact")?.data as { artifactId: string }
    ).artifactId;

    // Save it so we can prove replay doesn't duplicate the (now-listed) artifact row.
    await app.request(`/api/sessions/${session.id}/artifacts/${artifactId}/save`, { method: "POST" });

    // Second stream of the SAME (now-resolved) turn: replays persisted frames, must not re-run route()/re-create.
    const replayFrames = parseSse(await (await app.request(`/api/sessions/${session.id}/stream?turn=${turnId}`)).text());
    expect(replayFrames.some((f) => f.event === "event" && (f.data as { kind?: string }).kind === "artifact")).toBe(true);

    const artifacts = (await (await app.request("/api/artifacts")).json()) as ArtifactDto[];
    expect(artifacts).toHaveLength(1);
  });
});
