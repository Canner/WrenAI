import { spawn } from "node:child_process";

const DEFAULT_GRACE_MS = 5_000;
const DEFAULT_FORCE_MS = 2_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
const DEFAULT_CLOSE_TIMEOUT_MS = 5_000;

/** Spawn a command in its own POSIX process group so descendants can be stopped together. */
export function spawnProcessGroup(command, args, options = {}) {
  return spawn(command, args, {
    ...options,
    // Windows does not support negative-PID process-group signaling. The
    // packaged gate's supported evidence runners are POSIX, while this keeps
    // the fallback behavior valid if the script is invoked elsewhere.
    detached: process.platform !== "win32",
  });
}

/** Stop a spawned command and every descendant, with finite TERM/KILL bounds. */
export async function stopProcessTree(child, { graceMs = DEFAULT_GRACE_MS, forceMs = DEFAULT_FORCE_MS } = {}) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    await stopSingleProcess(child, { graceMs, forceMs });
    return;
  }

  const groupId = child.pid;
  if (!processGroupAlive(groupId)) return;
  signalGroup(groupId, "SIGTERM");
  if (await waitForProcessGroupExit(groupId, graceMs)) return;
  signalGroup(groupId, "SIGKILL");
  if (await waitForProcessGroupExit(groupId, forceMs)) return;
  throw new Error(`process group ${groupId} did not exit after ${graceMs + forceMs}ms`);
}

/** Run a bounded command, retaining a diagnostic tail if it exits non-zero. */
export function runBounded(command, args, { timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS, ...options } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnProcessGroup(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", (error) => finish(() => reject(error)));
    child.once("exit", (code) => {
      finish(() => code === 0
        ? resolve({ stdout, stderr })
        : reject(new Error(`${command} ${args.join(" ")} failed (${code}): ${stderr.slice(-4_000)}`)));
    });
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      void stopProcessTree(child).then(
        () => reject(new Error(`${command} ${args.join(" ")} exceeded ${timeoutMs}ms`)),
        (error) => reject(new AggregateError([error], `${command} ${args.join(" ")} timed out and cleanup failed`)),
      );
    }, timeoutMs);
  });
}

/** Close a fixture listener without allowing an open client to stall cleanup forever. */
export async function closeServerBounded(server, { timeoutMs = DEFAULT_CLOSE_TIMEOUT_MS, forceMs = DEFAULT_FORCE_MS } = {}) {
  if (!server.listening) return;
  const closed = new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  if (await settlesWithin(closed, timeoutMs)) return;
  // The listener is already closed to new connections; now release the clients
  // that prevented its close callback, then retain a second finite bound.
  server.closeAllConnections?.();
  if (await settlesWithin(closed, forceMs)) return;
  throw new Error(`fixture server did not close after ${timeoutMs + forceMs}ms`);
}

function signalGroup(groupId, signal) {
  try {
    process.kill(-groupId, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

function processGroupAlive(groupId) {
  try {
    process.kill(-groupId, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

async function waitForProcessGroupExit(groupId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processGroupAlive(groupId)) return true;
    await delay(25);
  }
  return !processGroupAlive(groupId);
}

async function stopSingleProcess(child, { graceMs, forceMs }) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  if (await waitForChildExit(child, graceMs)) return;
  child.kill("SIGKILL");
  if (await waitForChildExit(child, forceMs)) return;
  throw new Error(`process ${child.pid ?? "unknown"} did not exit after ${graceMs + forceMs}ms`);
}

function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function settlesWithin(promise, timeoutMs) {
  const timedOut = Symbol("timed out");
  const result = await Promise.race([
    promise.then(() => undefined),
    delay(timeoutMs).then(() => timedOut),
  ]);
  return result !== timedOut;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
