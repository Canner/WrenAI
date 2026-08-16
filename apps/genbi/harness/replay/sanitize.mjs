#!/usr/bin/env node
/**
 * Cassette sanitization check (Setup dispatcher capture/replay, deliverable #6).
 *
 * A cassette is raw dispatcher stdout, recorded on a developer's own machine, landing in a PUBLIC
 * repository. It can carry absolute local paths, workspace/machine names, credential echoes in
 * command text, and provider/session/runner identifiers. This module is the automated check, not
 * a review convention: it is meant to be run (see `runCli()` below, and wired into whatever this
 * repo's pre-commit/CI convention is) against every file under a cassette directory before it is
 * committed.
 *
 * Exports `scanText`/`scanCassetteDir` as plain, importable functions so `test/cassette-
 * sanitize.test.ts` can assert this check actually fires on deliberately dirty input — a
 * sanitizer nobody has ever seen fail is not a verified sanitizer.
 *
 * ## Built-in patterns are deliberately generic
 *
 * This file lives in a public repository, so the built-in pattern list below covers only
 * universal categories (absolute local paths, credential-shaped strings, a personal-ticket-prefix
 * convention) — it never hardcodes the name of any specific private repository, host, or
 * organization-internal codename, because doing so would itself be exactly the kind of disclosure
 * this checker exists to prevent. If your organization has its own private names a cassette must
 * never contain, supply them as extra patterns (see `loadLocalExtraPatterns` below) via a local,
 * gitignored file — never add them to this array.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

/**
 * @typedef {{ readonly pattern: string; readonly line: number; readonly excerpt: string }} LeakFinding
 * @typedef {{ readonly name: string; readonly source: string; readonly flags?: string }} ExtraPattern
 */

// Each pattern is named for the report; `re` must NOT be global-sticky-stateful across calls, so
// a fresh RegExp is constructed at scan time rather than reused with `.lastIndex` bookkeeping.
const PATTERNS = [
  { name: "absolute-unix-home-path", make: () => /\/(?:Users|home)\/[^\s"'<>]+/g },
  // The drive letter must stand alone. Without the lookbehind this fires on any `word:\n` inside
  // escaped JSON — `"summary":"…y:\\n#"` and `"Status:\\n\\n**"` both matched, which is constant
  // noise in an NDJSON cassette and trains readers to ignore the checker.
  { name: "absolute-windows-path", make: () => /(?<![A-Za-z0-9])[A-Za-z]:\\[^\s"'<>]+/g },
  // Issue-tracker key prefixes are deliberately NOT built in. A prefix names the tracker it
  // belongs to, so hardcoding one here would publish the very convention this file exists to keep
  // out of cassettes — and a generic `[A-Z]{2,6}-\d+` catch-all would fire on ordinary technical
  // tokens (UTF-8, SHA-256, ISO-8601). Operators declare their own prefixes as extra patterns.
  { name: "credential-like-assignment", make: () => /\b(?:api[_-]?key|secret|token|password|auth[_-]?token)\s*[:=]\s*['"]?[^\s'",]{6,}/gi },
  { name: "anthropic-style-secret", make: () => /\bsk-(?:ant-)?[A-Za-z0-9_-]{10,}\b/g },
  { name: "aws-style-access-key", make: () => /\bAKIA[0-9A-Z]{16}\b/g },
  // A dispatcher/agent-SDK session id. The shape (a bare UUID) is generic, but the value is a
  // real per-run identifier from whatever backend recorded the cassette — never safe to publish.
  { name: "uuid-session-id", make: () => /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g },
  // Anthropic tool-use ids (`toolu_...`) pair a `tool_call` with its `tool_result` in the wire
  // format, but the id itself is a real per-call identifier, not a fixture-local label.
  { name: "anthropic-tool-use-id", make: () => /\btoolu_[A-Za-z0-9_-]{6,}\b/g },
];

/**
 * @param {string} text
 * @param {readonly ExtraPattern[]} [extraPatterns] - caller-supplied patterns (e.g. loaded from a
 *   local, gitignored config) merged in alongside the generic built-ins above.
 * @returns {LeakFinding[]}
 */
export function scanText(text, extraPatterns = []) {
  const findings = [];
  const lines = text.split("\n");
  const allPatterns = [
    ...PATTERNS,
    ...extraPatterns.map((p) => ({ name: p.name, make: () => new RegExp(p.source, p.flags ?? "g") })),
  ];
  for (const { name, make } of allPatterns) {
    const re = make();
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      const matches = line.match(re);
      if (matches && matches.length > 0) {
        findings.push({ pattern: name, line: lineIndex + 1, excerpt: line.slice(0, 200) });
      }
    }
  }
  return findings;
}

/**
 * @param {string} dir
 * @param {readonly ExtraPattern[]} [extraPatterns]
 * @returns {Promise<{ readonly file: string; readonly findings: LeakFinding[] }[]>}
 */
export async function scanCassetteDir(dir, extraPatterns = []) {
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return []; // no cassette directory yet — nothing recorded, nothing to check.
  }
  const results = [];
  for (const entry of entries) {
    if (!entry.endsWith(".ndjson") && !entry.endsWith(".meta.json")) continue;
    const filePath = path.join(dir, entry);
    const content = await readFile(filePath, "utf-8");
    const findings = scanText(content, extraPatterns);
    if (findings.length > 0) results.push({ file: filePath, findings });
  }
  return results;
}

/**
 * Loads organization-specific extra patterns from a local, gitignored JSON file (see
 * `.gitignore`'s entry for `harness/replay/.sanitize-local-patterns.json`) if one is present.
 * Absent by default — this repo's own checked-in state never supplies any.
 *
 * @param {string} [filePath]
 * @returns {Promise<ExtraPattern[]>}
 */
export async function loadLocalExtraPatterns(filePath = path.join(import.meta.dirname, ".sanitize-local-patterns.json")) {
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p) => p && typeof p.name === "string" && typeof p.source === "string");
  } catch {
    return []; // no local file — that's the expected, checked-in default.
  }
}

async function runCli() {
  const dir = process.argv[2] ?? path.join(import.meta.dirname, "..", "..", "test", "fixtures", "cassettes");
  const extraPatterns = await loadLocalExtraPatterns();
  const results = await scanCassetteDir(dir, extraPatterns);
  if (results.length === 0) {
    process.stdout.write(`sanitize: clean — no leak patterns found under ${dir}\n`);
    process.exit(0);
    return;
  }
  for (const { file, findings } of results) {
    for (const finding of findings) {
      process.stderr.write(`sanitize: ${file}:${finding.line}: [${finding.pattern}] ${finding.excerpt}\n`);
    }
  }
  process.stderr.write(`sanitize: FAILED — ${results.reduce((n, r) => n + r.findings.length, 0)} finding(s) across ${results.length} file(s)\n`);
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().catch((error) => {
    process.stderr.write(`sanitize: unexpected failure: ${String(error)}\n`);
    process.exit(1);
  });
}
