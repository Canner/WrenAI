import { chmodSync, mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { NativeWrenRuntimeError, resolveNativeWrenRuntime } from "../server/native-wren-runtime.js";

const dirs: string[] = [];
const SERVER_WREN_SOURCE_ROOT = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "core", "wren", "src"));

function runtimeFixture() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "genbi-native-wren-runtime-")));
  dirs.push(root);
  const toolRoot = path.join(root, "tool");
  const toolBin = path.join(toolRoot, "bin");
  const interpreterRoot = path.join(root, "python");
  const interpreter = path.join(interpreterRoot, "bin", "python3.11");
  const sitePackages = path.join(toolRoot, "lib", "python3.11", "site-packages");
  const sourceRoot = SERVER_WREN_SOURCE_ROOT;
  const launcher = path.join(toolBin, "wren");
  const shim = path.join(root, "shim", "wren");
  mkdirSync(path.dirname(interpreter), { recursive: true });
  mkdirSync(toolBin, { recursive: true });
  mkdirSync(path.join(interpreterRoot, "lib"), { recursive: true });
  mkdirSync(sitePackages, { recursive: true });
  mkdirSync(path.dirname(shim), { recursive: true });
  writeFileSync(path.join(toolRoot, "pyvenv.cfg"), "home = test\n");
  writeFileSync(interpreter, "#!/bin/sh\nexit 0\n"); chmodSync(interpreter, 0o755);
  symlinkSync(interpreter, path.join(toolBin, "python"));
  writeFileSync(launcher, `#!${path.join(toolBin, "python")}\n`); chmodSync(launcher, 0o755);
  symlinkSync(launcher, shim);
  writeFileSync(path.join(sitePackages, "_editable_impl_wrenai.pth"), `${sourceRoot}\n`);
  return { root, shim, launcher, toolRoot, interpreter, interpreterRoot, sitePackages, sourceRoot };
}

afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

describe("server-owned native Wren runtime", () => {
  it("resolves only the closed shim, launcher, interpreter, runtime, and editable-source chain", () => {
    const fixture = runtimeFixture();
    expect(resolveNativeWrenRuntime(fixture.shim)).toEqual({
      version: "1", shim: fixture.shim, launcher: fixture.launcher,
      venv_python: path.join(fixture.toolRoot, "bin", "python"), tool_root: fixture.toolRoot,
      site_packages: fixture.sitePackages, source_root: fixture.sourceRoot,
      interpreter: fixture.interpreter, interpreter_root: fixture.interpreterRoot,
    });
  });

  it("fails closed for partial, broad, and rotated symlink chains", () => {
    expect(() => resolveNativeWrenRuntime("relative/wren")).toThrow(NativeWrenRuntimeError);

    const partial = runtimeFixture();
    rmSync(path.join(partial.interpreterRoot, "lib"), { recursive: true });
    expect(() => resolveNativeWrenRuntime(partial.shim)).toThrow(NativeWrenRuntimeError);

    const broad = runtimeFixture();
    mkdirSync(path.join(broad.root, "wren"));
    writeFileSync(path.join(broad.root, "wren", "__init__.py"), "");
    writeFileSync(path.join(broad.sitePackages, "_editable_impl_wrenai.pth"), `${broad.root}\n`);
    expect(() => resolveNativeWrenRuntime(broad.shim)).toThrow(NativeWrenRuntimeError);

    const rotated = runtimeFixture();
    const replacement = path.join(rotated.root, "replacement");
    writeFileSync(replacement, "#!/bin/sh\nexit 0\n"); chmodSync(replacement, 0o755);
    rmSync(rotated.shim); symlinkSync(replacement, rotated.shim);
    expect(() => resolveNativeWrenRuntime(rotated.shim)).toThrow(NativeWrenRuntimeError);
  });

  it("rejects symlinked or retargeted editable metadata and source roots", () => {
    const pthFixture = runtimeFixture();
    const pth = path.join(pthFixture.sitePackages, "_editable_impl_wrenai.pth");
    const first = path.join(pthFixture.root, "first.pth");
    const replacement = path.join(pthFixture.root, "replacement.pth");
    writeFileSync(first, `${pthFixture.sourceRoot}\n`);
    writeFileSync(replacement, `${pthFixture.root}\n`);
    rmSync(pth); symlinkSync(first, pth);
    expect(() => resolveNativeWrenRuntime(pthFixture.shim)).toThrow(NativeWrenRuntimeError);
    rmSync(pth); symlinkSync(replacement, pth);
    expect(() => resolveNativeWrenRuntime(pthFixture.shim)).toThrow(NativeWrenRuntimeError);

    const sourceFixture = runtimeFixture();
    const sourceLink = path.join(sourceFixture.root, "source-link");
    const sourcePth = path.join(sourceFixture.sitePackages, "_editable_impl_wrenai.pth");
    symlinkSync(sourceFixture.sourceRoot, sourceLink);
    writeFileSync(sourcePth, `${sourceLink}\n`);
    expect(() => resolveNativeWrenRuntime(sourceFixture.shim)).toThrow(NativeWrenRuntimeError);
    unlinkSync(sourceLink); symlinkSync(sourceFixture.root, sourceLink);
    expect(() => resolveNativeWrenRuntime(sourceFixture.shim)).toThrow(NativeWrenRuntimeError);
  });
});
