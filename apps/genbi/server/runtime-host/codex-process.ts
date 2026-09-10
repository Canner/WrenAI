import { spawn } from "node:child_process";
import { CodexRpcError, type RpcTransport } from "./codex-rpc.js";

/** Owned POSIX process group. Never accepts a PID from a vendor response. */
export function spawnCodexTransport(input: {
  executable: string; args: readonly string[]; cwd: string; env: NodeJS.ProcessEnv;
}): RpcTransport {
  const child = spawn(input.executable, [...input.args], {
    cwd: input.cwd, env: input.env, detached: true, stdio: ["pipe", "pipe", "pipe"],
  });
  let handlers: Parameters<RpcTransport["listen"]>[0] | undefined;
  let failed = false;
  let ended = false;
  let closing: Promise<void> | undefined;
  child.stderr.resume(); // drain without retaining secrets or model output
  child.on("error", () => { failed = true; handlers?.error(); });
  child.stdin.on("error", () => { failed = true; handlers?.error(); });
  child.stdout.on("error", () => { failed = true; handlers?.error(); });
  child.stdout.on("end", () => { ended = true; handlers?.end(); });
  child.on("exit", () => { ended = true; handlers?.end(); });
  const alive = () => {
    if (!child.pid) return false;
    try { process.kill(-child.pid, 0); return true; }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ESRCH") return false;
      // macOS can briefly return EPERM while a terminated group is being
      // reaped. It is NOT evidence of exit: keep polling to the deadline.
      if (code === "EPERM") return true;
      throw error;
    }
  };
  const signal = (value: NodeJS.Signals) => {
    if (!child.pid) return;
    try { process.kill(-child.pid, value); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // A denied signal is never success; the bounded liveness check below
      // still has to observe ESRCH or report incomplete cleanup.
      if (code !== "ESRCH" && code !== "EPERM") throw error;
    }
  };
  const wait = async (milliseconds: number) => {
    const deadline = performance.now() + milliseconds;
    while (alive() && performance.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    return !alive();
  };
  return {
    listen(value) {
      if (handlers) throw new CodexRpcError("transport");
      handlers = value;
      child.stdout.on("data", (chunk: Buffer) => value.data(chunk));
      if (failed) value.error(); else if (ended) value.end();
    },
    write(line) {
      if (closing || failed || ended || child.stdin.destroyed || child.stdin.writableLength > 1_048_576) throw new CodexRpcError("transport");
      child.stdin.write(line);
    },
    close() {
      closing ??= (async () => {
        try {
          child.stdin.end();
          // Let the vendor's connection-close handler reap command/PTY groups
          // that are distinct from this group before escalating host signals.
          if (await wait(200)) return;
          signal("SIGTERM");
          if (await wait(500)) return;
          signal("SIGKILL");
          if (!(await wait(2_000))) throw new CodexRpcError("cleanup");
        } finally { child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); }
      })();
      return closing;
    },
  };
}
