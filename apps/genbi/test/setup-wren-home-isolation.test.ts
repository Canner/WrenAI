import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Route-level regression tests for the setup wizard's core bug: `POST /api/setup/connect`
// used to leave `wren profile add` free to write into the operator's
// REAL global `~/.wren/profiles.yml` and flip their global `active:` pointer, since nothing in
// this BFF ever pointed a bootstrap-mode boot's `WREN_HOME` at the throwaway workspace. These
// tests use the real `createSetWrenHomeForSetupMode` (not a mock) wired exactly as
// `server/bin.ts` wires it, so they exercise the actual production logic end to end at the
// route level, plus a byte-for-byte check that a real "global profiles.yml" file is untouched.
//
// verifyAdoptProject/runSetProfile/adoptWithChosenProfile are mocked here for the same reason
// test/bff-setup-adopt.test.ts mocks them: they're already unit-tested against a real execFile
// mock in test/adopt.test.ts. This file is only concerned with WREN_HOME isolation.
const verifyAdoptProjectMock = vi.fn<(typeof import("../server/adopt.js"))["verifyAdoptProject"]>();
vi.mock("../server/adopt.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/adopt.js")>();
  return {
    ...actual,
    verifyAdoptProject: (...args: unknown[]) => (verifyAdoptProjectMock as (...a: unknown[]) => unknown)(...args),
  };
});

const { createApp } = await import("../server/app.js");
const { Store } = await import("../server/db.js");
const { createSetWrenHomeForSetupMode } = await import("../server/wren-home.js");

const BASE_ROUTE_OPTIONS = {
  authChoice: { mode: "api-key" as const, adapter: "mock" },
  profileSource: "/fixture/profile",
  userProject: "/fixture/project",
};

