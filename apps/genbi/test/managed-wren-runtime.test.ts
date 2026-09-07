import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManagedWrenRuntimeError, cleanupManagedWrenGenerations, managedWrenClosureDigest, manifestDigest, provisionManagedWrenRuntime, readManagedWrenManifest, resolveManagedWrenRuntime } from "../server/managed-wren-runtime.js";

const roots: string[] = [];
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

function fixture() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "genbi-managed-wren-"))); roots.push(root);
  const packageRoot = path.join(root, "package"); const runtimeRoot = path.join(root, "runtime");
  mkdirSync(path.join(packageRoot, "managed-wren"), { recursive: true, mode: 0o700 }); mkdirSync(runtimeRoot, { mode: 0o700 }); chmodSync(runtimeRoot, 0o700);
  const archiveDigest = digest("python-archive"); const wheelDigest = digest("wheel");
  const manifest = {
    schema: 1, activation: "approved", platform: "darwin-arm64",
    compatibility: { genbi: "0.0.4", profile: "genbi-native-v4", wren: "0.13.0" },
    python: { implementation: "cpython", version: "3.11.16", upstream: { release: "20260901", url: "https://example.invalid/upstream", sha256: archiveDigest }, mirror: { url: "https://github.com/Canner/WrenAI/releases/download/managed-wren-v0.0.4/python.tar.gz", sha256: archiveDigest }, interpreterPath: "python/install/bin/python3.11" },
    wheels: [{ distribution: "wrenai", version: "0.13.0", filename: "wrenai-0.13.0-py3-none-any.whl", url: "https://github.com/Canner/WrenAI/releases/download/managed-wren-v0.0.4/wrenai-0.13.0-py3-none-any.whl", sourceUrl: "https://files.pythonhosted.org/wrenai-0.13.0-py3-none-any.whl", sha256: wheelDigest }],
    runtime: { pythonArchivePath: "python.tar.gz", venvInterpreterPath: "venv/bin/python", launcherPath: "venv/bin/wren", module: "wren.cli:app", packagePath: "venv/lib/python3.11/site-packages/wren", sitePackagesPath: "venv/lib/python3.11/site-packages", pythonTreeSha256: digest(`install/bin/python3.11\0${"700"}\0file\0${digest("#!/bin/sh\nexit 0\n")}`), packageTreeSha256: "staged", sitePackagesTreeSha256: "staged", closureSha256: "staged" },
    licenseApproval: { state: "approved", evidence: "release-evidence" },
  } as const;
  const closure = managedWrenClosureDigest(manifest as never);
  const packageDigest = digest(`__init__.py\0${"600"}\0file\0${digest("__version__ = '0.13.0'\n")}`); const sitePackagesDigest = digest(`wren/__init__.py\0${"600"}\0file\0${digest("__version__ = '0.13.0'\n")}`);
  const approved = { ...manifest, runtime: { ...manifest.runtime, packageTreeSha256: packageDigest, sitePackagesTreeSha256: sitePackagesDigest, closureSha256: closure } };
  writeFileSync(path.join(packageRoot, "managed-wren", "manifest.json"), JSON.stringify(approved));
  const parsed = readManagedWrenManifest(packageRoot); const generation = path.join(runtimeRoot, manifestDigest(parsed));
  for (const directory of [path.join(generation, "python", "install", "bin"), path.join(generation, "venv", "bin"), path.join(generation, "venv", "lib", "python3.11", "site-packages", "wren"), path.join(generation, "wheels")]) mkdirSync(directory, { recursive: true, mode: 0o700 });
  const python = path.join(generation, "python", "install", "bin", "python3.11"); const venvPython = path.join(generation, "venv", "bin", "python"); const launcher = path.join(generation, "venv", "bin", "wren");
  writeFileSync(path.join(generation, "python.tar.gz"), "python-archive", { mode: 0o600 });
  writeFileSync(path.join(generation, "wheels", manifest.wheels[0].filename), "wheel", { mode: 0o600 });
  writeFileSync(python, "#!/bin/sh\nexit 0\n", { mode: 0o700 }); writeFileSync(venvPython, "#!/bin/sh\nexit 0\n", { mode: 0o700 }); writeFileSync(path.join(generation, "venv", "pyvenv.cfg"), `home = ${path.join(generation, "python", "install", "bin")}\nexecutable = ${python}\n`, { mode: 0o600 }); writeFileSync(launcher, `#!${venvPython}\nfrom wren.cli import app\n`, { mode: 0o700 }); writeFileSync(path.join(generation, "venv", "lib", "python3.11", "site-packages", "wren", "__init__.py"), "__version__ = '0.13.0'\n", { mode: 0o600 });
  writeFileSync(path.join(generation, ".genbi-managed-wren.json"), JSON.stringify({ manifestDigest: manifestDigest(parsed), pythonTreeDigest: approved.runtime.pythonTreeSha256, packageDigest, sitePackagesDigest, closureDigest: closure, interpreterDigest: digest("#!/bin/sh\nexit 0\n"), launcherDigest: digest(`#!${venvPython}\nfrom wren.cli import app\n`) }), { mode: 0o600 }); chmodSync(generation, 0o700);
  return { packageRoot, runtimeRoot, generation, launcher, manifest: approved };
}

