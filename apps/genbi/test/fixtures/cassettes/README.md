# Dispatcher cassettes

This directory holds recorded dispatcher stdout (`<key>.ndjson` + `<key>.meta.json`), produced by
`harness/replay/capture-wrapper.mjs` and consumed by `harness/replay/replay-wrapper.mjs`. See
`harness/replay/README.md` for the full recording/replay/staleness story.

**As of this packet, this directory is empty.** Recording a real cassette requires a live
personal-subscription turn, which was not authorized in the packet that built this machinery.
`harness/replay/run-harness.mjs` runs correctly against an empty directory — it reports the
expected "missing cassette" outcome rather than failing unexpectedly.

Before adding any file here:

1. It must come from `capture-wrapper.mjs` recording a real dispatcher, or from reusing an
   artefact a real dispatcher genuinely produced. Never hand-author a file in this directory.
2. Run `node harness/replay/sanitize.mjs test/fixtures/cassettes` and fix anything it flags.
3. Name it `<subcommand>__<component>__<scenario>.ndjson` / `.meta.json`, matching
   `computeCassetteKey` in `harness/replay/cassette-key.mjs` — the two wrappers must agree on the
   key or the recording will never be found.