describe("setup wizard WREN_HOME isolation", () => {
  let workspaceRoot: string;
  let globalWrenHome: string;
  let globalProfilesPath: string;
  const GLOBAL_PROFILES_SEED = "active: acme-prod\nprofiles:\n  acme-prod:\n    datasource: postgres\n    host: prod.internal\n";
  let savedWrenHome: string | undefined;

  beforeEach(() => {
    workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-wren-home-test-"));
    globalWrenHome = mkdtempSync(path.join(tmpdir(), "wren-harness-global-wren-home-"));
    globalProfilesPath = path.join(globalWrenHome, "profiles.yml");
    writeFileSync(globalProfilesPath, GLOBAL_PROFILES_SEED);

    // Simulate the operator's real environment: WREN_HOME already points at their real
    // ~/.wren-equivalent (a temp stand-in here, never the developer's actual home directory)
    // before this BFF process boots.
    savedWrenHome = process.env["WREN_HOME"];
    process.env["WREN_HOME"] = globalWrenHome;

    verifyAdoptProjectMock.mockReset();
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(globalWrenHome, { recursive: true, force: true });
    if (savedWrenHome === undefined) delete process.env["WREN_HOME"];
    else process.env["WREN_HOME"] = savedWrenHome;
  });

  function buildApp() {
    // Mirrors exactly what server/bin.ts does at boot: capture the baseline WREN_HOME once,
    // before any route can mutate it, then build the setter from it.
    const originalWrenHome = process.env["WREN_HOME"];
    const setWrenHomeForSetupMode = createSetWrenHomeForSetupMode(workspaceRoot, originalWrenHome);
    const store = new Store(":memory:");
    const setupRunner = { run: async () => ({ finalText: "SETUP_STATUS: ok" }) };
    const deps = {
      store,
      route: async () => ({ backend: "agent" as const, warnings: [], kind: "answer" as const, envelope: { blocks: [], summary: "ok" }, trace: { steps: [] } }),
      baseRouteOptions: BASE_ROUTE_OPTIONS,
      setupRunner,
      workspaceRoot,
      setWrenHomeForSetupMode,
      bindProject: vi.fn(),
      unbindProject: vi.fn(),
    };
    const app = createApp(deps as Parameters<typeof createApp>[0]);
    return { app, store };
  }

  // Before this fix, POST /api/setup/connect never touched process.env.WREN_HOME at all, so
  // this assertion would have failed — process.env.WREN_HOME would still equal `globalWrenHome`,
  // and a real `wren profile add` invocation during this turn would have targeted the operator's
  // actual global profiles.yml.
  it("POST /api/setup/connect anchors WREN_HOME to the workspace and never touches the global profiles.yml", async () => {
    const { app } = buildApp();

    const res = await app.request("/api/setup/connect", {
      method: "POST",
      body: JSON.stringify({ projectName: "acme", sourceType: "postgres" }),
    });
    expect(res.status).toBe(200);

    expect(process.env["WREN_HOME"]).toBe(path.join(workspaceRoot, ".wren"));
    expect(process.env["WREN_HOME"]).not.toBe(globalWrenHome);
    // The global file itself — the one a real `wren profile add` without this fix would have
    // overwritten (including its `active:` pointer) — is byte-for-byte untouched.
    expect(readFileSync(globalProfilesPath, "utf8")).toBe(GLOBAL_PROFILES_SEED);
  });

  // A project bound during the wizard's connect step must be found by the SAME profile at
  // Ask/query time. Both the setup-turn's `wren profile add`/`wren context set-profile` and the
  // ask-time `wren query`/`wren dry-plan` invocations go through the same execFile call site
  // (harness/exec/local.ts, and server/adopt.ts's execWren for the adopt path) which inherits
  // `process.env` verbatim with no `env` key of its own — so this holds as long as nothing
  // between "connect" and the first ask-time exec call resets WREN_HOME back off the anchor.
  // This test proves that: an unrelated route call in between (GET /api/setup/mode, matching
  // what the frontend actually polls while a turn is in flight) does not disturb the anchor.
  it("WREN_HOME set during connect stays anchored across subsequent unrelated route calls (ask-time consistency)", async () => {
    const { app } = buildApp();

    await app.request("/api/setup/connect", {
      method: "POST",
      body: JSON.stringify({ projectName: "acme", sourceType: "postgres" }),
    });
    const anchoredAfterConnect = process.env["WREN_HOME"];
    expect(anchoredAfterConnect).toBe(path.join(workspaceRoot, ".wren"));

    // Simulate time passing / other BFF traffic between the connect turn finishing and the
    // first ask-time query — an unrelated read-only route must not reset WREN_HOME.
    await app.request("/api/setup/mode");

    expect(process.env["WREN_HOME"]).toBe(anchoredAfterConnect);
  });

  // Adopt is strictly read-only against global state. Even if a prior "create" pick in
  // the same boot anchored WREN_HOME to the workspace, choosing "adopt" afterward must restore
  // the operator's real WREN_HOME before any adopt-mode `wren` invocation runs.
  it("POST /api/setup/adopt restores the real global WREN_HOME even after a prior create-mode anchor", async () => {
    const { app } = buildApp();

    // Anchor to create mode first (as if the operator had started down the "create" path,
    // then went back and picked "adopt" instead).
    await app.request("/api/setup/connect", { method: "POST", body: JSON.stringify({ projectName: "acme", sourceType: "postgres" }) });
    expect(process.env["WREN_HOME"]).toBe(path.join(workspaceRoot, ".wren"));

    verifyAdoptProjectMock.mockResolvedValue({ status: "ok", hasMdl: true, sourceType: "postgres" });
    const projectPath = path.join(workspaceRoot, "existing-project");
    const res = await app.request("/api/setup/adopt", { method: "POST", body: JSON.stringify({ projectPath }) });
    expect(res.status).toBe(200);

    expect(process.env["WREN_HOME"]).toBe(globalWrenHome);
  });

  // Mode is a runtime, resettable choice (POST /api/setup/reset clears setup.mode), not
  // fixed at boot — so a reset must not leave whichever WREN_HOME the previous pick set in
  // place for the next pick to inherit.
  it("POST /api/setup/reset restores the real global WREN_HOME after a create-mode anchor", async () => {
    const { app } = buildApp();

    await app.request("/api/setup/connect", { method: "POST", body: JSON.stringify({ projectName: "acme", sourceType: "postgres" }) });
    expect(process.env["WREN_HOME"]).toBe(path.join(workspaceRoot, ".wren"));

    const res = await app.request("/api/setup/reset", { method: "POST" });
    expect(res.status).toBe(200);

    expect(process.env["WREN_HOME"]).toBe(globalWrenHome);
  });
});
