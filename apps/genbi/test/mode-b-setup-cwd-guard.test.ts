import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const runModeBDefaultMock = vi.fn();
vi.mock("../harness/route/mode-b.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../harness/route/mode-b.js")>();
  return { ...actual, runModeBDefault: (...args: unknown[]) => runModeBDefaultMock(...args) };
});

const tempDirs: string[] = [];

afterEach(async () => {
  runModeBDefaultMock.mockReset();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

it("rejects invalid and missing project-bound paths before calling runModeBDefault", async () => {
  const { ModeBSetupRunner } = await import("../harness/setup/runner.js");
  const runner = new ModeBSetupRunner({ irPath: "/fixture/ir.json" });
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "wren-harness-mode-b-cwd-guard-"));
  tempDirs.push(workspaceRoot);

  await expect(
    runner.run({ prompt: "resume", workspaceRoot, projectName: "../outside", stepKey: "connect_resume", authChoice: { mode: "subscription", provider: "claude" } }),
  ).rejects.toThrow(/validated single-segment projectName/i);
  await expect(
    runner.run({ prompt: "resume", workspaceRoot, projectName: "acme", stepKey: "connect_resume", authChoice: { mode: "subscription", provider: "claude" } }),
  ).rejects.toThrow(/project directory must exist/i);
  expect(runModeBDefaultMock).not.toHaveBeenCalled();

  await mkdir(path.join(workspaceRoot, "acme"));
  runModeBDefaultMock.mockResolvedValue({ finalText: "SETUP_STATUS: ok" });
  await runner.run({ prompt: "resume", workspaceRoot, projectName: "acme", stepKey: "connect_resume", authChoice: { mode: "subscription", provider: "claude" } });
  expect(runModeBDefaultMock).toHaveBeenCalledWith(expect.objectContaining({ userProject: await import("node:fs/promises").then(({ realpath }) => realpath(path.join(workspaceRoot, "acme"))) }));
});
