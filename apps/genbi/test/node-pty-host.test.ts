import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProbedPtyFactory, ensureDarwinNodePtySpawnHelper } from "../server/node-pty-host.js";
import type { PtyProcess } from "../server/interactive-terminal.js";

const dirs: string[] = [];
afterEach(() => { while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true }); });

function fakeProcess(exitCode = 0): PtyProcess {
  return {
    onData: () => ({ dispose() {} }),
    onExit: (listener) => { queueMicrotask(() => listener({ exitCode })); return { dispose() {} }; },
    write() {},
    resize() {},
    kill() {},
  };
}

describe("node-pty host", () => {
  it("repairs only the fixed darwin prebuild helper executable bit", () => {
    const root = mkdtempSync(path.join(tmpdir(), "genbi-node-pty-"));
    dirs.push(root);
    const entry = path.join(root, "lib", "index.js");
    const helper = path.join(root, "prebuilds", "darwin-arm64", "spawn-helper");
    mkdirSync(path.dirname(entry), { recursive: true });
    mkdirSync(path.dirname(helper), { recursive: true });
    writeFileSync(entry, "");
    writeFileSync(helper, "helper");
    chmodSync(helper, 0o644);

    ensureDarwinNodePtySpawnHelper(entry, "darwin", "arm64");

    expect(statSync(helper).mode & 0o111).not.toBe(0);
  });

  it("does not touch dependency files on platforms without the darwin helper", () => {
    const root = mkdtempSync(path.join(tmpdir(), "genbi-node-pty-"));
    dirs.push(root);
    const entry = path.join(root, "lib", "index.js");
    mkdirSync(path.dirname(entry), { recursive: true });
    writeFileSync(entry, "");

    expect(() => ensureDarwinNodePtySpawnHelper(entry, "linux", "arm64")).not.toThrow();
  });

  it("rejects a symlinked helper without changing its external target mode", () => {
    const root = mkdtempSync(path.join(tmpdir(), "genbi-node-pty-"));
    dirs.push(root);
    const entry = path.join(root, "lib", "index.js");
    const helper = path.join(root, "prebuilds", "darwin-arm64", "spawn-helper");
    const externalTarget = path.join(root, "external-target");
    mkdirSync(path.dirname(entry), { recursive: true });
    mkdirSync(path.dirname(helper), { recursive: true });
    writeFileSync(entry, "");
    writeFileSync(externalTarget, "external");
    chmodSync(externalTarget, 0o600);
    symlinkSync(externalTarget, helper);

    expect(() => ensureDarwinNodePtySpawnHelper(entry, "darwin", "arm64")).toThrow(/unavailable/);
    expect(statSync(externalTarget).mode & 0o777).toBe(0o600);
  });

  it("rejects a non-regular helper before attempting a permission repair", () => {
    const root = mkdtempSync(path.join(tmpdir(), "genbi-node-pty-"));
    dirs.push(root);
    const entry = path.join(root, "lib", "index.js");
    const helper = path.join(root, "prebuilds", "darwin-arm64", "spawn-helper");
    mkdirSync(path.dirname(entry), { recursive: true });
    mkdirSync(helper, { recursive: true });
    writeFileSync(entry, "");

    expect(() => ensureDarwinNodePtySpawnHelper(entry, "darwin", "arm64")).toThrow(/unavailable/);
  });

  it("requires a real no-model spawn probe and enforces the server-owned color environment", async () => {
    const spawn = vi.fn(() => fakeProcess());
    const env = { PATH: "/fixed/bin", HOME: "/fixed/home", TERM: "dumb", COLORTERM: "false", NO_COLOR: "1" };
    const factory = await createProbedPtyFactory({ spawn }, {
      cwd: "/fixed/cwd",
      env,
      probeExecutable: "/fixed/node",
    });

    factory.spawn("claude", [], { cwd: "/bound/project", cols: 100, rows: 30 });

    expect(spawn).toHaveBeenNthCalledWith(1, "/fixed/node", ["--version"], {
      cwd: "/fixed/cwd", cols: 80, rows: 24, name: "xterm-256color", env: { PATH: "/fixed/bin", HOME: "/fixed/home", TERM: "xterm-256color", COLORTERM: "truecolor" },
    });
    expect(spawn).toHaveBeenNthCalledWith(2, "claude", [], {
      cwd: "/bound/project", cols: 100, rows: 30, name: "xterm-256color", env: { PATH: "/fixed/bin", HOME: "/fixed/home", TERM: "xterm-256color", COLORTERM: "truecolor" },
    });
  });

  it("fails readiness when a loadable PTY module cannot spawn", async () => {
    await expect(createProbedPtyFactory({ spawn: () => { throw new Error("posix_spawnp failed"); } }, {
      probeExecutable: "/fixed/node",
    })).rejects.toThrow(/cannot spawn local processes/);
  });
});
