import { describe, expect, it } from "vitest";
import { readSseFrames } from "../scripts/sse-frames.mjs";

const encoder = new TextEncoder();

describe("installed-package SSE reader", () => {
  it("parses split and multiple frames, then cancels a response held open after done", async () => {
    let cancelled = 0;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("event: event\r\ndata: {\"kind\":\"setup_"));
        controller.enqueue(encoder.encode("status\",\"status\":\"ok\"}\r\n\r\nevent: done\r\ndata: {}\r\n\r\n"));
      },
      cancel() { cancelled += 1; },
    });
    const frames = await readSseFrames("http://fixture.test/stream", {
      timeoutMs: 100,
      fetchImpl: async () => new Response(body),
    });

    expect(frames).toEqual([
      { event: "event", data: { kind: "setup_status", status: "ok" } },
      { event: "done", data: {} },
    ]);
    expect(cancelled).toBe(1);
  });

  it("fails with a bounded safe timeout when an open response never emits done", async () => {
    let cancelled = 0;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("event: event\ndata: {\"kind\":\"progress\"}\n\n"));
      },
      cancel() { cancelled += 1; },
    });

    await expect(readSseFrames("http://fixture.test/stream", {
      timeoutMs: 20,
      fetchImpl: async () => new Response(body),
    })).rejects.toThrow("Setup stream timed out after 20ms");
    expect(cancelled).toBe(1);
  });
});
