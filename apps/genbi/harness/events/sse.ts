import type { AgentEvent } from "./types.js";

/**
 * Serializes one `AgentEvent` as a single `text/event-stream` frame per the
 * harness→BFF wire format: `event: <kind>\ndata:
 * <json>\n\n`. The harness itself never opens a socket — the BFF runs it
 * in-process and consumes `AgentEvent`s directly via `onEvent` — this is
 * only for the documented "if a future out-of-process split is wanted"
 * fallback, defined + unit-tested here so it exists when needed.
 */
export function serializeAgentEvent(event: AgentEvent): string {
  return `event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`;
}

export class MalformedSseFrameError extends Error {
  constructor(reason: string, frame: string) {
    super(`malformed SSE AgentEvent frame (${reason}): ${JSON.stringify(frame)}`);
    this.name = "MalformedSseFrameError";
  }
}

/**
 * The round-trip counterpart to `serializeAgentEvent`. Not a general SSE-
 * stream parser (no multi-frame buffering, no comment/retry-field support)
 * — the wire format here is always exactly one `event:` line + one `data:`
 * line per frame, so this only ever needs to split a single frame in two.
 */
export function parseAgentEvent(frame: string): AgentEvent {
  const trimmed = frame.endsWith("\n\n") ? frame.slice(0, -2) : frame;
  const lines = trimmed.split("\n");
  const eventLine = lines.find((line) => line.startsWith("event: "));
  const dataLine = lines.find((line) => line.startsWith("data: "));
  if (!eventLine || !dataLine) {
    throw new MalformedSseFrameError("missing event: or data: line", frame);
  }

  const kind = eventLine.slice("event: ".length);
  let parsed: unknown;
  try {
    parsed = JSON.parse(dataLine.slice("data: ".length));
  } catch {
    throw new MalformedSseFrameError("data: line is not valid JSON", frame);
  }
  if (typeof parsed !== "object" || parsed === null || !("kind" in parsed)) {
    throw new MalformedSseFrameError("data payload has no kind field", frame);
  }
  const data = parsed as AgentEvent;
  if (data.kind !== kind) {
    throw new MalformedSseFrameError(`event: "${kind}" does not match data.kind "${data.kind}"`, frame);
  }
  return data;
}
