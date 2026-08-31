import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { RenderEnvelope } from "../render/envelope.js";

/** Read-size cap applied before any read/parse — an artifact past
 * this is refused as `too_large` rather than loaded whole into memory. */
const MAX_CONTENT_BYTES = 2 * 1024 * 1024; // 2 MiB

export type ArtifactContentUnavailableReason = "missing" | "unreadable" | "outside_root" | "too_large";

/**
 * `GET /api/artifacts/:id/content`'s response shape. An artifact's
 * `location` is read back and classified into exactly one of these forms —
 * never a fabricated fourth shape:
 * - `envelope`: the file parses as JSON and is envelope-shaped (has a
 *   `blocks` array) — this is what dispatched (`generate_dashboard`/report/chart
 *   agents) always persists.
 * - `text`: the file exists and is readable but isn't envelope-shaped JSON —
 *   this is the common case for in-process's `write_artifact` tool, which lets
 *   the model write arbitrary content (HTML, markdown, plain JSON, ...).
 * - `unavailable`: nothing could be read back; `reason` says why. Every
 *   `unavailable` is a caller-visible degrade to metadata-only, never a
 *   thrown error — a missing/unreadable/outside-root/too-large artifact is
 *   an expected, honestly-reported state, not a route failure.
 */
export type ArtifactContentDto =
  | { readonly form: "envelope"; readonly envelope: RenderEnvelope }
  | { readonly form: "text"; readonly text: string; readonly truncated: boolean }
  | { readonly form: "unavailable"; readonly reason: ArtifactContentUnavailableReason };

/**
 * Resolves an `ArtifactRow.location` back to its on-disk content, scoped to
 * `artifactsRoot` (the same root `resolveArtifactsDir` computes for in-process/B
 * writes — see `in-process.ts` and `turn.ts`'s `maybeCreateDispatchedArtifact`).
 * `location` may be relative (in-process, written under the model's chosen
 * `write_artifact` path, itself scoped to `artifactsRoot` at write time — see
 * `resolveWithinScope` in `exec/local.ts`) or absolute (dispatched always writes
 * an absolute `location`).
 *
 * Containment is checked twice, mirroring `resolveWithinScope`'s
 * `path.relative()`-based escape check (never `startsWith`, which a sibling
 * directory that merely shares the root as a string prefix — e.g.
 * `<root>-evil` — would defeat):
 *
 * 1. On the nominal (pre-existence) resolved path — so a location that's
 *    outside the root by construction (`../../etc/passwd`, or the sibling-
 *    prefix case above) is refused with zero filesystem access.
 * 2. On the `realpath`-resolved path — so a symlink that lives inside the
 *    root but *points* outside it is also refused, after resolving the
 *    symlink (metadata only) but still before any content read.
 *
 * The read size is capped (`MAX_CONTENT_BYTES`) via `statSync` before the
 * file is ever read or parsed.
 */
export function resolveArtifactContent(artifactsRoot: string, location: string): ArtifactContentDto {
  const nominal = path.isAbsolute(location) ? path.resolve(location) : path.resolve(artifactsRoot, location);
  if (escapesRoot(artifactsRoot, nominal)) return { form: "unavailable", reason: "outside_root" };

  let realRoot: string;
  let realTarget: string;
  try {
    realRoot = realpathSync(artifactsRoot);
    realTarget = realpathSync(nominal);
  } catch {
    return { form: "unavailable", reason: "missing" };
  }
  if (escapesRoot(realRoot, realTarget)) return { form: "unavailable", reason: "outside_root" };

  let size: number;
  try {
    size = statSync(realTarget).size;
  } catch {
    return { form: "unavailable", reason: "unreadable" };
  }
  if (size > MAX_CONTENT_BYTES) return { form: "unavailable", reason: "too_large" };

  let raw: string;
  try {
    raw = readFileSync(realTarget, "utf-8");
  } catch {
    return { form: "unavailable", reason: "unreadable" };
  }

  const envelope = tryParseEnvelope(raw);
  return envelope ? { form: "envelope", envelope } : { form: "text", text: raw, truncated: false };
}

/** Same escape condition as `exec/local.ts`'s `resolveWithinScope`. */
function escapesRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative.startsWith("..") || path.isAbsolute(relative);
}

function tryParseEnvelope(raw: string): RenderEnvelope | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  return hasBlocksArray(parsed) ? (parsed as RenderEnvelope) : undefined;
}

/** Mirrors the private `hasBlocksArray` shape-check in `render/envelope.ts` — reimplemented
 * locally rather than exported from there, to keep that module's blast radius unchanged. */
function hasBlocksArray(value: unknown): value is { blocks: unknown[] } {
  return typeof value === "object" && value !== null && Array.isArray((value as Record<string, unknown>).blocks);
}
