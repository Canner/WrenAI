/**
 * Proves the same-origin SPA fallback (`server/spa.ts`) does what it claims:
 *
 *  - with `deps.staticDir` wired, the REAL `createApp` app still serves
 *    every `/api/*` route, including the SSE stream — proven by actually
 *    receiving frame *payloads*, not just a 200/connection (a shadowed SSE
 *    route "connects" but never streams, so a status-only check is blind
 *    to that regression);
 *  - a missing `/assets/*` file 404s instead of falling back to `index.html`;
 *  - with no `staticDir` (the normal dev/test case), behavior is byte-for-byte
 *    what every other BFF test already exercises — `createApp` never even
 *    imports/calls `mountSpaFallback` in that path;
 *  - the SSE assertion above is falsifiable: `it.fails` reruns the same
 *    stream request against a minimal harness that mounts the real,
 *    exported `mountSpaFallback` *before* registering an SSE route (the
 *    mistake `server/app.ts`'s mount-last comment warns against), and the
 *    wrapped test is required to fail. `createApp` itself has no way to
 *    mis-order its one, fixed call to `mountSpaFallback`, so this harness
 *    exists solely to demonstrate the failure mode on the real function;
 *    it does not stand in for the AC #2 proof above, which runs against
 *    the real app.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { createApp } from "../server/app.js";
import { mountSpaFallback } from "../server/spa.js";
import { Store } from "../server/db.js";
import type { TurnDeps } from "../server/turn.js";
import type { RouteOptions, RouteResult } from "../harness/index.js";
import { parseSse } from "./bff-sse-helpers.js";

const BASE_ROUTE_OPTIONS: Omit<RouteOptions, "question" | "onEvent"> = {
  authChoice: { mode: "api-key", adapter: "mock" },
  profileSource: "/fixture/profile",
  userProject: "/fixture/project",
};

function richAnswerRoute(): (options: RouteOptions) => Promise<RouteResult> {
  return async (): Promise<RouteResult> => ({
    backend: "agent",
    warnings: [],
    kind: "answer",
    envelope: { blocks: [{ type: "text", text: "Total revenue is $42." }], summary: "Total revenue is $42." },
    trace: { steps: [{ id: "step-1", tool: "query", outcome: "success", ordinal: 0 }] },
  });
}

let staticDir: string;

beforeEach(() => {
  staticDir = mkdtempSync(path.join(tmpdir(), "genbi-spa-fallback-test-"));
  mkdirSync(path.join(staticDir, "assets"));
  writeFileSync(path.join(staticDir, "index.html"), "<!doctype html><html><body>spa-shell</body></html>");
  writeFileSync(path.join(staticDir, "assets", "app.abc123.js"), "console.log('built asset');");
});

afterEach(() => {
  rmSync(staticDir, { recursive: true, force: true });
});

describe("SPA fallback mounted on the real app (deps.staticDir wired)", () => {
  it("AC1/AC2: still serves the SSE stream end-to-end (actual event payloads, not just status)", async () => {
    const deps: TurnDeps = { store: new Store(":memory:"), route: richAnswerRoute(), baseRouteOptions: BASE_ROUTE_OPTIONS, staticDir };
    const app = createApp(deps);

    const createRes = await app.request("/api/sessions", { method: "POST", body: JSON.stringify({ title: "Revenue" }) });
    expect(createRes.status).toBe(201);
    const session = (await createRes.json()) as { id: string };

    const turnRes = await app.request(`/api/sessions/${session.id}/turns`, {
      method: "POST",
      body: JSON.stringify({ question: "What is total revenue?" }),
    });
    expect(turnRes.status).toBe(200);
    const { turnId } = (await turnRes.json()) as { turnId: string };

    const streamRes = await app.request(`/api/sessions/${session.id}/stream?turn=${turnId}`);
    expect(streamRes.status).toBe(200);
    const frames = parseSse(await streamRes.text());

    // The actual payloads, not merely that the connection returned 200 — a
    // shadowed route degrades to zero frames while still "succeeding" at
    // the transport level, which this assertion would catch (see the
    // falsifiability test below for direct proof of that).
    expect(frames.map((f) => f.event)).toEqual(["worklog", "event", "done"]);
    expect(frames[1]?.data).toMatchObject({ kind: "answer", answer: { form: "rich" } });
  });

  it("AC1: serves the built SPA shell for a client-side route", async () => {
    const deps: TurnDeps = { store: new Store(":memory:"), route: richAnswerRoute(), baseRouteOptions: BASE_ROUTE_OPTIONS, staticDir };
    const app = createApp(deps);

    const res = await app.request("/sessions/ask/some-session-id");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(await res.text()).toContain("spa-shell");
  });

  it("AC3: a missing built asset 404s instead of falling back to index.html", async () => {
    const deps: TurnDeps = { store: new Store(":memory:"), route: richAnswerRoute(), baseRouteOptions: BASE_ROUTE_OPTIONS, staticDir };
    const app = createApp(deps);

    const res = await app.request("/assets/nope.js");
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("spa-shell");
  });

  it("never lets the fallback shadow an unknown /api/* route either", async () => {
    const deps: TurnDeps = { store: new Store(":memory:"), route: richAnswerRoute(), baseRouteOptions: BASE_ROUTE_OPTIONS, staticDir };
    const app = createApp(deps);

    const res = await app.request("/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("spa-shell");
  });
});

describe("AC4: no deps.staticDir (today's dev/test shape) is unaffected", () => {
  it("does not mount the SPA fallback at all — unmatched routes get Hono's plain 404, not index.html or a static 404 body", async () => {
    const deps: TurnDeps = { store: new Store(":memory:"), route: richAnswerRoute(), baseRouteOptions: BASE_ROUTE_OPTIONS };
    const app = createApp(deps);

    const res = await app.request("/sessions/ask/some-session-id");
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("spa-shell");
  });

  it("existing API routes are unaffected", async () => {
    const deps: TurnDeps = { store: new Store(":memory:"), route: richAnswerRoute(), baseRouteOptions: BASE_ROUTE_OPTIONS };
    const app = createApp(deps);
    const res = await app.request("/api/sessions", { method: "POST", body: JSON.stringify({ title: "x" }) });
    expect(res.status).toBe(201);
  });
});

/**
 * Minimal harness reproducing the real `/api/sessions/:id/stream` route's
 * shape (a `streamSSE` handler emitting a single frame) so the falsifiability
 * test below can register it in either order around the real, exported
 * `mountSpaFallback` — something `createApp` itself cannot be made to do,
 * since it only ever calls `mountSpaFallback` once, in the fixed, correct
 * (last) position.
 */
