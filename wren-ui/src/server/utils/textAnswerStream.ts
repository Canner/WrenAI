import { Readable } from 'stream';

export interface ParsedTextAnswerStreamEvent {
  done?: boolean;
  message?: string;
}

const normalizeChunk = (chunk: string | Buffer) =>
  typeof chunk === 'string' ? chunk : chunk.toString('utf-8');

export class TextAnswerStreamAccumulator {
  private buffer = '';
  private content = '';

  public ingest(chunk: string | Buffer) {
    this.buffer += normalizeChunk(chunk);
    this.drain();
  }

  public finalize() {
    this.drain(true);
    return this.content;
  }

  public getContent() {
    return this.content;
  }

  private drain(force = false) {
    const separator = /\r?\n\r?\n/;

    while (true) {
      const match = separator.exec(this.buffer);
      if (!match) {
        if (force && this.buffer.trim()) {
          this.consumeEvent(this.buffer);
          this.buffer = '';
        }
        return;
      }

      const block = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      this.consumeEvent(block);
    }
  }

  private consumeEvent(block: string) {
    const dataLines = block
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.replace(/^data:\s?/, ''));

    for (const rawPayload of dataLines) {
      const event = this.parseEvent(rawPayload);
      if (event?.message) {
        this.content += event.message;
      }
    }
  }

  private parseEvent(payload: string): ParsedTextAnswerStreamEvent | null {
    try {
      const parsed = JSON.parse(payload);
      if (!parsed || typeof parsed !== 'object') {
        return null;
      }
      return parsed as ParsedTextAnswerStreamEvent;
    } catch {
      return null;
    }
  }
}

export const collectTextAnswerStreamContent = async (
  stream: Readable,
  {
    onData,
  }: {
    onData?: (chunk: Buffer) => void;
  } = {},
) => {
  const accumulator = new TextAnswerStreamAccumulator();

  return new Promise<string>((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => {
      accumulator.ingest(chunk);
      onData?.(chunk);
    });
    stream.on('end', () => {
      resolve(accumulator.finalize());
    });
    stream.on('error', reject);
  });
};
