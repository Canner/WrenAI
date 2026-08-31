import { existsSync } from "node:fs";
import { spawn } from "node:child_process";

const attestation = process.env.WREN_GENBI_LAUNCH_ATTESTATION;
if (!attestation || !existsSync(attestation)) {
  process.stderr.write("error: WREN_GENBI_LAUNCH_ATTESTATION is required; run verify:launch first\n");
  process.exitCode = 1;
} else {
  const child = spawn(process.execPath, ["dist-server/server/bin.js"], { stdio: "inherit", env: process.env });
  child.once("exit", (code) => { process.exitCode = code ?? 1; });
  child.once("error", () => { process.exitCode = 1; });
}
