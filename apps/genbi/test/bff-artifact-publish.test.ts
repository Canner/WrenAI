import { describe, expect, it } from "vitest";
import { createApp } from "../server/app.js";
import { Store } from "../server/db.js";
import type { TurnDeps } from "../server/turn.js";
import type { ArtifactAgentEvent, RouteOptions, RouteResult } from "../harness/index.js";
import type { ArtifactDto, PublishedEvent, SavedEvent } from "../server/wire-types.js";
import { parseSse } from "./bff-sse-helpers.js";

const BASE_ROUTE_OPTIONS: Omit<RouteOptions, "question" | "onEvent"> = {
  authChoice: { mode: "api-key", adapter: "mock" },
  profileSource: "/fixture/profile",
  userProject: "/fixture/project",
};

describe("artifact creation (mid-run onEvent) and publish flow", () => {
  it("persists an unverified artifact and emits its event frame before the final answer, then publishes it", async () => {
    const route = async (options: RouteOptions): Promise<RouteResult> => {
      const artifactEvent: ArtifactAgentEvent = {
        kind: "artifact",
        runId: "run-1",
        seq: 1,
        name: "Revenue Dashboard",
        artifactKind: "dashboard",
        location: "artifacts/revenue.json",
      };
      options.onEvent?.(artifactEvent);
      return {
        backend: "agent",
        warnings: [],
        kind: "answer",
        envelope: { blocks: [], summary: "Here is your dashboard." },
        trace: { steps: [] },
      };
    };
    const deps: TurnDeps = { store: new Store(":memory:"), route, baseRouteOptions: BASE_ROUTE_OPTIONS };
    const app = createApp(deps);

    const session = (await (await app.request("/api/sessions", { method: "POST", body: "{}" })).json()) as { id: string };
    const turn = (await (
      await app.request(`/api/sessions/${session.id}/turns`, { method: "POST", body: JSON.stringify({ question: "Build me a revenue dashboard" }) })
    ).json()) as { turnId: string };

    const frames = parseSse(await (await app.request(`/api/sessions/${session.id}/stream?turn=${turn.turnId}`)).text());
    expect(frames.map((f) => f.event)).toEqual(["event", "worklog", "event", "done"]);
    expect(frames[0]?.data).toMatchObject({ kind: "artifact", name: "Revenue Dashboard", artifactKind: "dashboard", location: "artifacts/revenue.json" });

    // An auto-created artifact does not appear on the Artifacts page until explicitly saved.
    expect((await (await app.request("/api/artifacts")).json()) as ArtifactDto[]).toHaveLength(0);

    // The emitted ArtifactEvent carries the real persisted artifact row id (distinct from its generic `evt-*` id) —
    // fetch its metadata via the unfiltered single-artifact route, which stays reachable before saving.
    const artifactId = (frames[0]?.data as { artifactId: string }).artifactId;
    expect((frames[0]?.data as { id: string }).id).not.toBe(artifactId);
    const artifact = (await (await app.request(`/api/artifacts/${artifactId}`)).json()) as ArtifactDto;
    expect(artifact.verified).toBe(false);
    expect(artifact.sessionId).toBe(session.id);
    expect(artifact.published).toBeUndefined();
    expect(artifact.savedAt).toBeUndefined();

    const saveRes = await app.request(`/api/sessions/${session.id}/artifacts/${artifactId}/save`, { method: "POST" });
    expect(saveRes.status).toBe(200);
    const saved = (await saveRes.json()) as SavedEvent;
    expect(saved.kind).toBe("saved");
    expect(saved.artifactId).toBe(artifactId);
    expect(saved.artifactName).toBe("Revenue Dashboard");

    const savedArtifacts = (await (await app.request("/api/artifacts")).json()) as ArtifactDto[];
    expect(savedArtifacts).toHaveLength(1);
    expect(savedArtifacts[0]?.id).toBe(artifactId);
    expect(savedArtifacts[0]?.savedAt).toBe(saved.savedAt);

    // Repeat save is idempotent: it doesn't error and doesn't overwrite the original savedAt.
    const resave = (await (await app.request(`/api/sessions/${session.id}/artifacts/${artifactId}/save`, { method: "POST" })).json()) as SavedEvent;
    expect(resave.savedAt).toBe(saved.savedAt);
    expect((await (await app.request("/api/artifacts")).json()) as ArtifactDto[]).toHaveLength(1);

    const publishRes = await app.request(`/api/sessions/${session.id}/artifacts/${artifactId}/publish`, {
      method: "POST",
      body: JSON.stringify({ scope: "public" }),
    });
    expect(publishRes.status).toBe(200);
    const published = (await publishRes.json()) as PublishedEvent;
    expect(published.kind).toBe("published");
    expect(published.scope).toBe("public");
    expect(published.link).toBe(`https://share.genbi.example/${artifactId}`);

    const republished = (await (await app.request(`/api/artifacts/${artifactId}`)).json()) as ArtifactDto;
    expect(republished.published).toEqual({ link: published.link, scope: "public" });
  });

  it("saving one of two same-named artifacts in a session does not mark the other as saved (SavedEvent keys on artifactId, not name)", async () => {
    const deps: TurnDeps = {
      store: new Store(":memory:"),
      route: async (): Promise<RouteResult> => ({ backend: "agent", warnings: [], kind: "answer", envelope: { blocks: [], summary: "ok" }, trace: { steps: [] } }),
      baseRouteOptions: BASE_ROUTE_OPTIONS,
    };
    const app = createApp(deps);

    const session = (await (await app.request("/api/sessions", { method: "POST", body: "{}" })).json()) as { id: string };
    // Re-running the same prompt twice produces two distinct artifact rows that share a name.
    const first = deps.store.createArtifact({ sessionId: session.id, name: "Revenue Dashboard", kind: "dashboard", location: "artifacts/revenue-1.json", verified: false });
    const second = deps.store.createArtifact({ sessionId: session.id, name: "Revenue Dashboard", kind: "dashboard", location: "artifacts/revenue-2.json", verified: false });
    expect(first.id).not.toBe(second.id);

    const saved = (await (
      await app.request(`/api/sessions/${session.id}/artifacts/${first.id}/save`, { method: "POST" })
    ).json()) as SavedEvent;
    expect(saved.artifactId).toBe(first.id);

    // Only the saved row is listed — the never-saved, same-named sibling stays off the Artifacts page
    // and, crucially, remains saveable (this is the bug: a name-keyed SavedEvent would make the
    // frontend render it as already-"Saved" with no way to trigger a real save for it).
    const listed = (await (await app.request("/api/artifacts")).json()) as ArtifactDto[];
    expect(listed.map((a) => a.id)).toEqual([first.id]);

    const secondSaved = (await (
      await app.request(`/api/sessions/${session.id}/artifacts/${second.id}/save`, { method: "POST" })
    ).json()) as SavedEvent;
    expect(secondSaved.artifactId).toBe(second.id);
    expect((await (await app.request("/api/artifacts")).json()) as ArtifactDto[]).toHaveLength(2);
  });

  it("404s publishing an unknown artifact, and an artifact from a different session", async () => {
    const route = async (): Promise<RouteResult> => ({
      backend: "agent",
      warnings: [],
      kind: "answer",
      envelope: { blocks: [], summary: "ok" },
      trace: { steps: [] },
    });
    const deps: TurnDeps = { store: new Store(":memory:"), route, baseRouteOptions: BASE_ROUTE_OPTIONS };
    const app = createApp(deps);

    const sessionA = (await (await app.request("/api/sessions", { method: "POST", body: "{}" })).json()) as { id: string };
    const sessionB = (await (await app.request("/api/sessions", { method: "POST", body: "{}" })).json()) as { id: string };

    expect((await app.request(`/api/sessions/${sessionA.id}/artifacts/does-not-exist/publish`, { method: "POST", body: "{}" })).status).toBe(404);

    const artifactA = deps.store.createArtifact({ sessionId: sessionA.id, name: "A's dashboard", kind: "dashboard", location: "artifacts/a.json", verified: false });

    // Publishing artifact A through session B's route must 404 — the artifact doesn't belong to that session.
    expect((await app.request(`/api/sessions/${sessionB.id}/artifacts/${artifactA.id}/publish`, { method: "POST", body: "{}" })).status).toBe(404);
  });
});
