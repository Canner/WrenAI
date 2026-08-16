import { chmodSync, lstatSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createNativeSessionWorkspace, initializeNativeSessionStateBase, legacyInteractiveWorkspace, nativeSessionStateBaseAvailable, nativeSessionStateBaseAvailableForProject, validateNativeSessionStateBase, validateNativeSessionWorkspace } from "../server/native-session-workspace.js";

const dirs: string[] = [];
function directory(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
function stateFixture() {
  const stateParent = directory("genbi-native-state-");
  const project = directory("genbi-native-project-");
  writeFileSync(path.join(project, "AGENTS.md"), "project-owned instructions");
  return { project, state: initializeNativeSessionStateBase(path.join(stateParent, "bff.sqlite")) };
}
afterEach(() => {
  while (dirs.length) {
    const dir = dirs.pop()!;
    try { chmodSync(dir, 0o700); } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("BFF-owned native materialization state", () => {
  it("initializes private external namespaces and creates atomic per-session roots", () => {
    const { project, state } = stateFixture();
    expect(state.root.startsWith(project)).toBe(false);
    expect(lstatSync(state.root).mode & 0o777).toBe(0o700);
    expect(lstatSync(path.join(state.root, "native")).mode & 0o777).toBe(0o700);
    expect(lstatSync(path.join(state.root, "legacy")).mode & 0o777).toBe(0o700);
    const analysis = createNativeSessionWorkspace(state, project, "native-session-analysis");
    const context = createNativeSessionWorkspace(state, project, "native-session-context");
    expect(analysis).toBe(path.join(state.root, "native", "native-session-analysis"));
    expect(context).toBe(path.join(state.root, "native", "native-session-context"));
    expect(analysis).not.toBe(context);
    expect(() => createNativeSessionWorkspace(state, project, "native-session-analysis")).toThrow(/workspace is unavailable/);
    expect(legacyInteractiveWorkspace(state, project, "claude-code:interactive")).toBe(path.join(state.root, "legacy", "claude"));
    expect(legacyInteractiveWorkspace(state, project, "codex:interactive")).toBe(path.join(state.root, "legacy", "codex"));
    expect(validateNativeSessionWorkspace(state, project, analysis)).toBe(analysis);
  });

  it("allows a read-only bound project without inspecting or creating its vendor artifacts", () => {
    const { project, state } = stateFixture();
    chmodSync(project, 0o500);
    const workspace = createNativeSessionWorkspace(state, project, "native-session-readonly");
    expect(workspace).toBe(path.join(state.root, "native", "native-session-readonly"));
    expect(legacyInteractiveWorkspace(state, project, "codex:interactive")).toBe(path.join(state.root, "legacy", "codex"));
  });

  it("fails closed for wrong-mode, unwritable, and symlinked BFF state components", () => {
    const wrongMode = stateFixture();
    chmodSync(wrongMode.state.root, 0o755);
    expect(nativeSessionStateBaseAvailable(wrongMode.state)).toBe(false);
    expect(() => validateNativeSessionStateBase(wrongMode.state)).toThrow(/workspace is unavailable/);
    chmodSync(wrongMode.state.root, 0o700);

    const unwritable = stateFixture();
    chmodSync(unwritable.state.root, 0o500);
    expect(nativeSessionStateBaseAvailable(unwritable.state)).toBe(false);
    chmodSync(unwritable.state.root, 0o700);

    const symlinked = stateFixture();
    const replacement = directory("genbi-native-replacement-");
    rmSync(path.join(symlinked.state.root, "native"), { recursive: true });
    symlinkSync(replacement, path.join(symlinked.state.root, "native"));
    expect(nativeSessionStateBaseAvailable(symlinked.state)).toBe(false);
  });

  it("rejects a BFF state base configured inside the bound project", () => {
    const project = directory("genbi-native-project-");
    mkdirSync(path.join(project, "state"));
    const state = initializeNativeSessionStateBase(path.join(project, "state", "bff.sqlite"));
    expect(nativeSessionStateBaseAvailable(state)).toBe(true);
    expect(nativeSessionStateBaseAvailableForProject(state, project)).toBe(false);
    expect(() => createNativeSessionWorkspace(state, project, "native-session-inside-project")).toThrow(/workspace is unavailable/);
  });
});
