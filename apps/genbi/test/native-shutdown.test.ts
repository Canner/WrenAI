import { describe, expect, it, vi } from "vitest";
import { shutdownNativeResources } from "../server/native-shutdown.js";

describe("native server exit status", () => {
  it.each(["sessions", "terminals", "server"])("exits unsuccessfully on %s cleanup failure while attempting all cleanup", async (failure) => {
    const order: string[] = [];
    const status = await shutdownNativeResources({
      shutdownSessions: async () => { order.push("sessions"); if (failure === "sessions") throw Error("private"); },
      closeTerminals: () => { order.push("terminals"); if (failure === "terminals") throw Error("private"); },
      closeServer: () => { order.push("server"); if (failure === "server") throw Error("private"); },
    });
    expect(status).toBe(1); expect(order).toEqual(["sessions", "terminals", "server"]);
  });
  it("waits for session cleanup before reporting successful exit", async () => {
    let release!: () => void; const done = vi.fn();
    const result = shutdownNativeResources({ shutdownSessions: () => new Promise<void>((resolve) => { release = resolve; }), closeTerminals() {}, closeServer() {} }).then((code) => { done(); return code; });
    await Promise.resolve(); expect(done).not.toHaveBeenCalled(); release(); await expect(result).resolves.toBe(0);
  });
});