afterEach(() => { vi.unstubAllGlobals(); while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });

function provisionFixture(version = "0.13.0") {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "genbi-managed-wren-provision-"))); roots.push(root);
  const packageRoot = path.join(root, "installed-package"); const runtimeRoot = path.join(root, "runtime"); const source = path.join(root, "python-source");
  mkdirSync(path.join(packageRoot, "managed-wren"), { recursive: true, mode: 0o700 }); mkdirSync(runtimeRoot, { mode: 0o700 }); mkdirSync(path.join(source, "python", "install", "bin"), { recursive: true, mode: 0o700 }); chmodSync(runtimeRoot, 0o700);
  const python = path.join(source, "python", "install", "bin", "python3.11");
  const fakePython = [
    "#!/bin/sh",
    "if [ \"$1\" = \"-m\" ] && [ \"$2\" = \"venv\" ]; then",
    "  target=\"$3\"; if [ \"$target\" = \"--copies\" ]; then target=\"$4\"; fi",
    "  /bin/mkdir -p \"$target/bin\" \"$target/lib/python3.11/site-packages/wren\" \"$target/lib/python3.11/site-packages/dependency\"",
    "  /bin/cp \"$0\" \"$target/bin/python\"",
    "  /bin/chmod 700 \"$target/bin/python\"",
    "  /usr/bin/printf 'home = %s\\nexecutable = %s\\n' \"$(/usr/bin/dirname \"$0\")\" \"$0\" > \"$target/pyvenv.cfg\"",
    "  /usr/bin/printf '#!%s\\nfrom wren.cli import app\\n' \"$target/bin/python\" > \"$target/bin/wren\"",
    "  /bin/chmod 700 \"$target/bin/wren\"",
    `  /usr/bin/printf \"__version__ = '${version}'\\n\" > \"$target/lib/python3.11/site-packages/wren/__init__.py\"`,
    "  /usr/bin/printf 'dependency = 1\\n' > \"$target/lib/python3.11/site-packages/dependency/__init__.py\"",
    "  /bin/chmod 600 \"$target/lib/python3.11/site-packages/wren/__init__.py\"",
    "  exit 0",
    "fi",
    "if [ \"$1\" = \"-m\" ] && [ \"$2\" = \"pip\" ]; then",
    "  /usr/bin/printf '%s\\n' \"$*\" > \"$HOME/pip-args\"",
    "  exit 0",
    "fi",
    "exit 1",
    "",
  ].join("\n");
  writeFileSync(python, fakePython, { mode: 0o700 });
  const archive = path.join(root, "python.tar.gz"); execFileSync("tar", ["-czf", archive, "-C", source, "."]);
  const archiveBytes = readFileSync(archive); const wheelBytes = Buffer.from(`fixture wheel ${version}\n`);
  const base = {
    schema: 1, activation: "approved", platform: "darwin-arm64",
    compatibility: { genbi: "0.0.4", profile: "genbi-native-v4", wren: version },
    python: { implementation: "cpython", version: "3.11.16", upstream: { release: "20260901", url: "https://example.invalid/upstream", sha256: digest(archiveBytes) }, mirror: { url: `https://github.com/Canner/WrenAI/releases/download/fixture-${version}/python.tar.gz`, sha256: digest(archiveBytes) }, interpreterPath: "python/install/bin/python3.11" },
    wheels: [{ distribution: "wrenai", version, filename: `wrenai-${version}-py3-none-any.whl`, url: `https://github.com/Canner/WrenAI/releases/download/fixture-${version}/wrenai-${version}-py3-none-any.whl`, sourceUrl: `https://files.pythonhosted.org/fixture/wrenai-${version}-py3-none-any.whl`, sha256: digest(wheelBytes) }],
    runtime: { pythonArchivePath: "python.tar.gz", venvInterpreterPath: "venv/bin/python", launcherPath: "venv/bin/wren", module: "wren.cli:app", packagePath: "venv/lib/python3.11/site-packages/wren", sitePackagesPath: "venv/lib/python3.11/site-packages", pythonTreeSha256: digest(`install/bin/python3.11\0${"700"}\0file\0${digest(fakePython)}`), packageTreeSha256: digest(`__init__.py\0${"600"}\0file\0${digest(`__version__ = '${version}'\n`)}`), sitePackagesTreeSha256: digest([`dependency/__init__.py\0${"644"}\0file\0${digest("dependency = 1\n")}`, `wren/__init__.py\0${"600"}\0file\0${digest(`__version__ = '${version}'\n`)}`].join("\n")), closureSha256: "staged" },
    licenseApproval: { state: "approved", evidence: "fixture" },
  } as const;
  const manifest = { ...base, runtime: { ...base.runtime, closureSha256: managedWrenClosureDigest(base as never) } };
  writeFileSync(path.join(packageRoot, "managed-wren", "manifest.json"), JSON.stringify(manifest));
  const requests: string[] = [];
  const installFetch = (beforeResponse?: () => Promise<void>) => vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
    requests.push(String(input)); if (beforeResponse) await beforeResponse();
    if (String(input) === manifest.python.mirror.url) return new Response(archiveBytes);
    if (String(input) === manifest.wheels[0].url) return new Response(wheelBytes);
    return new Response("not found", { status: 404 });
  }));
  return { packageRoot, runtimeRoot, manifest, requests, installFetch };
}

