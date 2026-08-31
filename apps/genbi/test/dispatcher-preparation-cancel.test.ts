import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCodexAskDefault } from "../harness/route/codex-ask.js";
import { runDispatchedDefault } from "../harness/route/dispatched.js";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function fixture(): { root: string; executable: string; marker: string; irPath: string } {
  const root = mkdtempSync(path.join(os.tmpdir(), "genbi-preparation-cancel-"));
  roots.push(root);
  const marker = path.join(root, "spawned");
  const executable = path.join(root, "fake-dispatcher");
  const irPath = path.join(root, "ir.json");
  writeFileSync(irPath, "{}");
  // A real executable marker makes this an integration of the default spawn
  // path: a missed preparation fence would execute it and leave evidence.
  writeFileSync(executable, `#!/bin/sh\nprintf spawned > '${marker}'\n`);
  chmodSync(executable, 0o755);
  return { root, executable, marker, irPath };
}

describe("default subscription dispatchers", () => {
  it("does not spawn the Claude executable when abort wins while its async CLI resolution prepares", async () => {
    const fake = fixture();
    const controller = new AbortController();
    const pending = runDispatchedDefault({
      authChoice: { mode: "subscription", provider: "claude" },
      profileSource: fake.root,
      userProject: fake.root,
      question: "question",
      irPath: fake.irPath,
      warbleBin: fake.executable,
      agentSdkBin: fake.executable,
      outDir: path.join(fake.root, "out"),
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toThrow(/cancelled during preparation/);
    expect(existsSync(fake.marker)).toBe(false);
  });

  it("does not spawn the Codex executable when abort wins while its async CLI resolution prepares", async () => {
    const fake = fixture();
    const controller = new AbortController();
    const pending = runCodexAskDefault({
      authChoice: { mode: "subscription", provider: "codex" },
      profileSource: fake.root,
      userProject: fake.root,
      question: "question",
      irPath: fake.irPath,
      codexHome: path.join(fake.root, "codex-home"),
      codexModels: { orchestrator: "driver", cheap: "cheap", strong: "strong" },
      codexLocalBin: fake.executable,
      mcpServer: { command: fake.executable, prefixArgs: [] },
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toThrow(/cancelled during preparation/);
    expect(existsSync(fake.marker)).toBe(false);
  });
});
