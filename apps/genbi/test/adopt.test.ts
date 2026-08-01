import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mocks node:child_process's `execFile` so no real `wren` subprocess ever runs in this hermetic
// unit test — same pattern as test/context-source.test.ts.
type ExecFileCallback = (error: (Error & { code?: string }) | null, stdout: string, stderr: string) => void;
const execFileMock = vi.fn<(file: string, args: readonly string[], options: unknown, callback: ExecFileCallback) => void>();
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFile: (...args: unknown[]) => (execFileMock as (...a: unknown[]) => void)(...args) };
});

const { verifyAdoptProject, runSetProfile, adoptWithChosenProfile } = await import("../server/adopt.js");

const SUPPORTED = new Set(["duckdb", "postgres", "mysql", "bigquery", "snowflake", "clickhouse", "mssql", "trino"]);

let projectDir: string;
let wrenHomeDir: string;
let originalWrenHome: string | undefined;

beforeEach(() => {
  projectDir = mkdtempSync(path.join(tmpdir(), "adopt-verify-test-"));
  // Isolates every test from the developer's real ~/.wren/profiles.yml — WREN_HOME points at a
  // fresh empty temp dir per test (no profiles.yml at all) unless a test writes one explicitly.
  wrenHomeDir = mkdtempSync(path.join(tmpdir(), "adopt-verify-wrenhome-"));
  originalWrenHome = process.env.WREN_HOME;
  process.env.WREN_HOME = wrenHomeDir;
  execFileMock.mockReset();
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(wrenHomeDir, { recursive: true, force: true });
  if (originalWrenHome === undefined) delete process.env.WREN_HOME;
  else process.env.WREN_HOME = originalWrenHome;
});

