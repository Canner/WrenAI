import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { z } from "zod";

const response = z.object({ version: z.literal(1), status: z.literal("pass"), request_sha256: z.string() }).strict();
const predicates = z.array(z.object({ predicate: z.string().min(1), args: z.record(z.string(), z.unknown()).optional() }).strict());

/** Verify fresh host-owned data with the compiler's evaluator, never an IR pass claim. */
export async function verifyComponentContext(binary: string, context: unknown, preconditions: unknown, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const conditions = predicates.parse(preconditions);
  const input = JSON.stringify({ version: 1, context, preconditions: conditions });
  if (Buffer.byteLength(input) > 2 * 1024 * 1024) throw new Error("Component context exceeds byte limit");
  const expected = createHash("sha256").update(input).digest("hex");
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = execFile(binary, ["check-context"], {
      timeout: 10_000, maxBuffer: 65_536, signal,
    }, (error, output) => {
      if (error) reject(new Error("Component context verification failed"));
      else resolve(output);
    });
    child.stdin?.on("error", () => { /* Early verifier rejection is handled by the completion callback. */ });
    child.stdin?.end(input);
  });
  signal.throwIfAborted();
  const result = response.parse(JSON.parse(stdout));
  if (result.request_sha256 !== expected) throw new Error("Component context verification identity mismatch");
}
