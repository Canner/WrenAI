# Collaboration baseline

This source package is for review and independent integration. It preserves the
existing host, Warble prompts, service adapter and evaluation protocols. It does
not promote a model or change the historic live results. Commands below run from
`examples/private-first-planner`, including when extracted from the handoff archive.

## Review in dependency order

1. [Contracts](CONTRACTS.md), `harnesses/`, `worker/retrieval.mjs` and the worker handoff.
2. `behaviors/profile/` and `worker/profile/`: application-owned Warble components.
3. `host/store.mjs`, `controller.mjs`, `export.mjs`, `policy.mjs`, `runtime.mjs`:
   trusted state, authority and Wren integration. Read `host/README.md` for limits.
4. `design/` and `host/validation.mjs`: isolated frontend generation/admission;
   `host/pi.mjs`, `http.mjs`, `tui.mjs`: planner and authenticated local interface.
5. `eval/`, `collaboration/`, tests, lockfiles and the dedicated CI workflow.

The application controller is `host/controller.mjs`. Current reusable modules
are grouped by responsibility in `planner/`, `worker/` and `design/`.
The branch ships one host architecture and its independent evaluation surfaces.

## Ownership and change discipline

| Maintainer | Owns | Must coordinate changes to |
| --- | --- | --- |
| Worker | `worker/profile/`, Wren query/evidence behavior and independent evaluation | Task/result contracts, evidence semantics, supported grain, service version |
| Planner | `resolve_intent`, `host/pi.mjs`, intent admission | Retrieval grouping, question contract, route proposal shape |
| Design | `design_free_dashboard`, `repair_dashboard`, design adapter | Authorized payload, frontend code and QA contract |
| Host | Wren client/session adapter, task journal, trusted commands, routing, disclosure, budgets, artifact admission | All boundary changes; no model can approve one |
| Evaluation | Cases, hidden oracles, scorers, browser observations, run manifests | Report comparability and any changed denominator |

Prompts/profiles belong to this consumer. Warble compiler/runtime supply public
mechanisms; this package does not copy their implementation or put revenue policy
inside Warble core. Keep endpoint and credentials in local deployment config.

For a behavior-only change: regenerate with the pinned compiler, run that unit's
suite and adjacent contract gates, then compare a new immutable live run when
explicitly authorized. A green scripted suite proves contract behavior, not
prompt quality. Breaking input/output changes require a new contract ID and
coordinated producer, consumer, scorer and migration/replay coverage. Release
fingerprints are separate from contract versions; never edit old run manifests.

## Setup

Node 22+, Python 3.11 for Wren, and macOS for isolated browser execution.
Dependency installation uses network access; the test gates below use no paid
models. Never reuse production credentials or a production database for them.

```sh
npm ci --prefix host/adapters --ignore-scripts --no-audit --no-fund
npm ci --prefix host --ignore-scripts --no-audit --no-fund
npm ci --prefix design --ignore-scripts --no-audit --no-fund
```

For service and Python gates, use the [worker setup](DATA-WORKER.md). For browser
gates, install the pinned Playwright Chromium with
`design/node_modules/.bin/playwright install chromium`. For behavior drift checks,
run `npm ci --prefix collaboration/runtime --no-audit --no-fund` and set
`WARBLE_BIN` to `./collaboration/runtime/node_modules/.bin/warble`, or use an
existing matching compiler. The runtime lock preserves transitive dependencies.
These commands never silently install, download, start a live provider or change
your model configuration during a test run.

## One gate, one new output directory

```sh
node collaboration/check.mjs worker-contracts /absolute/path/to/new-contract-run
node collaboration/check.mjs offline /absolute/path/to/new-offline-run
node collaboration/check.mjs behaviors /absolute/path/to/new-compile-run
node collaboration/check.mjs python /absolute/path/to/new-python-run /absolute/path/to/worker-config.json
node collaboration/check.mjs worker-service /absolute/path/to/new-worker-run /absolute/path/to/worker-config.json
node collaboration/check.mjs host-service /absolute/path/to/new-host-run /absolute/path/to/worker-config.json
node collaboration/check.mjs browser /absolute/path/to/new-browser-run
```

