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
});
