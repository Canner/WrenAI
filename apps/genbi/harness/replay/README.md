# Dispatcher capture/replay (Setup, zero model cost)

This directory replaces the BFF's dispatcher *executable* with a wrapper, so the Setup flow can be
exercised end-to-end — real spawn, real stdout parsing, real `server/fold.ts`, real host gates in
`harness/setup/runner.ts`, real SQLite/REST/SSE — without a live model call and without hand-authoring
any dispatcher output. This is a deliberate design choice: **stub at the process boundary, never at
a higher, more convenient seam, and never hand-author a fixture that claims to be another layer's
output.** A cassette must come from recording a real dispatcher, or reusing an artefact a real
dispatcher genuinely produced.

## The two wrappers

- **`capture-wrapper.mjs`** — runs the real dispatcher underneath and tees its stdout to a
  cassette file. Transparent: same argv, stdin, stderr, and exit code a caller would see running
  the real dispatcher directly. Point `WREN_HARNESS_AGENT_SDK_BIN` / `WREN_HARNESS_CODEX_LOCAL_BIN`
  at it, plus:
  - `WREN_HARNESS_CASSETTE_REAL_BIN` — the real dispatcher command to exec.
  - `WREN_HARNESS_CASSETTE_REAL_ARGS_PREFIX` — optional JSON array of args to prepend (e.g. a
    dev-mode `tsx <entry>` prefix), mirroring `ResolvedCli.prefixArgs`.
  - `WREN_HARNESS_CASSETTE_DIR` — where to write `<key>.ndjson` + `<key>.meta.json`.

- **`replay-wrapper.mjs`** — plays a previously-recorded cassette back as the dispatcher's stdout.
  No subprocess, no network, no model cost. Point the same two BFF env vars at it, plus
  `WREN_HARNESS_CASSETTE_DIR` (and optionally `WREN_HARNESS_CASSETTE_SCENARIO`, default
  `"default"`). If no cassette matches, it exits **66** and names the missing key on stderr —
  deliberately, so a missing recording fails loudly instead of silently inventing a plausible
  response.

Both wrappers select a cassette using the same deterministic rule, in `cassette-key.mjs`:

```
key = "<subcommand>__<component>__<scenario>"
```

- `subcommand` = `argv[0]` (`"chat"` for Mode B, `"dispatch"` for Codex) — a fixed literal per
  back-end, never a path.
- `component` = the value following `--component` in argv (e.g. `connect_source`,
  `build_context`, or an Ask agentId) — a stable identifier the harness itself controls.
- `scenario` = `WREN_HARNESS_CASSETTE_SCENARIO`, out-of-band, default `"default"`.

Deliberately **excluded**: `--project` / `--out` / the positional prompt or IR path — all of those
embed a run-specific temp directory, so keying on them would make the same logical invocation
resolve to a different cassette every run. See `cassette-key.mjs`'s doc comment for the full
rationale.

## Recording a cassette (not run in this work packet)

```bash
WREN_HARNESS_AGENT_SDK_BIN=harness/replay/capture-wrapper.mjs \
WREN_HARNESS_CASSETTE_REAL_BIN=<path to the real warble-agent-sdk / warble-codex-local binary> \
WREN_HARNESS_CASSETTE_DIR=test/fixtures/cassettes \
  <boot the BFF and drive the Setup step you want to capture through the UI or run-harness.mjs>
```

This requires a live personal-subscription turn (real model call) and was **not authorized** in
the packet that built this machinery — see the ticket for why. **After recording, and before
committing anything under `test/fixtures/cassettes/`, run the sanitizer:**

```bash
node harness/replay/sanitize.mjs test/fixtures/cassettes
```

It scans every `.ndjson`/`.meta.json` file for absolute local paths and credential-shaped strings,
and exits non-zero if it finds any. Issue-tracker key prefixes are **not** built in: a prefix names
the tracker it belongs to, so declare yours as an extra pattern (below) rather than expecting the
defaults to catch them. See
`test/cassette-sanitize.test.ts` for proof it actually fires on dirty input rather than being a
check nobody has seen fail.

The built-in pattern list is deliberately generic — this is a public repository, so it never
hardcodes any specific private repo name, host, or organization-internal codename. If your
organization has its own private names a cassette must never contain, supply them as extra
patterns via a local, gitignored `harness/replay/.sanitize-local-patterns.json` (a JSON array of
`{"name": "...", "source": "<regex source>", "flags": "g"}`, loaded automatically by `sanitize.mjs`'s
CLI entry point if present) — never add them to `sanitize.mjs`'s own committed pattern array.

## Replaying / running the harness

```bash
pnpm run build                    # produces dist-server/server/bin.js
node harness/replay/run-harness.mjs
```

`run-harness.mjs` boots a real BFF on a spare port (default `4799` — distinct from any live manual
session's ports) against a throwaway SQLite DB in a fresh temp directory, with both dispatcher env
vars pointed at `replay-wrapper.mjs`, then drives `POST /api/setup/connect` and the SSE stream over
real HTTP, and reports what happened. Env overrides: `WREN_HARNESS_RUN_PORT`,
`WREN_HARNESS_RUN_CASSETTE_DIR` (default `test/fixtures/cassettes`),
`WREN_HARNESS_CASSETTE_SCENARIO`.

## Honest limits

`test/fixtures/cassettes/` holds **no real dispatcher recording** as of this packet. Without one,
`run-harness.mjs` gets the *expected* "missing cassette" outcome (replay wrapper exits 66) and
reports that as the expected state, not a bug — see the script's own doc comment. What that run
still proves without a cassette: the BFF boots in bootstrap mode, `POST /api/setup/connect`
dispatches a real turn through the real `ModeBSetupRunner` → a real spawn of whatever
`WREN_HARNESS_AGENT_SDK_BIN` names, and the SSE stream reports the resulting failure instead of
hanging. What it does **not** prove without a real recording: that real dispatcher bytes correctly
drive `server/fold.ts` and the setup terminal gate to an `ok` outcome for a genuine connect/build
turn. Closing that gap requires an actual capture, sanitized and checked in, which is out of scope
for this packet.

## Staleness

Neither wrapper validates that a cassette's lines still match the dispatcher's current protocol —
`replay-wrapper.mjs` just re-emits bytes, it never parses them. Staleness surfaces for free,
downstream, in the real code this harness exercises: `harness/route/chat-event-mapper.ts`'s event
parser (Mode B) / the Codex event mapper drop any line that doesn't structurally match their
current vocabulary — silently for one malformed line, but visibly (a stalled/errored turn, an
empty work log, `parseSetupTerminal` never reaching `ok`) if a whole cassette has gone stale
against a changed protocol. A stale cassette cannot produce a false "ok": the real parser it flows
through never accepted the old shape as the new one.

**Refresh procedure**, when a dispatcher protocol change is suspected or confirmed:

1. Re-record every affected cassette per "Recording a cassette" above, against the new dispatcher
   build.
2. Re-run the sanitizer.
3. Re-run `run-harness.mjs` and the focused suites (`test/parse-setup-terminal.test.ts`,
   `test/fold-to-setup-terminal.integration.test.ts`, BFF setup-route tests) and confirm the
   terminal outcome is still the one you expect.
4. If a cassette cannot be re-recorded (e.g. the scenario that produced it is no longer
   reachable), delete it rather than leaving a stale recording in place — an absent cassette fails
   loudly (exit 66); a stale one risks masking a real regression under an unrelated red/green
   result.
