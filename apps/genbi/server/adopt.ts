/**
 * Verification for the setup wizard's "adopt an existing project" entry path
 * (`POST /api/setup/adopt`) — points the wizard at a wren project directory
 * that already exists on disk, instead of scaffolding a new one under the
 * bootstrap workspace root (the create flow).
 *
 * Three-state contract: most real/pre-existing projects predate the
 * `profile:` pin feature, so a missing pin is no longer treated as a hard
 * error. `verifyAdoptProject` returns one of:
 *  - `{status: "ok", hasMdl, sourceType}` — already pinned (or just pinned by
 *    the caller, see below) AND the pinned profile's connection passes a live
 *    smoke query. The caller decides bind-now vs `needs_decision(build_context)`
 *    from `hasMdl`.
 *  - `{status: "needs_profile", sourceType, candidates}` — no `profile:` pin,
 *    but at least one profile in `~/.wren/profiles.yml` (`$WREN_HOME` override
 *    honored, see `server/wren-profiles.ts`) matches the project's
 *    `data_source`. `candidates` carries ONLY `{name, datasource}` per
 *    profile — never any other field off that profile (hosts, ports,
 *    credential material) — because this result crosses the wire verbatim as
 *    `SetupAdoptResponse.decision`'s payload; the route surfaces it as a
 *    `needs_decision` checkpoint (kind `"select_profile"`) rather than
 *    silently picking one, even when there's exactly one candidate — the user
 *    always confirms explicitly. The caller resolves this by re-POSTing
 *    `/api/setup/adopt` with the chosen profile name, which runs
 *    `wren context set-profile <name>` (see `runSetProfile`) to write the pin
 *    durably before calling back into this function. That re-POST path must
 *    go through `adoptWithChosenProfile`, not `runSetProfile` directly: it
 *    re-validates the chosen name against the candidate list before writing
 *    anything, and restores the pre-call `wren_project.yml` bytes if the
 *    profile passes that check but still fails the live connection probe —
 *    otherwise a bad choice would durably corrupt the project with no way
 *    back (see that function's doc comment).
 *  - `{status: "error", message}` — verification failed outright: bad path,
 *    no `wren_project.yml`, unsupported connector, no compatible profile at
 *    all (zero candidates), or a failed live smoke query. Nothing was bound.
 *
 * Reuses `wren context validate` for the connection check rather than
 * inventing a new smoke-query mechanism. Confirmed by reading
 * `context_cli.py` directly: `validate`'s connectivity probe
 * (`_check_connection`) runs a trivial query through the resolved profile's
 * connector, and it reads the project's declared YAML
 * (`load_models`/`load_views`/`load_relationships`) rather than a compiled
 * `target/mdl.json` — so it works whether or not the project has been built
 * yet. That's exactly the shape adopt needs: the MDL-missing case must still
 * be able to verify the connection before offering to build context.
 *
 * Never throws: every check that can fail returns a discriminated
 * `AdoptVerifyResult` instead, so a route handler turns any failure into a
 * clean `{status: "error"}` response without wrapping this whole module in a
 * try/catch.
 */
import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { listCandidateProfiles, loadProfileStore, type ProfileCandidate } from "./wren-profiles.js";

export type { ProfileCandidate };

export interface AdoptVerifyOk {
  readonly status: "ok";
  /** Whether `target/mdl.json` already exists — `false` routes the caller to `needs_decision(build_context)` instead of binding immediately. */
  readonly hasMdl: boolean;
  readonly sourceType: string;
}

export interface AdoptVerifyNeedsProfile {
  readonly status: "needs_profile";
  readonly sourceType: string;
  /** At least one entry — zero candidates is reported as `AdoptVerifyError` instead. Ranked: project-dir-name match first, then the global `active` profile, then the rest. */
  readonly candidates: readonly ProfileCandidate[];
}

export interface AdoptVerifyError {
  readonly status: "error";
  /** Names exactly which check failed — surfaced verbatim as `SetupAdoptResponse.message`. */
  readonly message: string;
}

export type AdoptVerifyResult = AdoptVerifyOk | AdoptVerifyNeedsProfile | AdoptVerifyError;

/**
 * Matches a `wren_project.yml` top-level `field: value` scalar line — same
 * single-purpose-regex convention as `server/app.ts`'s `ENV_KEY_LINE`. Only
 * ever reads a handful of known scalar fields (`profile`, `data_source`);
 * never a general YAML parser (matches this repo's existing convention of
 * avoiding a YAML dependency for single-field reads).
 */
