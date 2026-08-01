import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.js";
import { Store } from "../server/db.js";
import type { TurnDeps } from "../server/turn.js";
import type { RouteOptions } from "../harness/index.js";
import type { ArtifactContentDto } from "../server/wire-types.js";

/**
 * Wires `resolveArtifactContent` (see `test/artifact-content.test.ts`
 * for its own unit coverage) through `GET /api/artifacts/:id/content`: the
 * route resolves each artifact's `location` against the same root Mode A/B
 * write to, and degrades to `form: "unavailable"` — never a thrown error —
 * for anything it can't honestly serve.
 */
describe("GET /api/artifacts/:id/content", () => {
  let outDir: string;

  afterEach(() => {
    if (outDir) rmSync(outDir, { recursive: true, force: true });
  });

  function buildApp() {
    outDir = mkdtempSync(path.join(tmpdir(), "wren-harness-artifact-content-route-"));
    const baseRouteOptions: Omit<RouteOptions, "question" | "onEvent"> = {
      authChoice: { mode: "api-key", adapter: "mock" },
      profileSource: "/fixture/profile",
      userProject: "/fixture/project",
      outDir,
    };
    const store = new Store(":memory:");
    const deps: TurnDeps = { store, route: async () => ({ backend: "agent-sdk", warnings: [], finalText: "" }), baseRouteOptions };
    return { app: createApp(deps), store };
  }

  it("404s for an unknown artifact id, same as GET /api/artifacts/:id", async () => {
    const { app } = buildApp();
    const res = await app.request("/api/artifacts/does-not-exist/content");
    expect(res.status).toBe(404);
  });

  it("returns form: 'envelope' for a Mode B artifact whose location holds envelope-shaped JSON", async () => {
    const { app, store } = buildApp();
    const session = store.createSession("s");
    const envelope = { blocks: [{ type: "kpi_card", label: "Revenue", value: 42000 }], summary: "ok", verified: true };
    const sessionDir = path.join(outDir, session.id);
    mkdirSync(sessionDir, { recursive: true });
    const location = path.join(sessionDir, "dashboard-turn-1.json");
    writeFileSync(location, JSON.stringify(envelope), "utf-8");
    const artifact = store.createArtifact({ sessionId: session.id, name: "dashboard-turn-1.json", kind: "dashboard", location, verified: true });

    const res = await app.request(`/api/artifacts/${artifact.id}/content`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ form: "envelope", envelope } satisfies ArtifactContentDto);
  });

  it("returns form: 'text' for a Mode A artifact whose location holds non-envelope content", async () => {
    const { app, store } = buildApp();
    const session = store.createSession("s");
    const location = path.join(outDir, "report.html");
    writeFileSync(location, "<h1>Report</h1>", "utf-8");
    const artifact = store.createArtifact({ sessionId: session.id, name: "report.html", kind: "report", location, verified: false });

    const res = await app.request(`/api/artifacts/${artifact.id}/content`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ form: "text", text: "<h1>Report</h1>", truncated: false } satisfies ArtifactContentDto);
  });

  it("resolves a relative location against the artifacts root, matching Mode A's write_artifact convention", async () => {
    const { app, store } = buildApp();
    const session = store.createSession("s");
    writeFileSync(path.join(outDir, "chart.json"), JSON.stringify({ blocks: [{ type: "chart" }] }), "utf-8");
    // Mode A's executor persists the raw (possibly relative) path the model
    // supplied to `write_artifact` — see `harness/loop/executor.ts`.
    const artifact = store.createArtifact({ sessionId: session.id, name: "chart.json", kind: "chart", location: "chart.json", verified: false });

    const res = await app.request(`/api/artifacts/${artifact.id}/content`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ form: "envelope", envelope: { blocks: [{ type: "chart" }] } });
  });

  it("degrades to form: 'unavailable' (never a 5xx) when the persisted file no longer exists on disk", async () => {
    const { app, store } = buildApp();
    const session = store.createSession("s");
    const artifact = store.createArtifact({
      sessionId: session.id,
      name: "gone.json",
      kind: "chart",
      location: path.join(outDir, "gone.json"),
      verified: false,
    });

    const res = await app.request(`/api/artifacts/${artifact.id}/content`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ form: "unavailable", reason: "missing" } satisfies ArtifactContentDto);
  });

  it("degrades to form: 'unavailable', reason 'outside_root' for a location that has drifted outside the artifacts root — never a 5xx, never the file's content", async () => {
    const { app, store } = buildApp();
    const session = store.createSession("s");
    // Simulates root drift (a differently-configured outDir since the artifact
    // was written) or a tampered DB row — either way, refused, not served.
    const outsideDir = mkdtempSync(path.join(tmpdir(), "wren-harness-artifact-content-route-outside-"));
    try {
      const outsideFile = path.join(outsideDir, "secret.json");
      writeFileSync(outsideFile, JSON.stringify({ blocks: [], secret: "do-not-leak" }), "utf-8");
      const artifact = store.createArtifact({ sessionId: session.id, name: "secret.json", kind: "chart", location: outsideFile, verified: false });

      const res = await app.request(`/api/artifacts/${artifact.id}/content`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as ArtifactContentDto;
      expect(body).toEqual({ form: "unavailable", reason: "outside_root" });
      expect(JSON.stringify(body)).not.toContain("do-not-leak");
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("leaves GET /api/artifacts and GET /api/artifacts/:id metadata-only and unchanged", async () => {
    const { app, store } = buildApp();
    const session = store.createSession("s");
    const location = path.join(outDir, "dashboard.json");
    writeFileSync(location, JSON.stringify({ blocks: [] }), "utf-8");
    const artifact = store.createArtifact({ sessionId: session.id, name: "dashboard.json", kind: "dashboard", location, verified: true });
    // GET /api/artifacts only lists saved artifacts.
    store.saveArtifact(artifact.id);

    const listRes = await app.request("/api/artifacts");
    const list = (await listRes.json()) as Array<Record<string, unknown>>;
    expect(list).toHaveLength(1);
    expect(list[0]).not.toHaveProperty("content");
    expect(list[0]).not.toHaveProperty("envelope");

    const detailRes = await app.request(`/api/artifacts/${artifact.id}`);
    const detail = (await detailRes.json()) as Record<string, unknown>;
    expect(detail).not.toHaveProperty("content");
    expect(detail).not.toHaveProperty("envelope");
  });
});
