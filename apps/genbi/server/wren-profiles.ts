/**
 * Reads the wren CLI's global connection-profile store (`profiles.yml`, at
 * `$WREN_HOME/profiles.yml`, defaulting to `~/.wren/profiles.yml` — mirrors
 * `core/wren/src/wren/profile.py`'s own `WREN_HOME` resolution so this reads
 * the exact same file the CLI would) into an in-process shape other BFF
 * modules can query.
 *
 * Deliberately NOT narrowed to any one caller's needs: `server/adopt.ts`'s
 * adopt flow only ever needs `{name, datasource}` candidates — and must never
 * let credentials cross the wire, see `listCandidateProfiles`'s doc comment —
 * but another module resolves a project's pinned profile into a non-secret
 * connection summary for display and needs the rest of a profile's fields
 * (host/port/database/url/...). Both read through this one parser so there is
 * exactly one YAML-shape understanding of profiles.yml in this repo, not two
 * that can silently drift apart.
 *
 * Hand-rolled indentation-aware scan, not a general YAML parser dependency —
 * matches this repo's existing convention (see `server/adopt.ts`'s
 * `readYamlScalarField`) of small single-purpose parsers over pulling in a
 * YAML dependency just to read a handful of known fields: profiles.yml is
 * exactly two levels deep (`profiles.<name>.<field>`) plus one top-level
 * `active:` scalar, so a generic multi-document YAML parser would be most of
 * a new dependency spent reading a shape this constrained.
 */
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** One profile's raw field map, as declared in profiles.yml (values still `${VAR}`-templated — this module never expands or otherwise touches secret material, it only reads structure). */
export type ProfileFields = ReadonlyMap<string, string>;

export interface ProfileStore {
  /** The store's global `active:` profile name, or `undefined` if unset/null. */
  readonly active: string | undefined;
  readonly profiles: ReadonlyMap<string, ProfileFields>;
}

/** The only shape ever allowed to cross the wire to the frontend — see `listCandidateProfiles`. */
export interface ProfileCandidate {
  readonly name: string;
  readonly datasource: string;
}

function wrenHomeDir(): string {
  const override = process.env.WREN_HOME?.trim();
  return override ? override : path.join(os.homedir(), ".wren");
}

/** Absolute path to the profiles store this process would read — exported so callers (and tests) can point elsewhere via `WREN_HOME` without guessing the join. */
export function profilesFilePath(): string {
  return path.join(wrenHomeDir(), "profiles.yml");
}

/** Strips one layer of matching quotes — same convention as `server/adopt.ts`'s `readYamlScalarField`. */
function unquote(raw: string): string {
  const match = /^(['"])(.*)\1$/.exec(raw);
  return match ? match[2]! : raw;
}

/**
 * Parses profiles.yml's known two-level shape:
 * ```yaml
 * active: <name>
 * profiles:
 *   <name>:
 *     <field>: <value>
 *     ...
 * ```
 * Never throws on malformed content — returns as much as it could confidently
 * parse (an empty profiles map in the worst case), mirroring this module's
 * "profile discovery degrades to nothing found" philosophy: a broken
 * profiles.yml should surface as "no candidates" to callers, not crash them.
 */
export function parseProfileStore(content: string): ProfileStore {
  const lines = content.split(/\r?\n/);

  const activeMatch = /^active:\s*(.*)$/m.exec(content);
  const activeRaw = activeMatch ? activeMatch[1]!.trim() : "";
  const active = activeRaw && activeRaw !== "null" && activeRaw !== "~" ? unquote(activeRaw) : undefined;

  const profiles = new Map<string, Map<string, string>>();
  const profilesLineIdx = lines.findIndex((line) => /^profiles:\s*$/.test(line));
  if (profilesLineIdx === -1) return { active, profiles };

  // `nameIndent` is established from the first profile-name line seen (a bare `<name>:` key with
  // no value) and used to tell a new profile name apart from that profile's own nested fields —
  // real profiles.yml files use 2-space name indent / 4-space field indent, but this doesn't
  // hardcode that, it just requires field lines to be indented deeper than their profile's name.
  let nameIndent: number | undefined;
  let current: Map<string, string> | undefined;

  for (let i = profilesLineIdx + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;
    if (indent === 0) break; // back to a top-level key — the profiles block ended

    const nameMatch = /^(\s+)([\w.-]+):\s*$/.exec(line);
    if (nameMatch && (nameIndent === undefined || indent === nameIndent)) {
      nameIndent = indent;
      current = new Map<string, string>();
      profiles.set(nameMatch[2]!, current);
      continue;
    }
    if (current === undefined || nameIndent === undefined || indent <= nameIndent) continue;

    const fieldMatch = /^\s+([\w.-]+):\s*(.*)$/.exec(line);
    if (fieldMatch) {
      current.set(fieldMatch[1]!, unquote(fieldMatch[2]!.trim()));
    }
  }
  return { active, profiles };
}

/** Reads and parses profiles.yml off disk. Returns an empty store (never throws) when the file is missing or unreadable — same "degrade to nothing found" contract as `parseProfileStore`. */
export function loadProfileStore(): ProfileStore {
  const file = profilesFilePath();
  if (!existsSync(file)) return { active: undefined, profiles: new Map() };
  try {
    return parseProfileStore(readFileSync(file, "utf-8"));
  } catch {
    return { active: undefined, profiles: new Map() };
  }
}

/**
 * Candidate profiles for the adopt flow's profile-select checkpoint: every
 * profile whose `datasource:` field equals the project's `data_source`,
 * ranked with the profile named after the project directory first, then the
 * store's global `active` profile, then the rest in `profiles.yml`'s own
 * declaration order (stable sort). Returns ONLY `{name, datasource}` — never
 * crosses the wire with anything else in a profile's field map (hosts, ports,
 * credential material) per the adopt route's hard "no credentials to the
 * frontend" rule; callers that need more of a profile's fields should read
 * `store.profiles` directly, in-process, rather than widening this type.
 */
export function listCandidateProfiles(store: ProfileStore, sourceType: string, projectDirName: string): readonly ProfileCandidate[] {
  const rank = (name: string): number => (name === projectDirName ? 0 : name === store.active ? 1 : 2);
  return [...store.profiles.entries()]
    .map(([name, fields], index) => ({ name, datasource: fields.get("datasource"), index }))
    .filter((c): c is { name: string; datasource: string; index: number } => c.datasource === sourceType)
    .sort((a, b) => rank(a.name) - rank(b.name) || a.index - b.index)
    .map(({ name, datasource }) => ({ name, datasource }));
}
