import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const attestation = process.env.WREN_GENBI_LAUNCH_ATTESTATION;
if (!attestation || !existsSync(attestation)) {
  process.stderr.write("error: WREN_GENBI_LAUNCH_ATTESTATION is required; run verify:launch first\n");
  process.exitCode = 1;
} else {
  const verified = spawnSync(process.execPath, [fileURLToPath(new URL("./verify-ui-attestation.mjs", import.meta.url))], { stdio: "inherit", env: process.env });
  if (verified.status !== 0) process.exitCode = verified.status ?? 1;
  else {
  // The wrapper owns attestation, while Vite still owns listen options such
  // as `--host` and `--port`. Forward only the arguments supplied after the
  // wrapper entrypoint so LAN/manual-test bindings do not silently collapse
  // back to loopback.
  const forwarded = process.argv.slice(2);
  if (forwarded[0] === "--") forwarded.shift();
  const child = spawn("pnpm", ["exec", "vite", ...forwarded], { stdio: "inherit", env: process.env });
  child.once("exit", (code) => { process.exitCode = code ?? 1; });
  child.once("error", () => { process.exitCode = 1; });
  }
}
