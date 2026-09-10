import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexRpcClient } from "../server/runtime-host/codex-rpc.js";
import { spawnCodexTransport } from "../server/runtime-host/codex-process.js";

const clients: CodexRpcClient[] = [];
afterEach(async () => { for (const client of clients.splice(0)) await client.close(); });
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error; }
}
describe.skipIf(process.platform === "win32")("owned Codex process transport", () => {
  it.each(["close", "timeout", "protocol"] as const)("cleans a live descendant on %s", async (cause) => {
    const script = [
      'const {spawn}=require("node:child_process");',
      'const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});',
      'process.stdout.write(JSON.stringify({method:"pids",params:{parent:process.pid,child:child.pid}})+"\\n");',
      'process.stdin.once("data",()=>{if(process.argv[1]==="protocol")process.stdout.write("INVALID_SECRET\\n");});',
      'setInterval(()=>{},1000);',
    ].join("\n");
    let ready!: (value: { parent: number; child: number }) => void;
    const started = new Promise<{ parent: number; child: number }>((resolve) => { ready = resolve; });
    const transport = spawnCodexTransport({
      executable: process.execPath, args: ["-e", script, cause], cwd: process.cwd(),
      env: { PATH: "/usr/bin:/bin" },
    });
    const rpc = new CodexRpcClient(transport, (message) => { ready(message.params as { parent: number; child: number }); });
    clients.push(rpc);
    const timeout = setTimeout(() => rpc.fail("timeout"), 3_000);
    const pids = await started; clearTimeout(timeout);
    expect(alive(pids.parent)).toBe(true); expect(alive(pids.child)).toBe(true);
    if (cause !== "close") await expect(rpc.request("fixture", {}, 50)).rejects.toThrow(`Codex RPC ${cause}`);
    try { await rpc.close(); } catch (error) { await transport.close(); throw error; }
    expect(alive(pids.parent)).toBe(false); expect(alive(pids.child)).toBe(false);
  });

  it("reports spawn errors without executable paths", async () => {
    const rpc = new CodexRpcClient(spawnCodexTransport({
      executable: "/nonexistent/private-vendor-path", args: [], cwd: process.cwd(), env: {},
    }), () => {});
    clients.push(rpc);
    await expect(rpc.request("initialize", {})).rejects.toThrow("Codex RPC transport");
    await rpc.close();
  });

  it("does not mistake persistent liveness EPERM for successful cleanup", async () => {
    let ready!: (pid: number) => void;
    const started = new Promise<number>((resolve) => { ready = resolve; });
    const rpc = new CodexRpcClient(spawnCodexTransport({
      executable: process.execPath,
      args: ["-e", 'process.stdout.write(JSON.stringify({method:"ready",params:process.pid})+"\\n");setInterval(()=>{},1000);'],
      cwd: process.cwd(), env: {},
    }), (message) => ready(message.params as number));
    const timeout = setTimeout(() => rpc.fail("timeout"), 3_000);
    const pid = await started; clearTimeout(timeout);
    const original = process.kill.bind(process);
    const kill = vi.spyOn(process, "kill").mockImplementation((target, signal) => {
      if (target === -pid && signal === 0) throw Object.assign(new Error("denied"), { code: "EPERM" });
      return original(target, signal);
    });
    try {
      await expect(rpc.close()).rejects.toThrow("Codex RPC cleanup");
    } finally { kill.mockRestore(); }
    expect(alive(pid)).toBe(false);
  });

  it("escalates to KILL when the owned process ignores TERM", async () => {
    let ready!: (pid: number) => void;
    const started = new Promise<number>((resolve) => { ready = resolve; });
    const rpc = new CodexRpcClient(spawnCodexTransport({
      executable: process.execPath,
      args: ["-e", 'process.on("SIGTERM",()=>{});process.stdout.write(JSON.stringify({method:"ready",params:process.pid})+"\\n");setInterval(()=>{},1000);'],
      cwd: process.cwd(), env: {},
    }), (message) => ready(message.params as number));
    clients.push(rpc);
    const timeout = setTimeout(() => rpc.fail("timeout"), 3_000);
    const pid = await started; clearTimeout(timeout);
    const began = performance.now();
    await rpc.close();
    expect(performance.now() - began).toBeGreaterThanOrEqual(450);
    expect(alive(pid)).toBe(false);
  });
});
