const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Read complete SSE frames without waiting for the server to close the HTTP
 * response. Hono may deliberately leave the connection open after `done`; the
 * installed-package acceptance gate must treat that frame, not EOF, as its
 * terminal condition.
 */
export async function readSseFrames(url, { timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const timeoutError = new Error(`Setup stream timed out after ${timeoutMs}ms`);
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(timeoutError);
    }, timeoutMs);
  });
  let reader;

  try {
    const response = await Promise.race([fetchImpl(url, { signal: controller.signal }), deadline]);
    if (!response.ok) throw new Error(`Setup stream failed with ${response.status}`);
    if (!response.body) throw new Error("Setup stream had no response body");

    reader = response.body.getReader();
    const decoder = new TextDecoder();
    const frames = [];
    let remainder = "";

    for (;;) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (value) remainder += decoder.decode(value, { stream: !done });
      const parsed = takeCompleteFrames(remainder);
      remainder = parsed.remainder;
      frames.push(...parsed.frames);
      if (frames.some((frame) => frame.event === "done")) return frames;
      if (done) throw new Error(`Setup stream ended before done after ${frames.length} frame(s)`);
    }
  } finally {
    clearTimeout(timeout);
    cancelReader(reader);
  }
}

function cancelReader(reader) {
  if (!reader) return;
  // `cancel()` asks the source to release its resources, but a broken source
  // is allowed to return a promise that never settles. Keep that cleanup from
  // overriding the stream's bounded terminal result; observe rejections so a
  // later failed cleanup cannot become an unhandled rejection.
  try {
    void reader.cancel().catch(() => undefined);
  } catch {
    // Reader cancellation is best-effort after the caller has its result.
  }
}

function takeCompleteFrames(text) {
  const frames = [];
  let remainder = text;

  for (;;) {
    const separator = /\r?\n\r?\n/.exec(remainder);
    if (!separator || separator.index === undefined) return { frames, remainder };
    const block = remainder.slice(0, separator.index);
    remainder = remainder.slice(separator.index + separator[0].length);
    if (block.trim().length > 0) frames.push(parseFrame(block));
  }
}

function parseFrame(block) {
  let event = "";
  const data = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    const value = separator === -1 ? "" : line.slice(separator + 1).replace(/^ /, "");
    if (field === "event") event = value;
    if (field === "data") data.push(value);
  }
  return { event, data: data.length === 0 ? undefined : JSON.parse(data.join("\n")) };
}
