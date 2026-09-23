import { spawn } from "node:child_process";

/** Bounded compiler process group; cancellation also reaps descendants before returning. */
export async function runNativeDispatchProcess(input: {
  executable: string; args: readonly string[]; cwd: string; env: NodeJS.ProcessEnv; signal?: AbortSignal;
}): Promise<void> {
  input.signal?.throwIfAborted();
  if (process.platform === "win32") throw new Error("Native dispatch cleanup is unavailable");
  const child = spawn(input.executable, [...input.args], { cwd: input.cwd, env: input.env, detached: true, stdio: "ignore" });
  let aborted = false;
  const failure = () => new Error("Native dispatch process failed");
  const alive = () => {
    if (!child.pid) return false;
    try { process.kill(-child.pid, 0); return true; }
    catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
  };
  const kill = (signal: NodeJS.Signals) => {
    if (!child.pid) return;
    try { process.kill(-child.pid, signal); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw failure(); }
  };
  const gone = async (ms: number) => {
    const deadline = performance.now() + ms;
    while (alive() && performance.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    return !alive();
  };
  let cancel!: () => void;
  const completion = new Promise<number | null>((resolve, reject) => {
    child.once("error", () => reject(failure()));
    child.once("exit", resolve);
    cancel = () => { aborted = true; reject(failure()); };
  });
  const timer = setTimeout(cancel, 30_000);
  input.signal?.addEventListener("abort", cancel, { once: true });
  if (input.signal?.aborted) cancel();
  try {
    const code = await completion;
    if (code !== 0 || aborted) throw failure();
  } finally {
    clearTimeout(timer); input.signal?.removeEventListener("abort", cancel);
    if (!(await gone(100))) {
      kill("SIGTERM");
      if (!(await gone(300))) {
        kill("SIGKILL");
        if (!(await gone(2_000))) throw new Error("Native dispatch cleanup failed");
      }
    }
  }
}
