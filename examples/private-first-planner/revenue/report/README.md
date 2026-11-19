# Cube-backed offline revenue reports

The report owns layout and generated frontend code. The host owns authorized data,
semantic bindings and query execution. This opt-in adapter connects an already
validated revenue snapshot to the same report query contract that a future host
transport can implement. It does not ship a database, MDL, SQL compiler or WASM.

## Admission and export

1. In the private data environment, define and validate a cube using the project's
   confirmed revenue rules. Execute the released Wren cube query for the full
   snapshot coverage, including all allowed country/channel cells. Reject missing
   FX rates, duplicate cells, truncation and unsafe numeric ranges.
2. Reconcile gross/refund integer units exactly with the authorized snapshot.
   Check derived net, ratio-of-sums, filtered scopes and comparison periods.
   Record the compiled semantic revision and query/result evidence privately.
3. Call `createCapabilities(payload, {cube_id, cube_revision})` **only after that
   operator/host verification**. The revision is a SHA-256 of the compiled semantic
   artifact; `data_version` is the canonical payload digest. A valid digest proves
   identity, not authorization, business correctness or completeness.
4. Generate/adapt the free frontend to `window.reportData`, then export with
   `offlineReportDocument(spec, bundle, capabilities)`. Save the returned string as
   one HTML file. It embeds the admitted aggregate snapshot and trusted runtime;
   no server, asset directory, model, CDN or network request is needed to operate it.
   Re-run numeric, interaction, counterfactual and actual `file://` browser checks.

The capabilities projection is deliberately allowlisted: cube ID/revision, data
version, USD units, UTC half-open coverage, calendar-month grain, measures,
comparison modes, dimension catalog and supported breakdowns. It does not serialize
cube SQL expressions, model mappings, credentials or connection settings. It is a
specific revenue binding, **not an automatic interpreter for arbitrary cubes**.
Only already authorized aggregates and their dimension values belong in this file.
The file is a downloadable data snapshot: its filters are not access control and
revoking server access cannot revoke a copy already exported.

## Report API

```js
const api = window.reportData;
const response = await api.query({
  lower: '2024-04', upper: '2024-07', // exclusive upper, calendar months
  country: '', channel: '',         // '' means all authorized values
  dimension: 'country', parent: null,
  comparison: 'prior_year',         // or 'none'
});
const {totals, groups, trend, comparison, insights} = response.result;
```

`api.capabilities` and `api.catalog` are immutable. Money is safe integer units
scaled by `capabilities.amount_scale`; refund ratio is a fraction, not a percentage.
The result includes scope totals, group totals, zero-filled monthly trends, prior
period totals or `null`, and signed change-contribution insights. Zero denominators
and uncovered comparison periods are `null`, never fabricated zero percentages.
Filters apply before aggregation; ratios are computed from summed numerator and
denominator, never averaged from row ratios. The runtime uses integer arithmetic
for additive money. Host responses undergo shape, identity and aggregate
consistency checks; these checks cannot independently prove database correctness.

Clicking a root country uses `parent: countryLabel` with `dimension: 'country'` to
show channels within that country. The reverse direction is also supported.
These are **cross-dimension breakdowns**. `hierarchies: []` is intentional:
country/channel are not an ontology hierarchy. Roll-up clears `parent`; changing a
filter/dimension clears it too. Reset restores the admitted analysis-plan defaults.
This version does not advertise day/city/product/fiscal-quarter drill paths. New
hierarchies require private semantic definitions, authorized data and a new binding.

Unknown fields/members, invalid periods and unsupported filters/drills reject with
explicit errors. An empty valid intersection returns zero additive totals, no
groups and null ratio. Comparison availability is based on declared full coverage;
the host must establish that coverage before export.

## Free-design harness instructions

Use this opt-in instruction only when the host injects `reportData`:

> Build freely with HTML, CSS and JavaScript. Obtain filter values and supported
> interactions from reportData.capabilities/catalog. Query reportData for KPI,
> chart, table and insight values. Do not read or reconstruct raw snapshot rows,
> invent metrics, assume extra levels, sum ratios, or embed data-specific values.
> Let users drill from chart marks/labels and roll up beside that chart. Keep
> keyboard/touch interactions and accessible labels. Retain the last valid filter
> state for invalid input; visibly identify query failure and do not present stale
> values as current. Ignore stale_result and render only the latest request.

The existing live designer/replay flow remains compatible with `dashboardData`.
This adapter does not silently change its prompt or claim a new live model run.
A migrated candidate keeps the ordinary `spec` and `bundle`, adds
`report_capabilities`, and runs through `revenue/qa.mjs`. The QA runner first validates
the original binding. For its deliberate counterfactual fixture it creates a new
matching capability projection, rather than disabling payload identity checks.
The independent numeric oracle remains separate from the query runtime.

## Future host transport

`createTransportClient(cap, authorizedSnapshot, transport)` exercises the same
protocol with an injected trusted function. The snapshot currently supplies
capability admission/catalog validation; it is not sent through the transport.
This is a testable seam, not a network endpoint or Wren serve-agent integration.
The offline HTML intentionally contains no transport URL or credentials.

Request/response envelope (`revenue-query/1`):

- `request_id`: monotonically increasing within one client; one client per
  coordinated report state. Do not launch unrelated parallel widget queries on it.
- `cube_id`, `cube_revision`, `data_version`, and normalized `query` must echo exactly.
- Response adds `complete: true` and the result described above. Partial/truncated
  results are rejected; out-of-order results fail `stale_result`.

A future authenticated host adapter must map this query to its private cube,
check session permissions and allowed scope on **every** request, enforce limits
and completeness, execute through the host-owned Wren client, and validate the
returned result. Query JSON from the browser is never executable SQL. The host
must reject changed semantic/data revisions and provide refreshed capabilities
through an explicit rebind. Frozen snapshots need a stable snapshot/transaction
policy if backed by a changing database. Request IDs are client ordering tokens,
not authentication or a global cache key.

## Verification

`collaboration/check.mjs offline` runs `contract.test.mjs`; `browser` also runs
`browser.test.mjs`. The latter opens the exported file from disk in an isolated,
network-denied browser and exercises the runtime. The shared CSP + opaque sandbox
remain in effect; trusted runtime injection is separate from model source/limits.
Keep private real-data queries, cube definitions, HTML exports and baseline evidence
outside this public example. Re-run the existing revenue QA against each adapted
candidate and preserve previous results rather than overwriting them.
