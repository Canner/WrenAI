#!/usr/bin/env node
/**
 * Test-only fixture "dispatcher", used exclusively by `test/cassette-wrappers.test.ts` to verify
 * `capture-wrapper.mjs`'s transparency contract (argv/stdin/stdout/exit-code pass through
 * unchanged).
 *
 * This is NOT a stand-in for a real dispatcher's wire protocol. It emits its own made-up,
 * obviously-synthetic line shape (`{"fixture":"fake-dispatcher", ...}`) that could never be
 * mistaken for warble's real NDJSON vocabulary — nothing here claims to be, or could be confused
 * with, a real cassette. Its only job is to be a small, fully-controlled process the wrapper test
 * can point at, so the test can compare "ran directly" vs. "ran through the wrapper" byte-for-byte.
 */
let stdinData = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (chunk) => {
  stdinData += chunk;
});
process.stdin.on("end", () => {
  process.stdout.write(`${JSON.stringify({ fixture: "fake-dispatcher", argv: process.argv.slice(2), stdin: stdinData })}\n`);
  const code = Number.parseInt(process.env.FAKE_DISPATCHER_EXIT_CODE ?? "0", 10);
  process.exit(Number.isNaN(code) ? 0 : code);
});
process.stdin.resume();
