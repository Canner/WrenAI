export interface SseFrame {
  readonly event: string;
  readonly data: unknown;
}

export interface ReadSseFramesOptions {
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export function readSseFrames(url: string | URL, options?: ReadSseFramesOptions): Promise<SseFrame[]>;
