import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSetWrenHomeForSetupMode } from "../server/wren-home.js";

// Direct unit tests of the exact function `server/bin.ts` wires onto `TurnDeps` in production
// (see TurnDeps.setWrenHomeForSetupMode's doc comment in server/turn.ts). No
// mocking needed here: the function only ever touches `process.env.WREN_HOME`, so these tests
// save/restore it around each case the same way test/adopt.test.ts isolates WREN_HOME.

let savedWrenHome: string | undefined;

beforeEach(() => {
  savedWrenHome = process.env["WREN_HOME"];
});

afterEach(() => {
  if (savedWrenHome === undefined) delete process.env["WREN_HOME"];
  else process.env["WREN_HOME"] = savedWrenHome;
});

describe("createSetWrenHomeForSetupMode", () => {
  it("create: anchors WREN_HOME to <workspaceRoot>/.wren regardless of the prior value", () => {
    process.env["WREN_HOME"] = "/home/operator/.wren";
    const setMode = createSetWrenHomeForSetupMode("/workspaces/proj-1", "/home/operator/.wren");

    setMode("create");

    expect(process.env["WREN_HOME"]).toBe(path.join("/workspaces/proj-1", ".wren"));
  });

  it("adopt: restores the original WREN_HOME the process booted with", () => {
    const setMode = createSetWrenHomeForSetupMode("/workspaces/proj-1", "/home/operator/.wren");
    // Simulate having previously anchored to create-mode's workspace-scoped value.
    process.env["WREN_HOME"] = path.join("/workspaces/proj-1", ".wren");

    setMode("adopt");

    expect(process.env["WREN_HOME"]).toBe("/home/operator/.wren");
  });

  it("adopt: deletes WREN_HOME entirely when the process never had it set, rather than inventing a value", () => {
    const setMode = createSetWrenHomeForSetupMode("/workspaces/proj-1", undefined);
    process.env["WREN_HOME"] = path.join("/workspaces/proj-1", ".wren");

    setMode("adopt");

    expect(process.env["WREN_HOME"]).toBeUndefined();
  });

  it("undefined mode (reset): restores the original WREN_HOME, same as adopt", () => {
    const setMode = createSetWrenHomeForSetupMode("/workspaces/proj-1", "/home/operator/.wren");
    process.env["WREN_HOME"] = path.join("/workspaces/proj-1", ".wren");

    setMode(undefined);

    expect(process.env["WREN_HOME"]).toBe("/home/operator/.wren");
  });

  it("undefined mode (reset): deletes WREN_HOME when the process never had it set", () => {
    const setMode = createSetWrenHomeForSetupMode("/workspaces/proj-1", undefined);
    process.env["WREN_HOME"] = path.join("/workspaces/proj-1", ".wren");

    setMode(undefined);

    expect(process.env["WREN_HOME"]).toBeUndefined();
  });

  it("workspaceRoot undefined (bound-mode boot): is a no-op for every mode — the setup wizard never runs in bound mode", () => {
    delete process.env["WREN_HOME"];
    const setMode = createSetWrenHomeForSetupMode(undefined, "/home/operator/.wren");

    setMode("create");
    expect(process.env["WREN_HOME"]).toBeUndefined();

    process.env["WREN_HOME"] = "/home/operator/.wren";
    setMode("adopt");
    expect(process.env["WREN_HOME"]).toBe("/home/operator/.wren"); // untouched, not reset to the captured baseline
  });

  it("create then adopt then create again: each call only depends on its own mode argument, not call history", () => {
    const setMode = createSetWrenHomeForSetupMode("/workspaces/proj-1", "/home/operator/.wren");

    setMode("create");
    expect(process.env["WREN_HOME"]).toBe(path.join("/workspaces/proj-1", ".wren"));

    setMode("adopt");
    expect(process.env["WREN_HOME"]).toBe("/home/operator/.wren");

    setMode("create");
    expect(process.env["WREN_HOME"]).toBe(path.join("/workspaces/proj-1", ".wren"));
  });
});
