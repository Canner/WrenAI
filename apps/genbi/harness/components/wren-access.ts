import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { hashDirectory } from "../compile/fingerprint.js";
import type { ComponentAccess } from "./broker.js";

const reply = z.object({ id: z.number().int().nonnegative(), protocol: z.literal("wren-governed/1").optional(), result: z.unknown().optional(), error: z.string().optional() }).strict();

export interface WrenAccessIdentity {
  readonly environment: Readonly<NodeJS.ProcessEnv>;
  readonly digest: string;
  assertCurrent(): Promise<void>;
}

/** Capture once per root, before preparing any component. Secrets never leave the host. */
export async function captureWrenAccessIdentity(project: string, source: NodeJS.ProcessEnv = process.env): Promise<WrenAccessIdentity> {
  const environment = Object.freeze({ ...source });
  const home = path.resolve(environment.WREN_HOME ?? path.join(environment.HOME ?? os.homedir(), ".wren"));
  const files = [path.join(project, ".env"), ...[".env", "profiles.yml", "config.json"].map((name) => path.join(home, name))];
  const fingerprint = async () => {
    const hash = createHash("sha256").update(JSON.stringify(environment));
    for (const file of files) {
      hash.update(file).update("\0");
      try { hash.update(await realpath(file)).update("\0").update(await readFile(file)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Wren configuration is unavailable"); hash.update("absent"); }
    }
    return hash.digest("hex");
  };
  const digest = await fingerprint();
  return Object.freeze({ environment, digest, async assertCurrent() {
    if (await fingerprint() !== digest) throw new Error("Wren configuration changed");
  } });
}

/** One owned process captures the project model, policy and credentials once. */
export async function openWrenComponentAccess(options: {
  readonly executable: string;
  readonly project: string;
  readonly fingerprint: string;
  readonly signal: AbortSignal;
  readonly environment?: NodeJS.ProcessEnv;
  readonly identity?: WrenAccessIdentity;
}): Promise<ComponentAccess> {
  options.signal.throwIfAborted();
  const identity = options.identity ?? await captureWrenAccessIdentity(options.project, options.environment);
  const assertProject = async () => {
    await identity.assertCurrent();
    if (await hashDirectory(options.project) !== options.fingerprint) throw new Error("Component project changed");
    options.signal.throwIfAborted();
  };
  await assertProject();
  if (process.platform === "win32") throw new Error("Governed process cleanup is unavailable on this platform");
  const child = spawn(options.executable, ["governed-stdio", "--project", options.project], {
    cwd: options.project, env: { ...identity.environment }, detached: true, stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.resume();
  let closed = false;
  let closing: Promise<void> | undefined;
  let buffer = Buffer.alloc(0);
  let nextId = 1;
  let pending: { id: number; resolve(value: unknown): void; reject(error: Error): void } | undefined;
  const unavailable = () => new Error("Governed Wren operation is unavailable");
  const ready = new Promise<void>((resolve, reject) => { pending = { id: 0, resolve: () => resolve(), reject }; });
  const signalGroup = (value: NodeJS.Signals) => {
    if (!child.pid) return;
    try { process.kill(-child.pid, value); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw unavailable();
    }
  };
  const alive = () => {
    if (!child.pid) return false;
    try { process.kill(-child.pid, 0); return true; } catch (error) {
      return (error as NodeJS.ErrnoException).code !== "ESRCH";
    }
  };
  const waitGone = async (ms: number) => {
    const deadline = performance.now() + ms;
    while (alive() && performance.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    return !alive();
  };
  const close = (): Promise<void> => {
    if (closing) return closing;
    closed = true;
    pending?.reject(unavailable()); pending = undefined;
    closing = (async () => {
      try {
        child.stdin.end();
        if (await waitGone(100)) return;
        signalGroup("SIGTERM");
        if (await waitGone(300)) return;
        signalGroup("SIGKILL");
        if (!(await waitGone(2000))) throw new Error("Governed Wren cleanup failed");
      } finally {
        options.signal.removeEventListener("abort", abort);
        child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
      }
    })();
    return closing;
  };
  const abort = () => { void close().catch(() => {}); };
  options.signal.addEventListener("abort", abort, { once: true });
  child.on("error", abort); child.on("exit", abort);
  child.stdin.on("error", abort); child.stdout.on("error", abort);
  child.stdout.on("data", (chunk: Buffer) => {
    if (closed) return;
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > 1_048_577) { abort(); return; }
    const newline = buffer.indexOf(10);
    if (newline < 0) return;
    try {
      const value = reply.parse(JSON.parse(buffer.subarray(0, newline).toString("utf8")));
      buffer = buffer.subarray(newline + 1);
      if (buffer.length || !pending || value.id !== pending.id) throw unavailable();
      if (value.id === 0 ? value.protocol !== "wren-governed/1" || Object.keys(value).length !== 2
        : value.protocol !== undefined || (Object.hasOwn(value, "result") === Object.hasOwn(value, "error"))) throw unavailable();
      const waiter = pending; pending = undefined;
      if (value.error !== undefined) waiter.reject(unavailable()); else waiter.resolve(value.result);
    } catch { abort(); }
  });
  if (options.signal.aborted) abort();
  const timer = setTimeout(abort, 10_000);
  try { await ready; await assertProject(); } catch (error) { await close(); throw error; }
  finally { clearTimeout(timer); }
  let tail = Promise.resolve();
  const execute = (payload: Record<string, unknown>, signal: AbortSignal): Promise<unknown> => {
    const operation = tail.then(async () => {
      signal.throwIfAborted();
      if (closed) throw unavailable();
      await assertProject();
      const input = JSON.stringify({ id: nextId, ...payload }) + "\n";
      if (Buffer.byteLength(input) > 65_536) throw unavailable();
      const result = new Promise<unknown>((resolve, reject) => { pending = { id: nextId++, resolve, reject }; });
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort(); else child.stdin.write(input);
      try {
        const value = await result;
        signal.throwIfAborted();
        await assertProject();
        return value;
      } finally { signal.removeEventListener("abort", abort); }
    });
    tail = operation.then(() => {}, () => {});
    return operation;
  };
  return {
    query: (input, signal) => execute({ operation: "query", ...input }, signal),
    inspect: (signal) => execute({ operation: "inspect" }, signal), close,
  };
}
