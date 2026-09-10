import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { attestNativeExecutable, buildNativeRuntimeSpec } from "../server/native-runtime-spec.js";
import { createEmptyCodexWrenHome } from "../server/native-wren-home.js";
import type { ManagedWrenRuntimeRecord } from "../server/managed-wren-runtime.js";
import { buildCodexSessionPolicy } from "../server/runtime-host/codex-policy.js";

const roots: string[] = [];
function fixture() {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "genbi-policy-"))); roots.push(root);
  const dir = (name: string) => { const target = path.join(root, name); mkdirSync(target, { recursive: true, mode: 0o700 }); return realpathSync(target); };
  const workspace = dir("workspace"); const home = dir("home"); const codexHome = dir("login"); const generation = dir("generation"); const bin = dir("generation/bin");
  for (const name of ["vendor", "producer", "wren", "python"]) writeFileSync(path.join(bin, name), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  writeFileSync(path.join(codexHome, "auth.json"), "{}", { mode: 0o600 });
  const wrenHome = createEmptyCodexWrenHome(workspace);
  const spec = buildNativeRuntimeSpec({ backend: "codex-app-server", vendor: "codex", workspace, home, codexHome, sessionWrenHome: wrenHome.home, toolDirectories: [bin],
    executables: (["vendor", "producer", "wren", "python"] as const).map((name) => attestNativeExecutable(name, path.join(bin, name))) });
  const runtime: ManagedWrenRuntimeRecord = { version: "1", shim: path.join(bin, "wren"), launcher: path.join(bin, "wren"), venv_python: path.join(bin, "python"), interpreter: path.join(bin, "python"), interpreter_root: generation, tool_root: generation, source_root: generation, site_packages: generation, generation_root: generation, manifest_digest: "a".repeat(64), closure_digest: "b".repeat(64), package_digest: "c".repeat(64) };
  return { root, workspace, home, codexHome, generation, bin, spec, runtime, wrenHome };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
describe("server-owned named permission policy", () => {
  it("derives a fixed profile, preserves selected home and excludes ambient credentials", () => {
    const f = fixture(); const before = { ...process.env };
    const policy = buildCodexSessionPolicy(f.spec, f.runtime, f.wrenHome);
    expect(policy.args).toContain('default_permissions="genbi-scoped"');
    expect(policy.args.join("\n")).toContain('"enabled"=false');
    expect(policy.args.join("\n")).toContain(`${JSON.stringify(f.codexHome)}="deny"`);
    expect(policy.args.join("\n")).toContain(`${JSON.stringify(f.generation)}="read"`);
    expect(policy.args.join("\n")).toContain(`${JSON.stringify(f.workspace)}="write"`);
    expect(policy.environment.CODEX_HOME).toBe(f.codexHome);
    expect(policy.commandEnvironment.CODEX_HOME).toBeNull();
    expect(policy.commandEnvironment.WREN_HOME).toBe(f.wrenHome.home);
    expect(policy.environment).not.toHaveProperty("OPENAI_API_KEY");
    expect(process.env).toEqual(before);
  });
  it.each(["config.toml", "hooks.json", "plugins", "skills", "AGENTS.md"])("rejects inherited runtime configuration %s", (name) => {
    const f = fixture(); writeFileSync(path.join(f.codexHome, name), "poison");
    expect(() => buildCodexSessionPolicy(f.spec, f.runtime, f.wrenHome)).toThrow();
  });
  it("rejects project configuration and symlinked or public auth", () => {
    const f = fixture(); mkdirSync(path.join(f.workspace, ".codex"));
    expect(() => buildCodexSessionPolicy(f.spec, f.runtime, f.wrenHome)).toThrow();
    rmSync(path.join(f.workspace, ".codex"), { recursive: true }); chmodSync(path.join(f.codexHome, "auth.json"), 0o644);
    expect(() => buildCodexSessionPolicy(f.spec, f.runtime, f.wrenHome)).toThrow();
    rmSync(path.join(f.codexHome, "auth.json")); writeFileSync(path.join(f.root, "auth"), "{}", { mode: 0o600 }); symlinkSync(path.join(f.root, "auth"), path.join(f.codexHome, "auth.json"));
    expect(() => buildCodexSessionPolicy(f.spec, f.runtime, f.wrenHome)).toThrow();
  });
  it("rejects tampered executables, retired Wren home and widened environment", () => {
    const f = fixture();
    expect(() => buildCodexSessionPolicy({ ...f.spec, childEnvironment: { ...f.spec.childEnvironment, OPENAI_API_KEY: "poison" } } as any, f.runtime, f.wrenHome)).toThrow();
    writeFileSync(path.join(f.bin, "wren"), "changed");
    expect(() => buildCodexSessionPolicy(f.spec, f.runtime, f.wrenHome)).toThrow();
    const g = fixture(); g.wrenHome.cleanup!(); expect(() => buildCodexSessionPolicy(g.spec, g.runtime, g.wrenHome)).toThrow();
  });
  it("cannot substitute a different launcher or grant credential-root reads", () => {
    const f = fixture();
    expect(() => buildCodexSessionPolicy(f.spec, { ...f.runtime, launcher: "/ambient/wren" }, f.wrenHome)).toThrow();
    expect(() => buildCodexSessionPolicy(f.spec, f.runtime, { ...f.wrenHome, dataRoots: [f.codexHome] })).toThrow();
    expect(() => buildCodexSessionPolicy(f.spec, f.runtime, { ...f.wrenHome, dataRoots: ["/"] })).toThrow();
  });
});
