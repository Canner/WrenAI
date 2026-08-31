import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { projectPublicLaunchAttestation, type LaunchAttestationPublic } from "../launch-attestation-public.js";

export type { LaunchAttestationPublic } from "../launch-attestation-public.js";

type RuntimeVerifierResult = { readonly status: number | null; readonly stderr?: string | Buffer };
type RuntimeVerifier = (command: string, args: readonly string[], options: { readonly cwd: string; readonly encoding: "utf8"; readonly env: NodeJS.ProcessEnv; readonly stdio: readonly ["ignore", "ignore", "pipe"] }) => RuntimeVerifierResult;

/**
 * The compiled BFF entrypoint owns this check as well as the convenience
 * wrapper. Directly executing dist-server/server/bin.js must not bypass the
 * exact local worktree/runtime tuple verification.
 */
export function verifyBffLocalRuntime(packageRoot: string, execute: RuntimeVerifier = spawnSync as RuntimeVerifier): void {
  const verifier = path.join(packageRoot, "scripts", "verify-bff-attestation.mjs");
  const result = execute(process.execPath, [verifier], { cwd: packageRoot, encoding: "utf8", env: process.env, stdio: ["ignore", "ignore", "pipe"] });
  if (result.status !== 0) {
    const detail = typeof result.stderr === "string" ? result.stderr.trim() : result.stderr?.toString("utf8").trim();
    throw new Error(detail || "local launch attestation runtime verification failed");
  }
}

/**
 * The full attestation file is local-only; this endpoint-safe view deliberately
 * contains hashes rather than filesystem paths, credentials, or command lines.
 */
export function readLaunchAttestation(): LaunchAttestationPublic {
  const file = process.env["WREN_GENBI_LAUNCH_ATTESTATION"];
  if (!file) throw new Error("local launch attestation is required; run verify:launch before starting the BFF");
  let value: unknown;
  try { value = JSON.parse(readFileSync(file, "utf8")); } catch { throw new Error("local launch attestation cannot be read"); }
  let attestation: LaunchAttestationPublic;
  try { attestation = projectPublicLaunchAttestation(value, "bootstrap"); } catch { throw new Error("local launch attestation is invalid"); }
  const entry = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "bin.js");
  const actual = createHash("sha256").update(readFileSync(entry)).digest("hex");
  if (actual !== attestation.bff.entrySha256) throw new Error("local launch attestation does not match this dist-server build");
  const root = path.resolve(path.dirname(entry), "..");
  const digest = createHash("sha256");
  const visit = (directory: string): void => {
    for (const child of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const candidate = path.join(directory, child.name); const relative = path.relative(root, candidate);
      if (relative === "local-launch-attestation.json") continue;
      if (child.isDirectory()) visit(candidate); else if (child.isFile()) { digest.update(relative); digest.update("\0"); digest.update(readFileSync(candidate)); }
    }
  };
  visit(root);
  if (digest.digest("hex") !== attestation.bff.closureSha256) throw new Error("local launch attestation does not match this dist-server closure");
  return attestation as LaunchAttestationPublic;
}
