import { chmodSync, existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertNativeRuntimeSpec,
  attestNativeExecutable,
  buildNativeRuntimeSpec,
  nativeProcessEnvironment,
  resolveNativeExecutable,
} from "../server/native-runtime-spec.js";
import type { NativeRuntimeSpec } from "../server/native-runtime-spec.js";

const roots: string[] = [];

function fixture() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "genbi-native-spec-")));
  roots.push(root);
  const bin = path.join(root, "bin");
  const project = path.join(root, "project");
  const workspace = path.join(root, "workspace");
  const wrenHome = path.join(workspace, ".wren");
  const codexHome = path.join(root, "codex-home");
  for (const directory of [bin, project, workspace, wrenHome, codexHome]) mkdirSync(directory, { mode: 0o700 });
  const producer = path.join(bin, "producer");
  const vendor = path.join(bin, "vendor");
  writeFileSync(producer, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  writeFileSync(vendor, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  return { root, bin, project, workspace, wrenHome, codexHome, producer, vendor };
}

afterEach(() => {
  vi.unstubAllEnvs();
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("NativeRuntimeSpec", () => {
  it("ignores browser-shaped overrides and poisoned ambient homes, PATH, project, packages, and credentials", () => {
    const value = fixture();
    const safeHome = realpathSync(homedir());
    const poisonRoot = path.join(value.root, "poison");
    mkdirSync(poisonRoot);
    const poisonCodex = path.join(poisonRoot, "codex");
    const poisonPackage = path.join(poisonRoot, "genbi-poison-package");
    mkdirSync(poisonPackage);
    writeFileSync(poisonCodex, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    writeFileSync(path.join(poisonPackage, "index.js"), "module.exports = 'ambient-package';\n");
    // Positive control: the poisoned PATH really can resolve an executable.
    expect(resolveNativeExecutable("vendor", "codex", poisonRoot)?.executable).toBe(realpathSync(poisonCodex));
    // Positive control: the poisoned global Node search path really can load
    // code that is unavailable through ordinary package resolution.
    expect(spawnSync(process.execPath, ["-e", "require('genbi-poison-package')"], {
      cwd: value.workspace,
      env: { NODE_PATH: poisonRoot },
    }).status).toBe(0);

    vi.stubEnv("PATH", poisonRoot);
    vi.stubEnv("HOME", poisonRoot);
    vi.stubEnv("WREN_HOME", poisonRoot);
    vi.stubEnv("WREN_PROJECT_HOME", poisonRoot);
    vi.stubEnv("CODEX_HOME", poisonRoot);
    vi.stubEnv("NODE_PATH", poisonRoot);
    vi.stubEnv("WARBLE_MCP_CONNECTION_CREDENTIAL", "ambient-credential");

    const vendor = attestNativeExecutable("vendor", value.vendor);
    const producer = attestNativeExecutable("producer", value.producer);
    const browserAttempt = {
      PATH: poisonRoot,
      HOME: poisonRoot,
      cwd: poisonRoot,
      executable: poisonCodex,
      environment: { CODEX_HOME: poisonRoot },
      credential: "browser-credential",
    };
    const spec = buildNativeRuntimeSpec({
      backend: "local",
      vendor: "codex",
      executables: [producer, vendor],
      toolDirectories: [value.bin],
      workspace: value.workspace,
      home: safeHome,
      binding: { path: value.project, identity: "project:sealed", generation: 7, revision: "sha256:revision" },
      sessionWrenHome: value.wrenHome,
      codexHome: value.codexHome,
      mcpCredential: "session-credential",
      ...(browserAttempt as Record<string, unknown>),
    });

    expect(spec.executables.vendor).toEqual(vendor);
    expect(spec.workspace).toBe(value.workspace);
    expect(spec.project).toMatchObject({ identity: "project:sealed", path: value.project, generation: 7, revision: "sha256:revision" });
    expect(spec.childEnvironment).toEqual({
      PATH: value.bin,
      HOME: safeHome,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      WREN_PROJECT_HOME: value.project,
      WREN_HOME: value.wrenHome,
      CODEX_HOME: value.codexHome,
      WARBLE_MCP_CONNECTION_CREDENTIAL: "session-credential",
    });
    expect(JSON.stringify(spec)).not.toContain(poisonRoot);
    expect("NODE_PATH" in spec.childEnvironment).toBe(false);
    expect(spawnSync(process.execPath, ["-e", "require('genbi-poison-package')"], {
      cwd: value.workspace,
      env: nativeProcessEnvironment(spec.childEnvironment),
    }).status).not.toBe(0);
    assertNativeRuntimeSpec(spec);
    expect(() => assertNativeRuntimeSpec({ ...spec, cwd: poisonRoot } as NativeRuntimeSpec)).toThrow(/native child environment is invalid/);
  });

  it("proves shell startup poison would run when inherited, then excludes it and rejects executable rotation", () => {
    const value = fixture();
    const startup = path.join(value.root, "startup.sh");
    const marker = path.join(value.root, "startup-ran");
    writeFileSync(startup, `printf ran > ${JSON.stringify(marker)}\n`);
    const sourceStartup = 'test -n "$BASH_ENV" && . "$BASH_ENV"';
    const positive = spawnSync("/bin/bash", ["-c", sourceStartup], { env: { BASH_ENV: startup } });
    expect(positive.status).toBe(0);
    expect(existsSync(marker)).toBe(true);
    rmSync(marker);

    const spec = buildNativeRuntimeSpec({
      backend: "local",
      vendor: "claude",
      executables: [attestNativeExecutable("producer", value.producer), attestNativeExecutable("vendor", value.vendor)],
      toolDirectories: [value.bin],
      workspace: value.workspace,
      home: realpathSync(homedir()),
    });
    const negative = spawnSync("/bin/bash", ["-c", sourceStartup], { env: nativeProcessEnvironment(spec.childEnvironment) });
    expect(negative.status).not.toBe(0);
    expect(existsSync(marker)).toBe(false);
    expect("BASH_ENV" in spec.childEnvironment).toBe(false);
    expect("ENV" in spec.childEnvironment).toBe(false);
    expect("ZDOTDIR" in spec.childEnvironment).toBe(false);

    // Positive control: the original attested executable is runnable.
    expect(spawnSync(spec.executables.vendor!.executable, [], { env: nativeProcessEnvironment(spec.childEnvironment) }).status).toBe(0);
    writeFileSync(value.vendor, "#!/bin/sh\nexit 9\n");
    chmodSync(value.vendor, 0o700);
    expect(spawnSync(value.vendor, [], { env: nativeProcessEnvironment(spec.childEnvironment) }).status).toBe(9);
    expect(() => assertNativeRuntimeSpec(spec)).toThrow(/native child environment is invalid/);
  });

  it("accepts a real directory but rejects the same target through a final-component symlink", () => {
    const value = fixture();
    const workspaceLink = path.join(value.root, "workspace-link");
    symlinkSync(value.workspace, workspaceLink, "dir");

    expect(realpathSync(workspaceLink)).toBe(value.workspace);
    expect(buildNativeRuntimeSpec({
      backend: "local",
      vendor: "codex",
      executables: [attestNativeExecutable("producer", value.producer), attestNativeExecutable("vendor", value.vendor)],
      toolDirectories: [value.bin],
      workspace: value.workspace,
      home: realpathSync(homedir()),
    }).workspace).toBe(value.workspace);
    expect(() => buildNativeRuntimeSpec({
      backend: "local",
      vendor: "codex",
      executables: [attestNativeExecutable("producer", value.producer), attestNativeExecutable("vendor", value.vendor)],
      toolDirectories: [value.bin],
      workspace: workspaceLink,
      home: realpathSync(homedir()),
    })).toThrow(/native child environment is invalid/);
  });
});
