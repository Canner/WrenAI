/** Shared test helper: parses a raw SSE response body into `{event, data}` frames. New file, not modifying any existing test. */
export interface ParsedSseFrame {
  readonly event: string;
  readonly data: unknown;
}

export function parseSse(text: string): ParsedSseFrame[] {
  return text
    .split("\n\n")
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map((block) => {
      const eventLine = block.split("\n").find((line) => line.startsWith("event:"));
      const dataLine = block.split("\n").find((line) => line.startsWith("data:"));
      const event = eventLine ? eventLine.slice("event:".length).trim() : "";
      const dataRaw = dataLine ? dataLine.slice("data:".length).trim() : "";
      return { event, data: dataRaw.length > 0 ? JSON.parse(dataRaw) : undefined };
    });
}
