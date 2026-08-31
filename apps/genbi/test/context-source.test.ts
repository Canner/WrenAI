import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mocks node:child_process's `execFile` so no real `wren` subprocess ever runs in this
// hermetic unit test — mirrors the `vi.mock("node:child_process", async (importOriginal) => ...)`
// pattern used elsewhere in this repo (e.g. test/dispatched-irpath-bypass.test.ts, there for `spawn`).
type ExecFileCallback = (error: (Error & { code?: string }) | null, stdout: string, stderr: string) => void;
const execFileMock = vi.fn<(file: string, args: readonly string[], options: unknown, callback: ExecFileCallback) => void>();
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFile: (...args: unknown[]) => (execFileMock as (...a: unknown[]) => void)(...args) };
});

// Imported AFTER the mock is registered (vi.mock is hoisted, but keep the import here for clarity).
const { loadContextShow, WrenBinaryNotFoundError, WrenContextShowError, invalidateContextShowCache } = await import("../server/context-source.js");

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(path.join(tmpdir(), "context-source-test-"));
  execFileMock.mockReset();
  invalidateContextShowCache();
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

function markBuilt(): void {
  mkdirSync(path.join(projectDir, "target"), { recursive: true });
  writeFileSync(path.join(projectDir, "target", "mdl.json"), "{}");
}

describe("loadContextShow", () => {
  it("throws WrenContextShowError up front when the project has not been built (no target/mdl.json) — never shells out", async () => {
    await expect(loadContextShow(projectDir)).rejects.toThrow(WrenContextShowError);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("parses the single JSON object `wren context show -o json` prints on success", async () => {
    markBuilt();
    const payload = { models: [{ name: "customers", columns: [] }], relationships: [], cubes: [] };
    execFileMock.mockImplementation((_file, _args, _options, callback) => callback(null, JSON.stringify(payload), ""));

    const result = await loadContextShow(projectDir);
    expect(result).toEqual(payload);
    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [file, args, options] = execFileMock.mock.calls[0]!;
    expect(file).toBe("wren");
    expect(args).toEqual(["context", "show", "-o", "json"]);
    expect((options as { cwd?: string }).cwd).toBe(path.resolve(projectDir));
  });

  it("throws WrenBinaryNotFoundError when execFile reports ENOENT (wren not on PATH)", async () => {
    markBuilt();
    const enoent = Object.assign(new Error("spawn wren ENOENT"), { code: "ENOENT" });
    execFileMock.mockImplementation((_file, _args, _options, callback) => callback(enoent, "", ""));

    await expect(loadContextShow(projectDir)).rejects.toThrow(WrenBinaryNotFoundError);
  });

  it("throws WrenContextShowError on a non-zero exit, folding stderr into the message", async () => {
    markBuilt();
    const failure = new Error("Command failed");
    execFileMock.mockImplementation((_file, _args, _options, callback) => callback(failure, "", "boom: bad profile"));

    await expect(loadContextShow(projectDir)).rejects.toThrow(/boom: bad profile/);
  });

  it("throws WrenContextShowError when stdout is not valid JSON", async () => {
    markBuilt();
    execFileMock.mockImplementation((_file, _args, _options, callback) => callback(null, "not json", ""));

    await expect(loadContextShow(projectDir)).rejects.toThrow(WrenContextShowError);
  });

  it("never fabricates: a failed run never resolves with seed/placeholder data", async () => {
    markBuilt();
    const failure = new Error("Command failed");
    execFileMock.mockImplementation((_file, _args, _options, callback) => callback(failure, "", ""));

    await expect(loadContextShow(projectDir)).rejects.toBeInstanceOf(WrenContextShowError);
  });

  it("with useCache: true, only shells out once for repeated calls against the same project", async () => {
    markBuilt();
    const payload = { models: [], relationships: [], cubes: [] };
    execFileMock.mockImplementation((_file, _args, _options, callback) => callback(null, JSON.stringify(payload), ""));

    await loadContextShow(projectDir, { useCache: true });
    await loadContextShow(projectDir, { useCache: true });
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  it("invalidateContextShowCache() forces the next useCache call to re-run wren", async () => {
    markBuilt();
    const payload = { models: [], relationships: [], cubes: [] };
    execFileMock.mockImplementation((_file, _args, _options, callback) => callback(null, JSON.stringify(payload), ""));

    await loadContextShow(projectDir, { useCache: true });
    invalidateContextShowCache(projectDir);
    await loadContextShow(projectDir, { useCache: true });
    expect(execFileMock).toHaveBeenCalledTimes(2);
  });
});
