#!/usr/bin/env node
/**
 * Deterministic cassette-selection key, shared by `capture-wrapper.mjs` (writes) and
 * `replay-wrapper.mjs` (reads) so the two can never disagree about which cassette a given
 * invocation belongs to.
 *
 * ## The rule
 *
 * `key = "<subcommand>__<component>__<scenario>"`, where:
 *
 *  - `subcommand` is `argv[0]` as the BFF's own runner builds it — `"chat"` for dispatched
 *    (`harness/route/dispatched.ts`'s `buildAgentSdkChatArgs`) or `"dispatch"` for Codex
 *    (`harness/setup/runner.ts`'s `CodexSetupRunner`). This is a fixed literal per back-end,
 *    never a path.
 *  - `component` is the value that follows `--component` in argv — e.g. `connect_source` /
 *    `build_context` for setup, or an Ask agentId. This is a stable identifier the harness
 *    itself controls per step; it is never a temp path or otherwise volatile.
 *  - `scenario` is supplied out-of-band via `WREN_HARNESS_CASSETTE_SCENARIO` (default
 *    `"default"`), never derived from argv. It exists so the same (subcommand, component) pair
 *    can resolve to different recorded outcomes (e.g. a connect success vs. a connect error) —
 *    the harness run picks the scenario before it boots the BFF, not by inspecting request
 *    content.
 *
 * Deliberately EXCLUDED from the key: `--project`/`--out`/the positional prompt/irPath — every
 * one of those embeds a run-specific temp directory (the harness's throwaway workspace root), so
 * keying on them would make the same logical invocation resolve to a different cassette on every
 * run. Excluding them is what makes the rule deterministic across runs with different temp dirs.
 *
 * If `--component` is absent (should not happen for any setup/Ask dispatch this harness drives,
 * but a defensive fallback beats a crash), the key falls back to `"unknown"` for that segment —
 * callers can still find such a cassette by name, they just won't get automatic component-based
 * disambiguation.
 */

/**
 * @param {readonly string[]} argv - the argv the wrapper itself received (`process.argv.slice(2)`),
 *   i.e. exactly what the BFF would have passed to the real dispatcher binary.
 * @param {string} [scenario] - defaults to `WREN_HARNESS_CASSETTE_SCENARIO`, then `"default"`.
 * @returns {string}
 */
export function computeCassetteKey(argv, scenario = process.env.WREN_HARNESS_CASSETTE_SCENARIO ?? "default") {
  const subcommand = argv[0] ?? "unknown";
  const componentIndex = argv.indexOf("--component");
  const component = componentIndex >= 0 && argv[componentIndex + 1] !== undefined ? argv[componentIndex + 1] : "unknown";
  // Scenario is a selection label, not a path or free text captured from the environment at
  // large — restrict it to a safe filename alphabet so it can never be used to escape the
  // cassette directory or inject a path separator.
  const safeScenario = /^[A-Za-z0-9_-]+$/.test(scenario) ? scenario : "default";
  return `${subcommand}__${component}__${safeScenario}`;
}

/** @param {string} key */
export function cassetteBasename(key) {
  return key;
}

/** @param {string} key */
export function ndjsonFilename(key) {
  return `${key}.ndjson`;
}

/** @param {string} key */
export function metaFilename(key) {
  return `${key}.meta.json`;
}