function registerFakeSseRoute(app: Hono): void {
  app.get("/api/sessions/:id/stream", (c) => {
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ event: "message", data: JSON.stringify({ hello: "world" }) });
    });
  });
}

async function assertSseFrameReceived(app: Hono): Promise<void> {
  const res = await app.request("/api/sessions/s1/stream");
  const frames = parseSse(await res.text());
  expect(frames.map((f) => f.event)).toEqual(["message"]);
  expect(frames[0]?.data).toEqual({ hello: "world" });
}

describe("falsifiability: the SSE assertion technique above actually detects a shadowed route", () => {
  it("passes when mountSpaFallback runs after the SSE route (server/app.ts's real order)", async () => {
    const app = new Hono();
    registerFakeSseRoute(app);
    mountSpaFallback(app, staticDir);
    await assertSseFrameReceived(app);
  });

  // Required by the work packet: a test that cannot be made to fail is not
  // evidence. `it.fails` inverts the usual contract — this wrapped test MUST
  // fail (mountSpaFallback's catch-all, registered first, wins the route
  // match and the request never reaches the SSE handler), and `it.fails`
  // itself only passes because that failure happened.
  it.fails("fails when mountSpaFallback runs before the SSE route (the mistake the mount-last comment warns against)", async () => {
    const app = new Hono();
    mountSpaFallback(app, staticDir);
    registerFakeSseRoute(app);
    await assertSseFrameReceived(app);
  });
});