function readYamlScalarField(content: string, field: string): string | undefined {
  const re = new RegExp(`^${field}:\\s*(.+?)\\s*$`, "m");
  const match = re.exec(content);
  if (!match) return undefined;
  const raw = match[1]!;
  // Strip one layer of matching quotes (wren_project.yml sometimes quotes scalars, e.g. `version: '1.0'`) — never unescape further, this only ever reads plain identifiers.
  const unquoted = /^(['"])(.*)\1$/.exec(raw);
  return unquoted ? unquoted[2] : raw;
}

function execWren(
  args: readonly string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; error: (NodeJS.ErrnoException & { code?: string }) | null }> {
  return new Promise((resolve) => {
    execFile("wren", args, { cwd, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ stdout, stderr, error: error as (NodeJS.ErrnoException & { code?: string }) | null });
    });
  });
}

/**
 * Verifies an existing wren project directory is adoptable: exists, is a
 * directory, has a `wren_project.yml` with a `data_source:` in
 * `supportedSourceTypes`. If it also has a `profile:` pin, that profile's
 * connection must pass `wren context validate`'s live smoke query. If it has
 * no pin, looks for a compatible profile to propose (see the module doc
 * comment's three-state contract). Never crashes the caller: a missing
 * `wren` binary (ENOENT) is reported the same way as any other verification
 * failure, not thrown.
 */
export async function verifyAdoptProject(
  projectPath: string,
  options: { readonly supportedSourceTypes: ReadonlySet<string> },
): Promise<AdoptVerifyResult> {
  const resolved = path.resolve(projectPath);

  if (!existsSync(resolved)) {
    return { status: "error", message: `no such directory: "${resolved}"` };
  }
  if (!statSync(resolved).isDirectory()) {
    return { status: "error", message: `not a directory: "${resolved}"` };
  }

  const manifestPath = path.join(resolved, "wren_project.yml");
  if (!existsSync(manifestPath)) {
    return { status: "error", message: `"${resolved}" is not a wren project (no wren_project.yml)` };
  }

  let manifest: string;
  try {
    manifest = readFileSync(manifestPath, "utf-8");
  } catch (err) {
    return { status: "error", message: `could not read wren_project.yml: ${err instanceof Error ? err.message : String(err)}` };
  }

  const sourceType = readYamlScalarField(manifest, "data_source");
  if (!sourceType) {
    return { status: "error", message: `wren_project.yml at "${resolved}" has no data_source: field` };
  }
  if (!options.supportedSourceTypes.has(sourceType)) {
    return {
      status: "error",
      message: `data_source "${sourceType}" is not a supported connector — expected one of: ${[...options.supportedSourceTypes].join(", ")}`,
    };
  }

  const profile = readYamlScalarField(manifest, "profile");
  if (!profile) {
    const store = loadProfileStore();
    const candidates = listCandidateProfiles(store, sourceType, path.basename(resolved));
    if (candidates.length === 0) {
      return {
        status: "error",
        message: `wren_project.yml at "${resolved}" has no profile: pinned, and no compatible profile (data_source "${sourceType}") was found in ~/.wren/profiles.yml — run \`wren profile add\` to create one, then retry.`,
      };
    }
    return { status: "needs_profile", sourceType, candidates };
  }

  const { stdout, stderr, error } = await execWren(["context", "validate"], resolved);
  if (error && error.code === "ENOENT") {
    return { status: "error", message: `could not find the "wren" binary while validating "${resolved}" — install wren and ensure it is on PATH.` };
  }
  if (error) {
    const detail = [stdout, stderr].filter(Boolean).join("\n").trim();
    return {
      status: "error",
      message: `connection check failed for profile "${profile}"${detail ? `: ${detail}` : " (wren context validate exited non-zero)"}`,
    };
  }

  const hasMdl = existsSync(path.join(resolved, "target", "mdl.json"));
  return { status: "ok", hasMdl, sourceType };
}

/**
 * Writes a durable `profile:` (+ `data_source:`) pin into an adopted
 * project's `wren_project.yml` by shelling out to `wren context set-profile
 * <name>` in the project directory — reuses the CLI's own bind logic rather
 * than hand-writing YAML here, so the pin ends up byte-for-byte what a user
 * running the command themselves would get. Called by the adopt route when
 * the caller resolves a `needs_profile` checkpoint by re-POSTing with a
 * chosen `profile` name, before re-running `verifyAdoptProject` (which will
 * now see the pin and proceed to the live smoke check).
 */
