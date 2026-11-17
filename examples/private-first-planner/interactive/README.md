# Interactive dashboard laboratory

This opt-in, synthetic-only harness adds local BI interactions to freely generated
HTML/CSS/JavaScript. It reuses the host export broker, code admission, one-repair
loop and network/home-denied browser. It does not replace the pi/Wren revenue
route and does not require data-worker changes. There is no fixed runtime renderer.

## Supported behavior

- Revenue, Orders and Average order value KPI cards, all scoped to current filters
  and drill context. AOV is total revenue divided by total orders, never an average
  of subgroup averages. Zero orders yields N/A, not zero or Infinity.
- Region/category single-select filters and UTC lower-inclusive/upper-exclusive
  date inputs. Invalid ranges show an error and retain the last valid analysis.
- Geography or Product grouping, with region → country and category → subcategory
  drill-down, roll-up and breadcrumb. No deeper detail is invented.
- Filters reset drill context; dimension changes preserve filters and clear drill.
  Reset restores every control and initial analysis. Drill affects all views.
- A generated revenue chart, grouped aggregate table and synchronized KPI cards.
  Empty results, zero/negative revenue and changed labels/row counts are covered.

Native labeled selects, date inputs and buttons are the first-version accessible
control contract. Their layout and styling are free. The model chooses CSS, SVG
or canvas charts. The host supplies only immutable `window.dashboardData`, not a
layout template, chart library, state engine or hidden test answers.

## Data and authorization

`data.mjs` defines `interactive-aggregates/1`: at most 500 complete daily aggregate
cells and 64 KiB, with explicit dimensions, hierarchy and metric rules. Synthetic
cells have disjoint order populations, so summing order counts is valid here.
This does not imply distinct customer counts or arbitrary real metrics are additive.
No raw transactions, schema, SQL, credentials or worker evidence are exported.
No local filter makes data outside the supplied period available.

`runInteractive` accepts a fixture variant, not arbitrary worker results. Its
automatic approval is limited to this explicit synthetic laboratory. A production
source needs a separate trusted projection and grant flow; changing a flag to
`synthetic: true` is not an authorization mechanism. Network, host/Wren calls,
persistence, cross-filter, multi-select, drill-through and real-data refresh are
outside this version. Local clicks make zero model or database calls.

## Design harness integration

Two independent Warble components are under `behaviors/profile/`:
`design_interactive_dashboard` and `repair_interactive_dashboard`. The existing
revenue components and compiled artifacts are retained unchanged.

`harness.mjs` exports `designContract({attempt, diagnostics})` and
`runInteractive({variant, recipient, makeDesigner, out, signal})`. The trusted
caller binds a designer with `recipient` and `design(bundle, control)`. The factory
receives the selected component prompt, `frontend-code/1` schema, design brief and
4096-token limit. A real provider adapter can consume this contract without a
renderer change; no live provider is selected by the included CLI. The existing
Claude adapter accepts this shape, but live model generation is unmeasured here.

Generation uses the same broker checks before send and use, artifact binding and
single functional repair as the host. Repairs receive only allowlisted diagnostic
codes. Visual warnings alone do not spend another model call. Missing/abnormal
browser evidence, timeouts and network failures cannot pass or trigger a repair.

Every run refuses an existing output directory. It records both successful and
rejected candidates, component/source hashes, audit events, QA observations,
screenshots, per-attempt generation/QA latency and reported cost (unknown stays
null). Historical reports are never relabeled or overwritten.

## Offline validation

From the example root, with Node 22 and macOS for browser isolation:

```sh
npm ci --prefix design --ignore-scripts --no-audit --no-fund
node collaboration/check.mjs interactive /absolute/path/to/new-interactive-results
```

This runs negative browser probes and four end-to-end synthetic cases: base,
changed dates/labels/cardinality, zero/negative metrics, and empty data. The fake
designer specimen in `test/specimen.mjs` is **only a test double**. It is not a
production fallback, model prompt example or renderer. It demonstrates the output
contract; passing does not establish Nemotron/Claude design quality.

Dependency-free contract tests (no browser or model):

```sh
node --test interactive/test/contracts.test.mjs
```

To regenerate and check components using the pinned compiler:

```sh
npm ci --prefix collaboration/runtime --no-audit --no-fund
WARBLE_BIN=./collaboration/runtime/node_modules/.bin/warble node interactive/behaviors/compile.mjs
WARBLE_BIN=./collaboration/runtime/node_modules/.bin/warble node interactive/behaviors/compile.mjs --check
```

## What is verified

`interactive-dashboard-delivery/1` executes journeys at 1280px and 390px and runs
the same candidate against changed data without regeneration. An independent
host-side oracle computes the expected values; it is never sent to the designer.
The browser test drives native controls and reads actual visible KPI, table and
chart labels, date scope, breadcrumb, enabled drill actions and empty/error states.
Reset is exercised by keyboard. Journeys test filters, both hierarchies, dimension
changes during drill, reverse filter order, date boundaries, roll-up and reset.

Wrong values, missing controls, broken transitions or runtime/network violations
block delivery. Readability, overflow and contrast observations remain warnings;
contrast uncertainty is not treated as verified contrast. Every step is recorded;
a failed transition stops that view, and unexecuted steps never count as passes.

Chart checks cover labels/numbers and bounded painted-mark presence for nonzero
results. They do not prove all bar lengths, axes, clipping or arbitrary chart
semantics; screenshots remain available for visual review. All-zero/empty results
are evaluated through exact values and empty-state behavior without requiring a
nonzero painted bar. Only initial-state contrast is sampled; typography/overflow
are sampled throughout journeys. Passing is not accessibility certification.

The current counterfactual uses a second known synthetic fixture, not exhaustive
property testing. Before model tuning, add held-out data and repeated provider
runs; compare functional journey success, first-draft/repair rates, visual quality,
generation and click latency, and model cost separately. Keep old four-case
revenue results in their original denominator; these are new interaction cases.