| Gate | Requires | What it proves |
| --- | --- | --- |
| worker-contracts | Node only | Actual worker session boundary, classification, failure and continuation behavior |
| offline | `host/adapters` and `host` npm dependencies | All offline regressions, independent scripted planner/cloud suites |
| behaviors | Pinned compiler | Checked-in revenue and interactive IR/manifests match component sources |
| interactive | macOS, `design` dependencies, Chromium | Four synthetic dashboard cases, desktop/mobile journeys, changed data, negative probes and repair; no live models |
| python | Pinned Wren Python environment | Released parser compatibility and fixture syntax |
| worker-service | Pinned Wren/runtime/loader + `host/adapters` dependencies | Six worker cases through real Wren, SQL gate and DB, using only loopback scripted model |
| host-service | Worker prerequisites + `host` dependencies | Four requests × three routes through the actual host; browser QA is scripted in this gate |
| browser | macOS, `host/adapters`/`host`/`design` dependencies, Chromium | Actual isolated rendering, rebinding, repair/viewer and cloud-unit QA |

Use `host/verify.mjs OUT CONFIG --browser` for an optional combined real-Wren and
real-browser run on macOS. CI separates service and browser gates by platform.
Each wrapper emits `summary.json` and per-step logs. A failed step is retained;
the wrapper returns nonzero and does not replace samples. Provider secrets,
proxy variables and `NODE_OPTIONS` are not inherited by its children.

The dedicated workflow runs these same entries without repository secrets. It
also checks changed sibling fixture/loader files, because they affect worker
tests. Local success is not a claim about a remote GitHub Actions run.

## Export a source handoff

After committing the intended source (no push required):

```sh
node collaboration/package.mjs /absolute/path/to/new-package-output
```

The archive contains tracked example source, the three required sibling fixture
helper files, license and CI workflow, with source revision and SHA-256 manifest.
It refuses dirty package inputs and writes `SHA256SUMS`. It excludes dependencies,
credentials, raw model/audit traces and historical generated artifacts. Extract
anywhere, verify the archive digest, follow the same guide, and use fresh output
directories. The context-loader binary/source is an external pinned prerequisite,
not bundled. Full-repository CI is run from a checkout, not from the small archive.

When handing a change back, include the source revision, changed contract/release
IDs, exact tool versions, new test summaries, failed cases, and model usage (if
authorized). Share synthetic summaries by default. Private audit, local paths,
tokens and real results need their own sharing approval; never upload them as a
public CI artifact.

The opt-in [interactive dashboard laboratory](../interactive/README.md) has a separate
aggregate/interaction contract and scripted gate. It does not replace the existing
pi/Wren route or reclassify previous model results. Run `interactive` alongside
`browser`, `offline` and `behaviors` when changing interactive design/QA.

The [monthly revenue replay workflow](../revenue/README.md) is included in the
`offline`, `browser` and `behaviors` gates. It reuses shared pi, export and designer
boundaries without changing the durable Wren controller or worker protocol.

The optional [cube-backed report adapter](../revenue/report/README.md) projects a
privately reconciled revenue snapshot into a capability contract and standalone
HTML query runtime. Its host transport seam is tested with scripted responses;
real host query execution remains a separate integration. It preserves free
frontend generation and chart-driven interactions.

The [cube selection and semantic fallback entry](../analysis/README.md) keeps
private planner and data-worker planning separately evaluable, executes through
the host Wren adapter, and issues a generic aggregate report contract after trusted
verification. Existing dashboard/replay entry points remain separate and compatible.

The [aggregate report browser binding](../analysis/README.md#interactive-offline-binding) exports verified cube or semantic-query reports to the same free-layout dashboard sandbox. It is covered by the offline and browser gates.
