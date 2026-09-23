import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hashDirectory } from "../harness/compile/fingerprint.js";
import { captureWrenAccessIdentity, openWrenComponentAccess } from "../harness/components/wren-access.js";

async function fixture(script: string, run: (project: string, executable: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "genbi-wren-access-test-"));
  const executable = path.join(root, "fake-wren");
  await writeFile(executable, `#!${process.execPath}\n${script}`, { mode: 0o700 });
  try { await run(root, executable); } finally { await rm(root, { recursive: true, force: true }); }
}
const ready = 'console.log(JSON.stringify({id:0,protocol:"wren-governed/1"}));';

describe("owned Wren access", () => {
  it.each(["profiles.yml", "config.json", ".env"])("rejects changed global %s across component preparations", async (name) => fixture(ready + 'process.stdin.resume();', async (project, executable) => {
    const home = await mkdtemp(path.join(os.tmpdir(), "genbi-wren-config-"));
    try {
      const environment = { PATH: process.env.PATH, HOME: home, WREN_HOME: home };
      const identity = await captureWrenAccessIdentity(project, environment);
      const options = { executable, project, fingerprint: await hashDirectory(project), signal: new AbortController().signal, identity };
      const access = await openWrenComponentAccess(options);
      try {
        await writeFile(path.join(home, name), "changed");
        await expect(access.inspect(options.signal)).rejects.toThrow("configuration changed");
        await expect(openWrenComponentAccess(options)).rejects.toThrow("configuration changed");
      } finally { await access.close(); }
    } finally { await rm(home, { recursive: true, force: true }); }
  }));
  it("uses fixed process arguments and serializes typed calls", async () => fixture(`${ready}
    const readline = require('node:readline');
    if (process.argv[2] !== 'governed-stdio' || process.argv[3] !== '--project') process.exit(1);
    readline.createInterface({input:process.stdin}).on('line',line => {
      const request=JSON.parse(line);
      console.log(JSON.stringify({id:request.id,result:request}));
    });`, async (project, executable) => {
    const signal = new AbortController().signal;
    const access = await openWrenComponentAccess({ executable, project, fingerprint: await hashDirectory(project), signal });
    try {
      const results = await Promise.all([access.query({ sql: "SELECT 1", limit: 2 }, signal), access.inspect(signal)]);
      expect(results).toEqual([{ id: 1, operation: "query", sql: "SELECT 1", limit: 2 }, { id: 2, operation: "inspect" }]);
    } finally { await access.close(); }
  }));
  it("rejects a changed source before sending another query", async () => fixture(ready + 'process.stdin.resume();', async (project, executable) => {
    const signal = new AbortController().signal;
    const access = await openWrenComponentAccess({ executable, project, fingerprint: await hashDirectory(project), signal });
    try {
      await writeFile(path.join(project, "changed.yml"), "changed");
      await expect(access.query({ sql: "SELECT 1", limit: 1 }, signal)).rejects.toThrow("changed");
    } finally { await access.close(); }
  }));
  it("cancels a hung query and closes the owned process", async () => fixture(ready + 'process.stdin.resume();', async (project, executable) => {
    const controller = new AbortController();
    const access = await openWrenComponentAccess({ executable, project, fingerprint: await hashDirectory(project), signal: controller.signal });
    const query = access.query({ sql: "SELECT 1", limit: 1 }, controller.signal);
    setTimeout(() => controller.abort(), 25);
    await expect(query).rejects.toThrow();
    await access.close();
    await expect(access.inspect(new AbortController().signal)).rejects.toThrow();
  }));
  it("refuses a protocol mismatch", async () => fixture('console.log(JSON.stringify({id:0,protocol:"old"}));process.stdin.resume();', async (project, executable) => {
    await expect(openWrenComponentAccess({ executable, project, fingerprint: await hashDirectory(project), signal: new AbortController().signal })).rejects.toThrow();
  }));
});