export async function runSetProfile(projectPath: string, profileName: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const resolved = path.resolve(projectPath);
  const { stdout, stderr, error } = await execWren(["context", "set-profile", profileName], resolved);
  if (error && error.code === "ENOENT") {
    return { ok: false, message: `could not find the "wren" binary while binding profile "${profileName}" in "${resolved}" — install wren and ensure it is on PATH.` };
  }
  if (error) {
    const detail = [stdout, stderr].filter(Boolean).join("\n").trim();
    return {
      ok: false,
      message: `failed to bind profile "${profileName}" to "${resolved}"${detail ? `: ${detail}` : " (wren context set-profile exited non-zero)"}`,
    };
  }
  return { ok: true };
}

/**
 * Confirms `profileName` is actually one of the candidates `verifyAdoptProject`
 * would have offered for this project — i.e. it exists in `~/.wren/profiles.yml`
 * and its `datasource:` matches the project's `data_source:`. The route must
 * call this before `runSetProfile`: a client-supplied `profile` that skipped
 * this check would let `wren context set-profile` durably rewrite
 * `data_source:` to whatever the chosen profile declares (see
 * `context_cli.py`'s `set-profile`), with no compatibility check of its own.
 * Recomputes the candidate list from disk rather than trusting a list the
 * caller might have seen in an earlier response, so a hand-crafted request
 * naming an incompatible or nonexistent profile is rejected here with zero
 * mutation.
 */
export async function validateChosenProfile(
  projectPath: string,
  profileName: string,
  options: { readonly supportedSourceTypes: ReadonlySet<string> },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const resolved = path.resolve(projectPath);

  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    return { ok: false, message: `no such directory: "${resolved}"` };
  }

  const manifestPath = path.join(resolved, "wren_project.yml");
  if (!existsSync(manifestPath)) {
    return { ok: false, message: `"${resolved}" is not a wren project (no wren_project.yml)` };
  }

  let manifest: string;
  try {
    manifest = readFileSync(manifestPath, "utf-8");
  } catch (err) {
    return { ok: false, message: `could not read wren_project.yml: ${err instanceof Error ? err.message : String(err)}` };
  }

  const sourceType = readYamlScalarField(manifest, "data_source");
  if (!sourceType || !options.supportedSourceTypes.has(sourceType)) {
    return { ok: false, message: `wren_project.yml at "${resolved}" has no supported data_source: field` };
  }

  const store = loadProfileStore();
  const candidates = listCandidateProfiles(store, sourceType, path.basename(resolved));
  if (!candidates.some((candidate) => candidate.name === profileName)) {
    const available = candidates.map((candidate) => candidate.name).join(", ");
    return {
      ok: false,
      message: `profile "${profileName}" is not a compatible candidate for "${resolved}" (data_source "${sourceType}") — choose one of: ${available || "(no compatible profiles found)"}`,
    };
  }

  return { ok: true };
}

/**
 * Applies a client-chosen profile to an adopted project and re-verifies it,
 * rolling back on any failure so the project never ends up durably worse off
 * than before the call: `validateChosenProfile` rejects an incompatible or
 * unknown profile before anything is written; if that passes but the
 * subsequent `wren context validate` (inside `verifyAdoptProject`) still
 * fails — dead host, bad credentials, a moved duckdb file — the pre-call
 * `wren_project.yml` bytes are restored so the project falls back to its
 * previous no-pin state. That matters because `save_project_config` drops
 * YAML comments on rewrite, so the ORIGINAL bytes are restored rather than
 * re-serialized, and because restoring to no-pin means the next adopt call
 * naturally re-offers the candidate list (`needs_profile`) instead of
 * re-validating a permanently broken pin forever.
 */
export async function adoptWithChosenProfile(
  projectPath: string,
  profileName: string,
  options: { readonly supportedSourceTypes: ReadonlySet<string> },
): Promise<AdoptVerifyResult> {
  const check = await validateChosenProfile(projectPath, profileName, options);
  if (!check.ok) {
    return { status: "error", message: check.message };
  }

  const resolved = path.resolve(projectPath);
  const manifestPath = path.join(resolved, "wren_project.yml");
  let manifestBackup: Buffer;
  try {
    manifestBackup = readFileSync(manifestPath);
  } catch (err) {
    return {
      status: "error",
      message: `could not snapshot wren_project.yml before applying profile "${profileName}": ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const setResult = await runSetProfile(projectPath, profileName);
  if (!setResult.ok) {
    return { status: "error", message: setResult.message };
  }

  const verified = await verifyAdoptProject(projectPath, options);
  if (verified.status === "error") {
    try {
      writeFileSync(manifestPath, manifestBackup);
    } catch (err) {
      return {
        status: "error",
        message: `${verified.message} (additionally failed to restore wren_project.yml — manual recovery needed: ${err instanceof Error ? err.message : String(err)})`,
      };
    }
    return { status: "error", message: verified.message };
  }

  return verified;
}
