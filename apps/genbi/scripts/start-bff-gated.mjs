import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const attestation = process.env.WREN_GENBI_LAUNCH_ATTESTATION;
if (!attestation || !existsSync(attestation)) {
  process.stderr.write("error: WREN_GENBI_LAUNCH_ATTESTATION is required; run verify:launch first\n");
  process.exitCode = 1;
} else {
  const verified = spawnSync(process.execPath, [fileURLToPath(new URL("./verify-bff-attestation.mjs", import.meta.url))], { stdio: "inherit", env: process.env });
  if (verified.status !== 0) process.exitCode = verified.status ?? 1;
  else {
  const child = spawn(process.execPath, ["dist-server/server/bin.js"], { stdio: "inherit", env: process.env });
  child.once("exit", (code) => { process.exitCode = code ?? 1; });
  child.once("error", () => { process.exitCode = 1; });
  }
}
