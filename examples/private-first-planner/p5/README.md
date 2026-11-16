# Free frontend design experiment

Both designers receive the same approved synthetic aggregates and operator-authored
brief. The `design_free_dashboard` Warble component supplies their common behavior;
the host retains authorization, deadlines, disclosure, rendering and validation.
Models return HTML, CSS and JavaScript, with no prescribed dashboard template.
Semantic data attributes support inspection without prescribing layout.

Run all four P4 cases twice, paired between Nemotron and Claude, with balanced arm
order. Each pair shares one actual planner/Wren query stage. Each arm gets one
generation, 4,096 output tokens and 90 seconds, with no repair or selective retry.
Nemotron thinking is disabled; Claude Sonnet 5.5 uses native adaptive thinking with
medium effort, included in its output budget. These are different inference modes.
Keep every failure, request, raw response, source hash and protocol snapshot.

## Run

Use Node 22, macOS, the pinned Wren environment and the same authorized synthetic
fixture configuration as P4. Copy that fixture/config to a new evidence directory;
update the service audit path and its grant hash. Never reuse a prior output path.

```sh
npm ci --ignore-scripts --prefix p1
npm ci --ignore-scripts --prefix p5
p5/node_modules/.bin/playwright install chromium
node --test p5/test/*.test.mjs
node p5/run.mjs /absolute/config.json /absolute/new-run
```

Credentials come from the configuration's environment-variable names, never files
or model-visible input. Running the benchmark makes live paid/model calls.
A nonzero exit may represent retained quality failures, not an incomplete run;
inspect `report.json` and verify all eight blocks and sixteen arms are present.

## Execution boundary

Generated JavaScript executes only in Chromium, never Node or a host shell.
macOS `sandbox-exec` denies IP networking (IPv4/IPv6/UDP), and home file contents
and writes except reads of the installed Chromium app. File metadata and local
Unix IPC remain available. Chromium cannot nest its native Seatbelt sandbox, so
its native process sandbox is disabled under this mandatory inherited OS policy.
Other platforms fail closed. This is a bounded local experiment, not a general
untrusted-code hosting service or a claim of complete filesystem isolation.

The browser has no model credentials. An opaque `sandbox="allow-scripts"` iframe,
hash-based CSP, offline context, blocked routes/WebSockets/service workers and a
separate process-group watchdog provide additional boundaries. Do not add
`allow-same-origin`, relax CSP, or execute generated installers/dependencies.
Structural validation is not a JavaScript sanitizer. Negative tests exercise
network denial, home access, parent/storage/eval/popup access and infinite loops.
The trusted browser bootstrap starts the generated program only after the opaque iframe has
nonzero layout dimensions. This prevents first-layout races from being mistaken
for model chart defects. Screenshots also wait for the iframe's painted surface.

Share screenshot-only galleries. Keep generated source in `artifact.json`; never
publish it as active HTML or render it in the user's authenticated browser.

## Measurement and limits

Desktop 1280×900 and mobile 390×844 checks cover visible values/dates/period,
details controls, overflow, font size, script errors and contrast. A second data
payload tests rebinding rather than hardcoded fixture values. Axe contrast
incomplete results require manual review; they are not contrast violations or
automatic passes. Chart existence and labels do not prove correct chart geometry;
inspect screenshots and source, and report any semantic mistakes separately.

Report generated/functional/readability gates separately from the five visual
ratings (hierarchy, readability, chart fit, consistency, polish; each 1–5).
Implementing-agent inspection is not independent blinded preference. Include all
attempts in latency/cost summaries and distinguish generation, browser QA and
shared query time. Claude cost is its client estimate, not an invoice. Unknown
Nemotron deployment cost is not zero. A hosted NVIDIA endpoint does not establish
private deployment. This small fixed dataset and token budget limit conclusions.
