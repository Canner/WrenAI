import { once } from "node:events";
import type { ChildProcess } from "node:child_process";
import { get, createServer } from "node:http";
import type { Server } from "node:net";
import { describe, expect, it } from "vitest";
import { closeServerBounded, runBounded, spawnProcessGroup, stopProcessTree } from "../scripts/process-cleanup.mjs";

const isPosix = process.platform !== "win32";

describe("installed-package process cleanup", () => {
  it.skipIf(!isPosix)("stops a wrapper's fixture-connected descendant through its process group", async () => {
    let connectionOpened: (() => void) | undefined;
    let connectionClosed: (() => void) | undefined;
    const fixture = createServer((_request, response) => {
      connectionOpened?.();
      response.writeHead(200);
      response.write("fixture remains open");
      response.socket?.once("close", () => connectionClosed?.());
    });
    await listen(fixture);
    const port = fixture.address();
    if (!port || typeof port === "string") throw new Error("fixture did not listen on a TCP port");

    const opened = new Promise<void>((resolve) => { connectionOpened = () => resolve(); });
    const closed = new Promise<void>((resolve) => { connectionClosed = () => resolve(); });
    const descendantSource = [
      'require("node:http").get(process.env.FIXTURE_URL);',
      "setInterval(() => undefined, 1_000);",
    ].join("\n");
    const wrapperSource = [
      'const { spawn } = require("node:child_process");',
      `const child = spawn(process.execPath, ["-e", ${JSON.stringify(descendantSource)}], { stdio: "ignore" });`,
      'process.stdout.write(`${child.pid}\\n`);',
      "setInterval(() => undefined, 1_000);",
    ].join("\n");
    const wrapper = spawnProcessGroup(process.execPath, ["-e", wrapperSource], {
      env: { ...process.env, FIXTURE_URL: `http://127.0.0.1:${port.port}/` },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const descendantPid = await readPid(wrapper);

    try {
      await settlesWithin(opened, 1_000, "descendant did not connect to fixture");
      await stopProcessTree(wrapper, { graceMs: 500, forceMs: 500 });
      await settlesWithin(closed, 1_000, "descendant left its fixture connection open");
      await waitFor(() => !processAlive(descendantPid), 1_000, "descendant survived process-group cleanup");
      await closeServerBounded(fixture, { timeoutMs: 100, forceMs: 100 });
    } finally {
      if (wrapper.pid !== undefined && processAlive(wrapper.pid)) {
        try { process.kill(-wrapper.pid, "SIGKILL"); } catch { /* test-only final cleanup */ }
      }
      await closeServerBounded(fixture, { timeoutMs: 100, forceMs: 100 }).catch(() => undefined);
    }
  });

  it("forces an otherwise held-open fixture server to close within its bound", async () => {
    const fixture = createServer((_request, response) => {
      response.writeHead(200);
      response.write("fixture remains open");
    });
    await listen(fixture);
    const address = fixture.address();
    if (!address || typeof address === "string") throw new Error("fixture did not listen on a TCP port");
    const requestOpened = once(fixture, "request");
    const request = get(`http://127.0.0.1:${address.port}/`);
    await requestOpened;

    await closeServerBounded(fixture, { timeoutMs: 20, forceMs: 200 });
    expect(fixture.listening).toBe(false);
    request.destroy();
  });

  it("fails a non-terminating child command instead of waiting forever", async () => {
    await expect(runBounded(process.execPath, ["-e", "setInterval(() => undefined, 1_000)"], {
      timeoutMs: 20,
    })).rejects.toThrow("exceeded 20ms");
  });
});

async function listen(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ port: 0, host: "127.0.0.1" }, () => resolve());
  });
}

function readPid(child: ChildProcess): Promise<number> {
  const stdout = child.stdout;
  if (!stdout) return Promise.reject(new Error("wrapper has no stdout"));
  return new Promise<number>((resolve, reject) => {
    let output = "";
    stdout.setEncoding("utf8");
    stdout.on("data", (chunk: string | Buffer) => {
      output += String(chunk);
      const pid = Number.parseInt(output, 10);
      if (Number.isInteger(pid) && pid > 0) resolve(pid);
    });
    child.once("error", reject);
    child.once("exit", (code: number | null) => reject(new Error(`wrapper exited before reporting a descendant PID (${code})`)));
  });
}

function processAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

async function waitFor(predicate: () => boolean, timeoutMs: number, message: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (!predicate()) throw new Error(message);
}

async function settlesWithin(promise: Promise<unknown>, timeoutMs: number, message: string): Promise<void> {
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), timeoutMs));
  await Promise.race([promise, timeout]);
}
