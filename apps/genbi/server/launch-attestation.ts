import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { projectPublicLaunchAttestation, type LaunchAttestationPublic } from "../launch-attestation-public.js";

export type { LaunchAttestationPublic } from "../launch-attestation-public.js";

/** Shared boot boundary: neither an ambiguous dual mode nor an unconfigured mode may start. */
export function resolveExclusiveLaunchMode(project: string | undefined, workspaceRoot: string | undefined): "bootstrap" | "bound" {
  const hasProject = project !== undefined && project.trim().length > 0;
  const hasWorkspace = workspaceRoot !== undefined && workspaceRoot.trim().length > 0;
  if (hasProject === hasWorkspace) throw new Error("set exactly one of WREN_HARNESS_PROJECT or WREN_HARNESS_WORKSPACE_ROOT");
  return hasProject ? "bound" : "bootstrap";
}

/**
 * The full attestation file is local-only; this endpoint-safe view deliberately
 * contains hashes rather than filesystem paths, credentials, or command lines.
 */
export function readLaunchAttestation(mode: "bootstrap" | "bound"): LaunchAttestationPublic {
  const file = process.env["WREN_GENBI_LAUNCH_ATTESTATION"];
  if (!file) throw new Error("local launch attestation is required; run verify:launch before starting the BFF");
  let value: unknown;
  try { value = JSON.parse(readFileSync(file, "utf8")); } catch { throw new Error("local launch attestation cannot be read"); }
  let attestation: LaunchAttestationPublic;
  try { attestation = projectPublicLaunchAttestation(value, mode); } catch { throw new Error("local launch attestation is invalid"); }
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
