import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.js";
import { Store } from "../server/db.js";
import type { TurnDeps } from "../server/turn.js";
import type { RouteOptions, RouteResult } from "../harness/index.js";
import type { ArtifactContentDto, ArtifactDto, SavedEvent, UnsavedEvent } from "../server/wire-types.js";

const BASE_ROUTE_OPTIONS: Omit<RouteOptions, "question" | "onEvent"> = {
  authChoice: { mode: "api-key", adapter: "mock" },
  profileSource: "/fixture/profile",
  userProject: "/fixture/project",
};

/**
 * `POST /api/sessions/:id/artifacts/:artifactId/unsave`, the
 * mirror of the save route covered in `bff-artifact-publish.test.ts`.
 * Unpinning must be fully reversible (row + envelope file kept) and the
 * "saved" state must be recomputed by the frontend from the latest of the
 * saved/unsaved events, never by deleting the earlier `SavedEvent` — these
 * tests exercise the HTTP contract that recomputation relies on.
 */
describe("POST /api/sessions/:id/artifacts/:artifactId/unsave", () => {
  let outDir: string;

  afterEach(() => {
    if (outDir) rmSync(outDir, { recursive: true, force: true });
  });

  function buildApp() {
    outDir = mkdtempSync(path.join(tmpdir(), "wren-harness-artifact-unsave-"));
    const baseRouteOptions: Omit<RouteOptions, "question" | "onEvent"> = { ...BASE_ROUTE_OPTIONS, outDir };
    const route = async (): Promise<RouteResult> => ({
      backend: "agent",
      warnings: [],
      kind: "answer",
      envelope: { blocks: [], summary: "ok" },
      trace: { steps: [] },
    });
    const store = new Store(":memory:");
    const deps: TurnDeps = { store, route, baseRouteOptions };
    return { app: createApp(deps), store };
  }

  it("full cycle: save -> unpin -> re-save, with the row and envelope file kept the whole time", async () => {
    const { app, store } = buildApp();
    const session = (await (await app.request("/api/sessions", { method: "POST", body: "{}" })).json()) as { id: string };

    const sessionDir = path.join(outDir, session.id);
    mkdirSync(sessionDir, { recursive: true });
    const location = path.join(sessionDir, "revenue.json");
    const envelope = { blocks: [{ type: "kpi_card", label: "Revenue", value: 1 }], summary: "ok", verified: true };
    writeFileSync(location, JSON.stringify(envelope), "utf-8");
    const artifact = store.createArtifact({ sessionId: session.id, name: "Revenue Dashboard", kind: "dashboard", location, verified: true });

    // Not yet saved: absent from the Artifacts page list.
    expect((await (await app.request("/api/artifacts")).json()) as ArtifactDto[]).toHaveLength(0);

    const saved = (await (
      await app.request(`/api/sessions/${session.id}/artifacts/${artifact.id}/save`, { method: "POST" })
    ).json()) as SavedEvent;
    expect(saved.kind).toBe("saved");
    expect((await (await app.request("/api/artifacts")).json()) as ArtifactDto[]).toHaveLength(1);

    // Unpin: the artifact leaves the Artifacts page list...
    const unsaveRes = await app.request(`/api/sessions/${session.id}/artifacts/${artifact.id}/unsave`, { method: "POST" });
    expect(unsaveRes.status).toBe(200);
    const unsaved = (await unsaveRes.json()) as UnsavedEvent;
    expect(unsaved.kind).toBe("unsaved");
    expect(unsaved.artifactId).toBe(artifact.id);
    expect(unsaved.artifactName).toBe("Revenue Dashboard");
    expect((await (await app.request("/api/artifacts")).json()) as ArtifactDto[]).toHaveLength(0);

    // ...but the row (unfiltered lookup) and its envelope file are untouched.
    const afterUnsave = (await (await app.request(`/api/artifacts/${artifact.id}`)).json()) as ArtifactDto;
    expect(afterUnsave.id).toBe(artifact.id);
    expect(afterUnsave.savedAt).toBeUndefined();
    const content = (await (await app.request(`/api/artifacts/${artifact.id}/content`)).json()) as ArtifactContentDto;
    expect(content).toEqual({ form: "envelope", envelope });

    // The event log kept both events — nothing was deleted from it.
    const events = store.listEventsForSession(session.id).map((e) => e.payload.kind);
    expect(events).toContain("saved");
    expect(events).toContain("unsaved");

    // Re-save succeeds with a brand-new savedAt (the artifact is genuinely re-saveable).
    const resaved = (await (
      await app.request(`/api/sessions/${session.id}/artifacts/${artifact.id}/save`, { method: "POST" })
    ).json()) as SavedEvent;
    expect(resaved.kind).toBe("saved");
    expect(resaved.savedAt).not.toBe(saved.savedAt);
    expect((await (await app.request("/api/artifacts")).json()) as ArtifactDto[]).toHaveLength(1);
  });

  it("is idempotent: unsaving an already-unsaved artifact is a no-op — no error, no duplicate event", async () => {
    const { app, store } = buildApp();
    const session = (await (await app.request("/api/sessions", { method: "POST", body: "{}" })).json()) as { id: string };
    const artifact = store.createArtifact({ sessionId: session.id, name: "Chart", kind: "chart", location: "artifacts/chart.json", verified: false });

    await app.request(`/api/sessions/${session.id}/artifacts/${artifact.id}/save`, { method: "POST" });

    const first = await app.request(`/api/sessions/${session.id}/artifacts/${artifact.id}/unsave`, { method: "POST" });
    expect(first.status).toBe(200);
    const second = await app.request(`/api/sessions/${session.id}/artifacts/${artifact.id}/unsave`, { method: "POST" });
    expect(second.status).toBe(200);
    const third = await app.request(`/api/sessions/${session.id}/artifacts/${artifact.id}/unsave`, { method: "POST" });
    expect(third.status).toBe(200);

    const unsavedEvents = store.listEventsForSession(session.id).filter((e) => e.payload.kind === "unsaved");
    expect(unsavedEvents).toHaveLength(1);
  });

  it("unsaving a never-saved artifact is a no-op — no error, no event appended", async () => {
    const { app, store } = buildApp();
    const session = (await (await app.request("/api/sessions", { method: "POST", body: "{}" })).json()) as { id: string };
    const artifact = store.createArtifact({ sessionId: session.id, name: "Report", kind: "report", location: "artifacts/report.json", verified: false });

    const res = await app.request(`/api/sessions/${session.id}/artifacts/${artifact.id}/unsave`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as UnsavedEvent;
    expect(body.kind).toBe("unsaved");

    expect(store.listEventsForSession(session.id)).toHaveLength(0);
    expect((await (await app.request("/api/artifacts")).json()) as ArtifactDto[]).toHaveLength(0);
  });

  it("unpinning one of two same-named artifacts in a session does not affect the other (keyed on artifactId, not name)", async () => {
    const { app, store } = buildApp();
    const session = (await (await app.request("/api/sessions", { method: "POST", body: "{}" })).json()) as { id: string };
    const first = store.createArtifact({ sessionId: session.id, name: "Revenue Dashboard", kind: "dashboard", location: "artifacts/revenue-1.json", verified: false });
    const second = store.createArtifact({ sessionId: session.id, name: "Revenue Dashboard", kind: "dashboard", location: "artifacts/revenue-2.json", verified: false });

    await app.request(`/api/sessions/${session.id}/artifacts/${first.id}/save`, { method: "POST" });
    await app.request(`/api/sessions/${session.id}/artifacts/${second.id}/save`, { method: "POST" });
    expect((await (await app.request("/api/artifacts")).json()) as ArtifactDto[]).toHaveLength(2);

    // Unpin only the first — the same-named second one must stay saved.
    await app.request(`/api/sessions/${session.id}/artifacts/${first.id}/unsave`, { method: "POST" });
    const listed = (await (await app.request("/api/artifacts")).json()) as ArtifactDto[];
    expect(listed.map((a) => a.id)).toEqual([second.id]);

    // Unpin the second independently.
    await app.request(`/api/sessions/${session.id}/artifacts/${second.id}/unsave`, { method: "POST" });
    expect((await (await app.request("/api/artifacts")).json()) as ArtifactDto[]).toHaveLength(0);
  });

  it("404s unsaving an unknown artifact, and an artifact from a different session", async () => {
    const { app, store } = buildApp();
    const sessionA = (await (await app.request("/api/sessions", { method: "POST", body: "{}" })).json()) as { id: string };
    const sessionB = (await (await app.request("/api/sessions", { method: "POST", body: "{}" })).json()) as { id: string };

    expect((await app.request(`/api/sessions/${sessionA.id}/artifacts/does-not-exist/unsave`, { method: "POST" })).status).toBe(404);

    const artifactA = store.createArtifact({ sessionId: sessionA.id, name: "A's dashboard", kind: "dashboard", location: "artifacts/a.json", verified: false });
    expect((await app.request(`/api/sessions/${sessionB.id}/artifacts/${artifactA.id}/unsave`, { method: "POST" })).status).toBe(404);
  });
});