describe("managed Wren runtime", () => {
  it("accepts only an approved, immutable record and rejects every tampered launch link", () => {
    const value = fixture();
    expect(resolveManagedWrenRuntime({ packageRoot: value.packageRoot, runtimeRoot: value.runtimeRoot })).toMatchObject({ generation_root: value.generation, launcher: value.launcher });
    for (const mutation of ["interpreter", "launcher", "package", "marker"] as const) {
      const next = fixture();
      if (mutation === "interpreter") writeFileSync(path.join(next.generation, "venv", "bin", "python"), "not executable");
      if (mutation === "launcher") writeFileSync(next.launcher, "#!/wrong/python\n");
      if (mutation === "package") writeFileSync(path.join(next.generation, "venv", "lib", "python3.11", "site-packages", "wren", "__init__.py"), "tampered\n");
      if (mutation === "marker") writeFileSync(path.join(next.generation, ".genbi-managed-wren.json"), "{}", { mode: 0o600 });
      expect(() => resolveManagedWrenRuntime({ packageRoot: next.packageRoot, runtimeRoot: next.runtimeRoot })).toThrow(ManagedWrenRuntimeError);
    }
  });

  it("accepts a contained PBS/venv-style link and rejects a replacement that escapes generation", () => {
    const value = fixture();
    symlinkSync("python", path.join(value.generation, "venv", "bin", "python3"));
    expect(resolveManagedWrenRuntime({ packageRoot: value.packageRoot, runtimeRoot: value.runtimeRoot }).launcher).toBe(value.launcher);
    rmSync(value.launcher); symlinkSync("/bin/sh", value.launcher);
    expect(() => resolveManagedWrenRuntime({ packageRoot: value.packageRoot, runtimeRoot: value.runtimeRoot })).toThrow(ManagedWrenRuntimeError);
  });

  it("rejects mutable, unapproved, or non-mirror manifest input before provisioning", () => {
    const value = fixture();
    const manifestPath = path.join(value.packageRoot, "managed-wren", "manifest.json");
    const original = JSON.parse(JSON.stringify(value.manifest));
    for (const mutate of [
      (m: any) => { m.activation = "staged"; m.licenseApproval.state = "pending"; },
      (m: any) => { m.python.mirror.url = "https://example.com/python.tar.gz"; },
      (m: any) => { m.wheels[0].filename = "../escape.whl"; },
    ]) {
      const changed = JSON.parse(JSON.stringify(original)); mutate(changed); writeFileSync(manifestPath, JSON.stringify(changed));
      expect(() => resolveManagedWrenRuntime({ packageRoot: value.packageRoot, runtimeRoot: value.runtimeRoot })).toThrow(ManagedWrenRuntimeError);
    }
  });

  it("provisions deterministic fixture assets offline and then reuses the immutable generation", async () => {
    const value = provisionFixture(); value.installFetch();
    const first = await provisionManagedWrenRuntime({ packageRoot: value.packageRoot, runtimeRoot: value.runtimeRoot });
    expect(first.generation_root).toContain(first.manifest_digest);
    const config = readFileSync(path.join(first.generation_root, "venv", "pyvenv.cfg"), "utf8");
    expect(config).toContain(first.generation_root); expect(config).not.toContain(".staging-");
    expect(value.requests).toEqual([value.manifest.python.mirror.url, value.manifest.wheels[0].url]);
    expect(readFileSync(path.join(first.generation_root, "pip-args"), "utf8")).toContain("--no-index --no-deps --require-hashes");
    const requestCount = value.requests.length;
    await expect(provisionManagedWrenRuntime({ packageRoot: value.packageRoot, runtimeRoot: value.runtimeRoot })).resolves.toMatchObject({ generation_root: first.generation_root });
    expect(value.requests).toHaveLength(requestCount);
  }, 20_000);

  it("waits for a concurrent first-use owner and both callers receive the same generation", async () => {
    const value = provisionFixture(); let release!: () => void; const paused = new Promise<void>((resolve) => { release = resolve; }); let firstFetch = true;
    value.installFetch(async () => { if (firstFetch) { firstFetch = false; await paused; } });
    const owner = provisionManagedWrenRuntime({ packageRoot: value.packageRoot, runtimeRoot: value.runtimeRoot });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const waiter = provisionManagedWrenRuntime({ packageRoot: value.packageRoot, runtimeRoot: value.runtimeRoot });
    release();
    const [a, b] = await Promise.all([owner, waiter]);
    expect(a.generation_root).toBe(b.generation_root);
    expect(value.requests).toHaveLength(2);
  }, 20_000);

  it("reclaims a validated dead-owner lock without deleting a live owner lock", async () => {
    const value = provisionFixture(); value.installFetch();
    writeFileSync(path.join(value.runtimeRoot, ".provision.lock"), JSON.stringify({ pid: 999999, manifestDigest: "dead" }), { mode: 0o600 });
    await expect(provisionManagedWrenRuntime({ packageRoot: value.packageRoot, runtimeRoot: value.runtimeRoot })).resolves.toMatchObject({ launcher: expect.any(String) });
  });

  it("elects one stale-lock reclaimer while a second contender waits for the resulting live owner", async () => {
    const value = provisionFixture(); let release!: () => void; const paused = new Promise<void>((resolve) => { release = resolve; }); let first = true;
    value.installFetch(async () => { if (first) { first = false; await paused; } });
    writeFileSync(path.join(value.runtimeRoot, ".provision.lock"), JSON.stringify({ pid: 999999, manifestDigest: "dead" }), { mode: 0o600 });
    const a = provisionManagedWrenRuntime({ packageRoot: value.packageRoot, runtimeRoot: value.runtimeRoot });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const b = provisionManagedWrenRuntime({ packageRoot: value.packageRoot, runtimeRoot: value.runtimeRoot });
    release(); const [left, right] = await Promise.all([a, b]);
    expect(left.generation_root).toBe(right.generation_root);
  }, 20_000);

  it("provisions from a byte-identical approved manifest anchored by the staged package, then reuses its cache before fetch", async () => {
    const value = provisionFixture(); const approved = JSON.stringify(value.manifest); const approvedUrl = "https://github.com/Canner/WrenAI/releases/download/fixture/manifest.json";
    const staged = { ...value.manifest, activation: "staged", licenseApproval: { state: "pending" }, approvedManifest: { url: approvedUrl, sha256: digest(approved) } };
    writeFileSync(path.join(value.packageRoot, "managed-wren", "manifest.json"), JSON.stringify(staged));
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input); requests.push(url);
      if (url === approvedUrl) return new Response(approved);
      if (url === value.manifest.python.mirror.url) return new Response(readFileSync(path.join(value.runtimeRoot, "..", "python.tar.gz")));
      if (url === value.manifest.wheels[0].url) return new Response(Buffer.from("fixture wheel 0.13.0\n"));
      return new Response("missing", { status: 404 });
    }));
    // The fixture archive is retained beside its runtime root by provisionFixture.
    const first = await provisionManagedWrenRuntime({ packageRoot: value.packageRoot, runtimeRoot: value.runtimeRoot });
    expect(first.generation_root).toContain(first.manifest_digest);
    expect(existsSync(path.join(value.runtimeRoot, "attestations", `${digest(approved)}.json`))).toBe(true);
    const count = requests.length;
    expect(resolveManagedWrenRuntime({ packageRoot: value.packageRoot, runtimeRoot: value.runtimeRoot }).generation_root).toBe(first.generation_root);
    await expect(provisionManagedWrenRuntime({ packageRoot: value.packageRoot, runtimeRoot: value.runtimeRoot })).resolves.toMatchObject({ generation_root: first.generation_root });
    expect(requests).toHaveLength(count);
  }, 20_000);

  it("serializes staged first use and rejects a malicious approved-manifest cache without network recovery", async () => {
    const value = provisionFixture(); const approved = JSON.stringify(value.manifest); const approvedUrl = "https://github.com/Canner/WrenAI/releases/download/fixture/manifest.json";
    const staged = { ...value.manifest, activation: "staged", licenseApproval: { state: "pending" }, approvedManifest: { url: approvedUrl, sha256: digest(approved) } };
    writeFileSync(path.join(value.packageRoot, "managed-wren", "manifest.json"), JSON.stringify(staged));
    let release!: () => void; const paused = new Promise<void>((resolve) => { release = resolve; }); let manifestFetch = true;
    const archive = readFileSync(path.join(value.runtimeRoot, "..", "python.tar.gz"));
    const fetch = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === approvedUrl) { if (manifestFetch) { manifestFetch = false; await paused; } return new Response(approved); }
      if (url === value.manifest.python.mirror.url) return new Response(archive);
      if (url === value.manifest.wheels[0].url) return new Response(Buffer.from("fixture wheel 0.13.0\n"));
      return new Response("missing", { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);
    const owner = provisionManagedWrenRuntime({ packageRoot: value.packageRoot, runtimeRoot: value.runtimeRoot });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const waiter = provisionManagedWrenRuntime({ packageRoot: value.packageRoot, runtimeRoot: value.runtimeRoot });
    release();
    const [a, b] = await Promise.all([owner, waiter]);
    expect(a.generation_root).toBe(b.generation_root);
    expect(fetch.mock.calls.filter(([url]) => String(url) === approvedUrl)).toHaveLength(1);

    const poisoned = provisionFixture();
    writeFileSync(path.join(poisoned.packageRoot, "managed-wren", "manifest.json"), JSON.stringify(staged));
    mkdirSync(path.join(poisoned.runtimeRoot, "attestations"), { mode: 0o700 }); chmodSync(path.join(poisoned.runtimeRoot, "attestations"), 0o700);
    writeFileSync(path.join(poisoned.runtimeRoot, "attestations", `${digest(approved)}.json`), "malicious", { mode: 0o600 });
    const poisonedFetch = vi.fn(async () => new Response(approved)); vi.stubGlobal("fetch", poisonedFetch);
    await expect(provisionManagedWrenRuntime({ packageRoot: poisoned.packageRoot, runtimeRoot: poisoned.runtimeRoot })).rejects.toMatchObject({ code: "codex_wren_manifest_invalid" });
    expect(poisonedFetch).not.toHaveBeenCalled();
  }, 20_000);

  it("rejects an approved manifest whose compatibility or immutable release identity differs from its staged anchor", async () => {
    const value = provisionFixture(); const approved = JSON.parse(JSON.stringify(value.manifest)); approved.compatibility.wren = "0.13.1";
    const bytes = JSON.stringify(approved); const url = "https://github.com/Canner/WrenAI/releases/download/fixture/manifest.json";
    const staged = { ...value.manifest, activation: "staged", licenseApproval: { state: "pending" }, approvedManifest: { url, sha256: digest(bytes) } };
    writeFileSync(path.join(value.packageRoot, "managed-wren", "manifest.json"), JSON.stringify(staged));
    const fetch = vi.fn(async () => new Response(bytes)); vi.stubGlobal("fetch", fetch);
    await expect(provisionManagedWrenRuntime({ packageRoot: value.packageRoot, runtimeRoot: value.runtimeRoot })).rejects.toMatchObject({ code: "codex_wren_manifest_invalid" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects archive traversal and escaping link members before extraction", async () => {
    for (const linkTarget of ["/etc/passwd", "../../escape"] as const) {
      const value = provisionFixture(); const source = path.join(path.dirname(value.runtimeRoot), `unsafe-${linkTarget.startsWith("/") ? "absolute" : "relative"}`); mkdirSync(source, { mode: 0o700 }); symlinkSync(linkTarget, path.join(source, "bad-link"));
      const archive = path.join(path.dirname(value.runtimeRoot), `unsafe-${linkTarget.startsWith("/") ? "absolute" : "relative"}.tar.gz`); execFileSync("tar", ["-czf", archive, "-C", source, "."]); const bytes = readFileSync(archive);
      const manifest = JSON.parse(JSON.stringify(value.manifest)); manifest.python.mirror.sha256 = digest(bytes); manifest.python.upstream.sha256 = digest(bytes); writeFileSync(path.join(value.packageRoot, "managed-wren", "manifest.json"), JSON.stringify(manifest));
      vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => String(input) === manifest.python.mirror.url ? new Response(bytes) : new Response("unexpected", { status: 404 })));
      await expect(provisionManagedWrenRuntime({ packageRoot: value.packageRoot, runtimeRoot: value.runtimeRoot })).rejects.toMatchObject({ code: "codex_wren_provision_failed" });
    }
  });

  it("recovers only marked stale staging and preserves untrusted or rollback state", async () => {
    const value = provisionFixture(); const digestValue = manifestDigest(readManagedWrenManifest(value.packageRoot));
    const stale = path.join(value.runtimeRoot, `.staging-${digestValue}-stale`); mkdirSync(stale, { mode: 0o700 }); chmodSync(stale, 0o700); writeFileSync(path.join(stale, ".genbi-managed-wren-staging.json"), JSON.stringify({ manifestDigest: digestValue }), { mode: 0o600 });
    const untrusted = path.join(value.runtimeRoot, `.staging-${digestValue}-untrusted`); mkdirSync(untrusted, { mode: 0o700 }); chmodSync(untrusted, 0o700); writeFileSync(path.join(untrusted, "keep"), "keep");
    const rollback = path.join(value.runtimeRoot, "previous-generation"); mkdirSync(rollback, { mode: 0o700 }); chmodSync(rollback, 0o700); writeFileSync(path.join(rollback, "keep"), "keep");
    value.installFetch(); await provisionManagedWrenRuntime({ packageRoot: value.packageRoot, runtimeRoot: value.runtimeRoot });
    expect(existsSync(stale)).toBe(false); expect(readFileSync(path.join(untrusted, "keep"), "utf8")).toBe("keep"); expect(readFileSync(path.join(rollback, "keep"), "utf8")).toBe("keep");
  });

  it("retains older generations and keeps an active record pinned across an update", async () => {
    const old = provisionFixture("0.13.0"); old.installFetch(); const active = await provisionManagedWrenRuntime({ packageRoot: old.packageRoot, runtimeRoot: old.runtimeRoot });
    const next = provisionFixture("0.13.1"); next.installFetch(); const updated = await provisionManagedWrenRuntime({ packageRoot: next.packageRoot, runtimeRoot: old.runtimeRoot });
    expect(updated.generation_root).not.toBe(active.generation_root);
    expect(lstatSync(active.generation_root).isDirectory()).toBe(true);
    expect(resolveManagedWrenRuntime({ packageRoot: old.packageRoot, runtimeRoot: old.runtimeRoot }).launcher).toBe(active.launcher);
  });

  it("cleans only an explicitly validated inactive generation while preserving active and rollback records", async () => {
    const activeFixture = provisionFixture("0.13.0"); activeFixture.installFetch();
    const active = await provisionManagedWrenRuntime({ packageRoot: activeFixture.packageRoot, runtimeRoot: activeFixture.runtimeRoot });
    const rollbackFixture = provisionFixture("0.13.1"); rollbackFixture.installFetch();
    const rollback = await provisionManagedWrenRuntime({ packageRoot: rollbackFixture.packageRoot, runtimeRoot: activeFixture.runtimeRoot });
    const eligibleFixture = provisionFixture("0.13.2"); eligibleFixture.installFetch();
    const eligible = await provisionManagedWrenRuntime({ packageRoot: eligibleFixture.packageRoot, runtimeRoot: activeFixture.runtimeRoot });
    const untrustedDigest = "f".repeat(64);
    const untrusted = path.join(activeFixture.runtimeRoot, untrustedDigest);
    mkdirSync(untrusted, { mode: 0o700 }); chmodSync(untrusted, 0o700); writeFileSync(path.join(untrusted, "keep"), "not a runtime", { mode: 0o600 });

    expect(cleanupManagedWrenGenerations({
      runtimeRoot: activeFixture.runtimeRoot,
      candidates: [active, rollback, eligible, { ...eligible, manifest_digest: untrustedDigest, generation_root: untrusted }],
      retainManifestDigests: [active.manifest_digest, rollback.manifest_digest],
    })).toEqual([eligible.manifest_digest]);
    expect(existsSync(active.generation_root)).toBe(true);
    expect(existsSync(rollback.generation_root)).toBe(true);
    expect(existsSync(eligible.generation_root)).toBe(false);
    expect(readFileSync(path.join(untrusted, "keep"), "utf8")).toBe("not a runtime");
  });

  it("rejects retained archive and wheel tampering after a successful provision", async () => {
    for (const target of ["python.tar.gz", "wheel"] as const) {
      const next = provisionFixture(); next.installFetch(); const nextRecord = await provisionManagedWrenRuntime({ packageRoot: next.packageRoot, runtimeRoot: next.runtimeRoot });
      writeFileSync(target === "python.tar.gz" ? path.join(nextRecord.generation_root, target) : path.join(nextRecord.generation_root, "wheels", next.manifest.wheels[0].filename), "tampered");
      expect(() => resolveManagedWrenRuntime({ packageRoot: next.packageRoot, runtimeRoot: next.runtimeRoot })).toThrow(ManagedWrenRuntimeError);
    }
  });

  it("rejects a non-Wren transitive package change", async () => {
    const value = provisionFixture(); value.installFetch(); const record = await provisionManagedWrenRuntime({ packageRoot: value.packageRoot, runtimeRoot: value.runtimeRoot });
    writeFileSync(path.join(record.generation_root, "venv", "lib", "python3.11", "site-packages", "dependency", "__init__.py"), "tampered\n");
    expect(() => resolveManagedWrenRuntime({ packageRoot: value.packageRoot, runtimeRoot: value.runtimeRoot })).toThrow(ManagedWrenRuntimeError);
  });

  it("derives a closed staged candidate manifest from the selected release closure", () => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "genbi-managed-wren-release-"))); roots.push(root);
    const packagePath = path.join(root, "runtime", "venv", "lib", "python3.11", "site-packages", "wren"); mkdirSync(packagePath, { recursive: true, mode: 0o700 }); mkdirSync(path.join(root, "runtime", "python", "bin"), { recursive: true, mode: 0o700 }); writeFileSync(path.join(root, "runtime", "python", "bin", "python3.11"), "fixture-python\n", { mode: 0o600 }); writeFileSync(path.join(packagePath, "__init__.py"), "__version__ = '0.13.0'\n", { mode: 0o600 });
    const exact = JSON.parse(readFileSync(path.resolve("managed-wren", "release-inputs.json"), "utf8")).wrenai;
    const wheel = { distribution: "wrenai", version: exact.version, filename: exact.filename, sourceUrl: exact.url, sha256: exact.sha256, license: "Apache-2.0" };
    writeFileSync(path.join(root, "wheel-inputs.json"), JSON.stringify([wheel]));
    execFileSync(process.execPath, [path.resolve("scripts", "managed-wren-release.mjs"), root, "managed-wren-fixture"], { cwd: path.resolve("."), stdio: "pipe" });
    const candidate = JSON.parse(readFileSync(path.join(root, "managed-wren-manifest.candidate.json"), "utf8"));
    expect(candidate).toMatchObject({ activation: "staged", wheels: [{ distribution: wheel.distribution, version: wheel.version, filename: wheel.filename, url: "https://github.com/Canner/WrenAI/releases/download/managed-wren-fixture/wrenai-0.13.0-py3-none-any.whl" }] });
    expect(candidate.runtime.packageTreeSha256).not.toBe("staged"); expect(candidate.runtime.closureSha256).not.toBe("staged");
    wheel.sha256 = "a".repeat(64); writeFileSync(path.join(root, "wheel-inputs.json"), JSON.stringify([wheel]));
    expect(() => execFileSync(process.execPath, [path.resolve("scripts", "managed-wren-release.mjs"), root, "managed-wren-fixture"], { cwd: path.resolve("."), stdio: "pipe" })).toThrow(/selected wrenai wheel differs/);
  });
});