function writeManifest(fields: Record<string, string>): void {
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${value}`);
  writeFileSync(path.join(projectDir, "wren_project.yml"), lines.join("\n") + "\n");
}

function writeProfilesYml(content: string): void {
  writeFileSync(path.join(wrenHomeDir, "profiles.yml"), content);
}

function mockValidateSucceeds(): void {
  execFileMock.mockImplementation((_file, _args, _options, callback) => callback(null, "Valid — 3 models, 0 views.", ""));
}

describe("verifyAdoptProject", () => {
  it("errors on a path that doesn't exist, without shelling out", async () => {
    const result = await verifyAdoptProject(path.join(projectDir, "does-not-exist"), { supportedSourceTypes: SUPPORTED });
    expect(result.status).toBe("error");
    expect(result.status === "error" && result.message).toContain("no such directory");
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("errors on a path that resolves to a file, not a directory (path safety)", async () => {
    const filePath = path.join(projectDir, "not-a-dir.txt");
    writeFileSync(filePath, "hi");
    const result = await verifyAdoptProject(filePath, { supportedSourceTypes: SUPPORTED });
    expect(result.status).toBe("error");
    expect(result.status === "error" && result.message).toContain("not a directory");
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("errors when wren_project.yml is missing, without shelling out", async () => {
    const result = await verifyAdoptProject(projectDir, { supportedSourceTypes: SUPPORTED });
    expect(result.status).toBe("error");
    expect(result.status === "error" && result.message).toContain("wren_project.yml");
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("errors when wren_project.yml has no data_source: field, without shelling out", async () => {
    writeManifest({ name: "acme", profile: "acme" });
    const result = await verifyAdoptProject(projectDir, { supportedSourceTypes: SUPPORTED });
    expect(result.status).toBe("error");
    expect(result.status === "error" && result.message).toContain("data_source:");
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("errors on an unsupported data_source, without shelling out", async () => {
    writeManifest({ name: "acme", profile: "acme", data_source: "oracle" });
    const result = await verifyAdoptProject(projectDir, { supportedSourceTypes: SUPPORTED });
    expect(result.status).toBe("error");
    expect(result.status === "error" && result.message).toContain("oracle");
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("strips a single layer of quotes from scalar fields (e.g. profile: 'acme')", async () => {
    writeManifest({ name: "acme", profile: "'acme'", data_source: "duckdb" });
    mockValidateSucceeds();
    const result = await verifyAdoptProject(projectDir, { supportedSourceTypes: SUPPORTED });
    expect(result.status).toBe("ok");
  });

  it("errors when `wren context validate` exits non-zero (connection check failed), surfacing stdout/stderr", async () => {
    writeManifest({ name: "acme", profile: "acme", data_source: "postgres" });
    execFileMock.mockImplementation((_file, _args, _options, callback) =>
      callback(new Error("Command failed"), "", "connection refused: could not reach host"),
    );
    const result = await verifyAdoptProject(projectDir, { supportedSourceTypes: SUPPORTED });
    expect(result.status).toBe("error");
    expect(result.status === "error" && result.message).toContain("connection refused: could not reach host");
    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [file, args] = execFileMock.mock.calls[0]!;
    expect(file).toBe("wren");
    expect(args).toEqual(["context", "validate"]);
  });

  it("errors distinctly when the wren binary itself is missing (ENOENT)", async () => {
    writeManifest({ name: "acme", profile: "acme", data_source: "postgres" });
    const enoent = Object.assign(new Error("spawn wren ENOENT"), { code: "ENOENT" });
    execFileMock.mockImplementation((_file, _args, _options, callback) => callback(enoent, "", ""));
    const result = await verifyAdoptProject(projectDir, { supportedSourceTypes: SUPPORTED });
    expect(result.status).toBe("error");
    expect(result.status === "error" && result.message).toContain('could not find the "wren" binary');
  });

  it("reports hasMdl: true and the sourceType when the connection check passes and target/mdl.json exists", async () => {
    writeManifest({ name: "acme", profile: "acme", data_source: "postgres" });
    mkdirSync(path.join(projectDir, "target"), { recursive: true });
    writeFileSync(path.join(projectDir, "target", "mdl.json"), "{}");
    mockValidateSucceeds();

    const result = await verifyAdoptProject(projectDir, { supportedSourceTypes: SUPPORTED });
    expect(result).toEqual({ status: "ok", hasMdl: true, sourceType: "postgres" });
  });

  it("reports hasMdl: false when the connection check passes but target/mdl.json is missing", async () => {
    writeManifest({ name: "acme", profile: "acme", data_source: "duckdb" });
    mockValidateSucceeds();

    const result = await verifyAdoptProject(projectDir, { supportedSourceTypes: SUPPORTED });
    expect(result).toEqual({ status: "ok", hasMdl: false, sourceType: "duckdb" });
  });

  describe("no profile: pinned (needs_profile / error branch)", () => {
    it("errors with a clear message when there is no pin AND no compatible profile in profiles.yml, without shelling out", async () => {
      writeManifest({ name: "acme", data_source: "postgres" });
      // wrenHomeDir has no profiles.yml at all — loadProfileStore degrades to zero candidates.
      const result = await verifyAdoptProject(projectDir, { supportedSourceTypes: SUPPORTED });
      expect(result.status).toBe("error");
      expect(result.status === "error" && result.message).toContain("profile:");
      expect(result.status === "error" && result.message).toContain("no compatible profile");
      expect(execFileMock).not.toHaveBeenCalled();
    });

    it("reports needs_profile with a single candidate when exactly one profile matches the data_source", async () => {
      writeManifest({ name: "acme-proj", data_source: "duckdb" });
      writeProfilesYml(["active: other", "profiles:", "  demo:", "    datasource: duckdb", "    path: /tmp/demo.duckdb"].join("\n"));
      const result = await verifyAdoptProject(projectDir, { supportedSourceTypes: SUPPORTED });
      expect(result).toEqual({ status: "needs_profile", sourceType: "duckdb", candidates: [{ name: "demo", datasource: "duckdb" }] });
      expect(execFileMock).not.toHaveBeenCalled();
    });

    it("ranks candidates: project-directory-name match first, then the global active profile, then the rest", async () => {
      const projName = path.basename(projectDir);
      writeManifest({ data_source: "postgres" });
      writeProfilesYml(
        [
          "active: staging",
          "profiles:",
          "  zzz-other:",
          "    datasource: postgres",
          "  staging:",
          "    datasource: postgres",
          `  ${projName}:`,
          "    datasource: postgres",
          "  mismatched:",
          "    datasource: mysql",
        ].join("\n"),
      );
      const result = await verifyAdoptProject(projectDir, { supportedSourceTypes: SUPPORTED });
      expect(result.status).toBe("needs_profile");
      const names = result.status === "needs_profile" ? result.candidates.map((c) => c.name) : [];
      expect(names).toEqual([projName, "staging", "zzz-other"]);
    });

    it("filters out profiles whose datasource does not match the project's data_source", async () => {
      writeManifest({ name: "acme", data_source: "postgres" });
      writeProfilesYml(["profiles:", "  wrong-kind:", "    datasource: duckdb"].join("\n"));
      const result = await verifyAdoptProject(projectDir, { supportedSourceTypes: SUPPORTED });
      expect(result.status).toBe("error");
    });

    it("never invokes `wren context validate` for the needs_profile branch (no pin to validate yet)", async () => {
      writeManifest({ name: "acme", data_source: "duckdb" });
      writeProfilesYml(["profiles:", "  demo:", "    datasource: duckdb"].join("\n"));
      await verifyAdoptProject(projectDir, { supportedSourceTypes: SUPPORTED });
      expect(execFileMock).not.toHaveBeenCalled();
    });
  });
});

describe("runSetProfile", () => {
  it("invokes `wren context set-profile <name>` in the project directory and reports ok on success", async () => {
    execFileMock.mockImplementation((_file, _args, _options, callback) => callback(null, "Profile 'demo' bound.", ""));
    const result = await runSetProfile(projectDir, "demo");
    expect(result).toEqual({ ok: true });
    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [file, args, options] = execFileMock.mock.calls[0]!;
    expect(file).toBe("wren");
    expect(args).toEqual(["context", "set-profile", "demo"]);
    expect((options as { cwd?: string }).cwd).toBe(path.resolve(projectDir));
  });

  it("reports ok: false with stdout/stderr detail when the command exits non-zero", async () => {
    execFileMock.mockImplementation((_file, _args, _options, callback) =>
      callback(new Error("Command failed"), "", "no such profile: demo"),
    );
    const result = await runSetProfile(projectDir, "demo");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("no such profile: demo");
  });

  it("reports ok: false distinctly when the wren binary itself is missing (ENOENT)", async () => {
    const enoent = Object.assign(new Error("spawn wren ENOENT"), { code: "ENOENT" });
    execFileMock.mockImplementation((_file, _args, _options, callback) => callback(enoent, "", ""));
    const result = await runSetProfile(projectDir, "demo");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain('could not find the "wren" binary');
  });
});

describe("adoptWithChosenProfile", () => {
  // Regression coverage for a real bug found in independent review: the route used to pass a
  // client-supplied `profile` straight to `runSetProfile` with no check against the actual
  // candidate list, so `wren context set-profile` durably rewrote `data_source:` to whatever
  // the chosen (possibly incompatible) profile declared, and only the SUBSEQUENT smoke
  // validate could catch the mistake — by which point the manifest was already corrupted with
  // no way back. These tests exercise the fix: reject before ever shelling out, and roll back
  // if a compatible-looking choice still fails to connect.

  it("rejects a profile whose datasource does not match the project's, with zero mutation and zero shelling out", async () => {
    writeManifest({ name: "acme", data_source: "duckdb" });
    writeProfilesYml(["profiles:", "  tpch:", "    datasource: bigquery", "  compatible:", "    datasource: duckdb"].join("\n"));
    const manifestPath = path.join(projectDir, "wren_project.yml");
    const before = readFileSync(manifestPath);

    const result = await adoptWithChosenProfile(projectDir, "tpch", { supportedSourceTypes: SUPPORTED });

    expect(result.status).toBe("error");
    expect(result.status === "error" && result.message).toContain("tpch");
    expect(result.status === "error" && result.message).toContain("duckdb");
    expect(execFileMock).not.toHaveBeenCalled();
    // The manifest must be byte-identical to before the call — this is the exact case that
    // shipped broken; asserting only the error status would not have caught the corruption.
    expect(readFileSync(manifestPath)).toEqual(before);
  });

  it("rejects a hand-crafted profile name that isn't in profiles.yml at all, with zero mutation", async () => {
    writeManifest({ name: "acme", data_source: "duckdb" });
    writeProfilesYml(["profiles:", "  compatible:", "    datasource: duckdb"].join("\n"));
    const manifestPath = path.join(projectDir, "wren_project.yml");
    const before = readFileSync(manifestPath);

    const result = await adoptWithChosenProfile(projectDir, "totally-made-up", { supportedSourceTypes: SUPPORTED });

    expect(result.status).toBe("error");
    expect(result.status === "error" && result.message).toContain("totally-made-up");
    expect(execFileMock).not.toHaveBeenCalled();
    expect(readFileSync(manifestPath)).toEqual(before);
  });

  it("restores wren_project.yml to its pre-call bytes when set-profile succeeds but the subsequent validate fails, so a later adopt call re-offers the candidate list instead of dead-ending", async () => {
    writeManifest({ name: "acme", data_source: "duckdb" });
    writeProfilesYml(["profiles:", "  compatible:", "    datasource: duckdb"].join("\n"));
    const manifestPath = path.join(projectDir, "wren_project.yml");
    const before = readFileSync(manifestPath);

    execFileMock.mockImplementation((_file, args, _options, callback) => {
      const argv = args as readonly string[];
      if (argv[0] === "context" && argv[1] === "set-profile") {
        // Simulates the real `wren context set-profile` durably rewriting the manifest —
        // this is the mutation the rollback below must undo.
        writeFileSync(manifestPath, "name: acme\ndata_source: duckdb\nprofile: compatible\n");
        callback(null, "Profile 'compatible' bound.", "");
        return;
      }
      callback(new Error("Command failed"), "", "connection refused: could not reach host");
    });

    const result = await adoptWithChosenProfile(projectDir, "compatible", { supportedSourceTypes: SUPPORTED });

    expect(result.status).toBe("error");
    expect(result.status === "error" && result.message).toContain("connection refused");
    // Restored byte-for-byte — not merely "no profile: field" but the exact original bytes,
    // since `save_project_config` drops YAML comments on rewrite and a re-serialize would lose
    // them.
    expect(readFileSync(manifestPath)).toEqual(before);

    execFileMock.mockClear();
    const retry = await verifyAdoptProject(projectDir, { supportedSourceTypes: SUPPORTED });
    expect(retry.status).toBe("needs_profile");
    expect(retry.status === "needs_profile" && retry.candidates).toEqual([{ name: "compatible", datasource: "duckdb" }]);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("proceeds to ok when the chosen profile is compatible and the connection check passes", async () => {
    writeManifest({ name: "acme", data_source: "duckdb" });
    writeProfilesYml(["profiles:", "  compatible:", "    datasource: duckdb"].join("\n"));
    const manifestPath = path.join(projectDir, "wren_project.yml");

    execFileMock.mockImplementation((_file, args, _options, callback) => {
      const argv = args as readonly string[];
      if (argv[0] === "context" && argv[1] === "set-profile") {
        writeFileSync(manifestPath, "name: acme\ndata_source: duckdb\nprofile: compatible\n");
        callback(null, "Profile 'compatible' bound.", "");
        return;
      }
      callback(null, "Valid — 0 models, 0 views.", "");
    });

    const result = await adoptWithChosenProfile(projectDir, "compatible", { supportedSourceTypes: SUPPORTED });
    expect(result).toEqual({ status: "ok", hasMdl: false, sourceType: "duckdb" });
  });
});
