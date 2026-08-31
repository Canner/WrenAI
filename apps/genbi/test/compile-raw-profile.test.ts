import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createInMemoryCompileCache } from "../harness/compile/cache.js";
import { compileRawProfile } from "../harness/compile/pipeline.js";

const scratch: string[] = [];

afterEach(() => {
  for (const dir of scratch.splice(0)) {
    // `compileRawProfile` owns its temporary output directory; this is only
    // the test fixture root created for the fake compiler/profile source.
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

describe("compileRawProfile", () => {
  it("compiles the authored bootstrap profile directly without composing a bound project", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "wren-harness-raw-profile-test-"));
    scratch.push(root);
    const profileSource = path.join(root, "genbi-setup");
    const workDir = path.join(root, "output");
    const callsPath = path.join(root, "calls.json");
    const compilerPath = path.join(root, "fake-warble.cjs");
    mkdirSync(profileSource);
    mkdirSync(workDir);
    writeFileSync(path.join(profileSource, "profile.yml"), "profile: genbi-setup\n");
    writeFileSync(
      compilerPath,
      `#!/usr/bin/env node\nconst fs = require('node:fs');\nconst [subcommand, source, flag, output] = process.argv.slice(2);\nfs.writeFileSync(${JSON.stringify(callsPath)}, JSON.stringify({ subcommand, source, flag, output }));\nfs.writeFileSync(output, '{}');\n`,
    );
    chmodSync(compilerPath, 0o755);

    const result = await compileRawProfile({
      profileSource,
      mode: "native",
      warbleBin: compilerPath,
      cache: createInMemoryCompileCache(),
      workDir,
    });

    expect(JSON.parse(readFileSync(callsPath, "utf8"))).toMatchObject({
      subcommand: "compile",
      source: profileSource,
      flag: "-o",
    });
    expect(result.irPath).toMatch(/ir\.json$/);
  });

  it("names the Hub root derived from the resolved binary's own checkout, rather than relying on warble's compiled-in default", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "wren-harness-hub-dir-test-"));
    scratch.push(root);
    // A fake warble checkout: the binary at `<checkout>/target/release/warble` and its Hub library
    // at `<checkout>/hub/components`, which is the layout `resolveHubDir` derives tier 1 from.
    const checkout = path.join(root, "warble-checkout");
    const releaseDir = path.join(checkout, "target", "release");
    const hubDir = path.join(checkout, "hub", "components");
    const compilerPath = path.join(releaseDir, "warble");
    mkdirSync(releaseDir, { recursive: true });
    mkdirSync(hubDir, { recursive: true });

    const profileSource = path.join(root, "genbi-setup");
    const workDir = path.join(root, "output");
    const argvPath = path.join(root, "argv.json");
    mkdirSync(profileSource);
    mkdirSync(workDir);
    writeFileSync(path.join(profileSource, "profile.yml"), "profile: genbi-setup\n");
    writeFileSync(compilerPath, fakeCompilerRecording(argvPath));
    chmodSync(compilerPath, 0o755);

    await compileRawProfile({
      profileSource,
      mode: "native",
      warbleBin: compilerPath,
      cache: createInMemoryCompileCache(),
      workDir,
    });

    const argv: string[] = JSON.parse(readFileSync(argvPath, "utf8"));
    expect(argv).toContain("--hub-dir");
    expect(argv[argv.indexOf("--hub-dir") + 1]).toBe(hubDir);
    // The output flag must keep its own value: `--hub-dir` is appended after `-o <ir>`, never
    // inserted between them.
    expect(argv[argv.indexOf("-o") + 1]).toMatch(/ir\.json$/);
  });

  it("does not serve one Hub root's artifact for another: two compiles differing only in Hub root both miss", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "wren-harness-hub-dir-cache-test-"));
    scratch.push(root);
    const profileSource = path.join(root, "genbi-setup");
    const compilerPath = path.join(root, "fake-warble.cjs");
    mkdirSync(profileSource);
    writeFileSync(path.join(profileSource, "profile.yml"), "profile: genbi-setup\n");
    writeFileSync(compilerPath, fakeCompilerRecording(path.join(root, "argv.json")));
    chmodSync(compilerPath, 0o755);

    const cache = createInMemoryCompileCache();
    const base = { profileSource, mode: "native" as const, warbleBin: compilerPath, cache };

    const first = await compileRawProfile({ ...base, hubDir: path.join(root, "hub-a"), workDir: mkdirThere(root, "out-a") });
    expect(first.cacheHit).toBe(false);
    // Same profile, same fake compiler, same mode — only the Hub root differs, and a different
    // component library can compile the same profile into a different IR.
    const second = await compileRawProfile({ ...base, hubDir: path.join(root, "hub-b"), workDir: mkdirThere(root, "out-b") });
    expect(second.cacheHit).toBe(false);
    // ...while repeating the first Hub root does hit, proving the miss above came from the Hub
    // root and not from the key having stopped matching altogether.
    const again = await compileRawProfile({ ...base, hubDir: path.join(root, "hub-a"), workDir: mkdirThere(root, "out-c") });
    expect(again.cacheHit).toBe(true);
    expect(again.irPath).toBe(first.irPath);
  });
});

/** A fake `warble` that records its full argv and writes a stub IR to the `-o` path. */
function fakeCompilerRecording(argvPath: string): string {
  return (
    "#!/usr/bin/env node\n" +
    "const fs = require('node:fs');\n" +
    "const argv = process.argv.slice(2);\n" +
    `fs.writeFileSync(${JSON.stringify(argvPath)}, JSON.stringify(argv));\n` +
    "fs.writeFileSync(argv[argv.indexOf('-o') + 1], '{}');\n"
  );
}

function mkdirThere(root: string, name: string): string {
  const dir = path.join(root, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}
