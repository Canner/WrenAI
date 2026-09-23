import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runNativeDispatchProcess } from "../server/native-dispatch-process.js";

describe("owned native dispatch process", () => {
  it("accepts success, redacts failures, and cancels an owned process", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "genbi-dispatch-process-"));
    try {
      const input = { executable: process.execPath, cwd, env: { PATH: path.dirname(process.execPath) } };
      await expect(runNativeDispatchProcess({ ...input, args: ["-e", "process.exit(0)"] })).resolves.toBeUndefined();
      await expect(runNativeDispatchProcess({ ...input, args: ["-e", "process.stderr.write('private'); process.exit(1)"] })).rejects.toThrow("Native dispatch process failed");
      const abort = new AbortController();
      const run = runNativeDispatchProcess({ ...input, args: ["-e", "setInterval(() => {}, 1000)"], signal: abort.signal });
      abort.abort(); await expect(run).rejects.toThrow("Native dispatch process failed");
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });
});
