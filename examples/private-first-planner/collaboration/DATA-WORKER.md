# Data worker handoff

You can develop and verify this unit without running a conversation planner,
Claude, dashboard browser or paid model. The reference implementation stays on
Wren 0.18.0; replacing that service/runtime is a separate compatibility change.
This document describes the adapter already used by the host, not a new API.

## Your boundary

The worker team owns `worker/profile/` root/leaf components, context/tool use,
Wren-side query/evidence generation and independent worker evaluation. Execute
these behaviors directly through `wren serve agent`; no additional MCP server
or transport implementation is required from the worker team.

The host team owns `host/adapters/wren-client.mjs` (stdio MCP connection, tool
admission, response decoding and service-process lifetime) and the shared
`harnesses/worker.mjs:WorkerSession` (session/revision, clarification continuation,
result/evidence bindings and closure). Both the application and independent eval
reuse this adapter. Keeping it in the shared harness does not transfer ownership
to the worker team. Shared contracts, grain/evidence admission and supported
service versions require coordination with the host team.

The host also owns conversation, export approval, routing, retries across groups,
private previews and dashboard delivery.

The host calls one normalized group at a time. An executable example:

```js
const session = new WorkerSession(port); // trusted port.call(name, args, options)
try {
  const result = await session.execute({
    capability: 'analytics',
    question: 'Weekly revenue from 2026-01-01 inclusive to 2026-01-19 exclusive, UTC. Use project defaults.',
    grain: 'week',
    period: { lower: '2026-01-01', upper: '2026-01-19', timezone: 'UTC' }
  }, { timeoutMs: 180000 });
  // Examine response.status AND validation.status, not completion alone.
} finally { await session.close(); }
```

`wren-data-task/2` is the local input contract. Required host inputs are
`capability`, nonempty `question`, `grain` (`scalar` or `week`) and explicit
`period` for verifiable output. The current adapter does not throw merely because
period is missing; classification becomes unverified. Optional `reply_to` must
be a result already accepted by this same WorkerSession. Metric, filters and
requested statuses are rendered upstream by `retrievalQuestion`, rather than
added to Wren's wire schema. A requested status is not a human confirmation.

`wren-data-result/2` branches:

| Result | Fields and consumer action |
| --- | --- |
| Completed | `{response, evidence, grain, validation}`. Response carries service revision/result_ref/evidence_ref/result. Check validation separately. |
| Needs clarification | `{response, question_id}`. Display `response.question`; only a trusted answer with this local question_id can continue. |
| Denied / unavailable / other service failure | `{response}` with its service status/reason. Do not invent rows, verification or a dashboard. |
| Wrong grain | Response is mapped to `invalid_result`, reason `result_grain_mismatch`, with evidence and rejected validation. |
| Broken binding / malformed revision / transport failure | Promise rejects. Host owns failure presentation and bounded recovery; do not return success as a fallback. |

Continuation is `session.execute({question_id, answer})`. The adapter privately
maps that to `continue_task` and the pending service continuation; it retains the
original grain and period. Follow-up `reply_to` is a different mechanism.
`context()` retrieves service capabilities/allowed metadata; it is private.
`reauthorize(results)` checks saved result/evidence against the still-live session.
`close()` closes the session, invalidating reuse; service process lifetime is
owned by the application adapter. Operations on one session are serial.

The underlying service calls are `capabilities`, `open_session`, `read_metadata`,
`ask_data`, `continue_task`, `get_evidence`, `close_session`. No outer `run_sql`
shortcut is introduced. SQL tools are bound only inside the Wren worker runtime.

## Evidence and acceptance

- Scalar: exactly one row and one finite numeric column.
- Weekly: exactly one date and one numeric column, unique increasing Monday UTC
  starts. Apply the date window to source events before grouping; partial buckets
  may have labels earlier than the inclusive lower boundary.
- Keep timezone, applied half-open period, applicable rule checks and unverified
  semantics. Echoing optimistic model prose is not evidence.
- `verified`: evidence checks pass; domain/export policy remains separate.
- `unverified`: missing evidence, explicit preview only; no automatic requery,
  export or redesign. `rejected`: contradicted checks; no erroneous delivery.
- Host allows at most one correction per rejected group. Preserve earlier valid
  groups and diagnostics; never reset its budget from a worker continuation.

See [data verification](../host/DATA-VALIDATION.md). The synthetic expected total
770 and weekly 50/220/500 are evaluator/domain-fixture checks, not a general SQL
oracle and not instructions to inject into a live model prompt.

## Independent tests

From `examples/private-first-planner` (Node 22+):

```sh
npm run test:worker -- /absolute/path/to/new-contract-results
```

This dependency-free gate executes the real WorkerSession with synthetic ports,
including service revisions, continuation, known/unknown reply refs, binding
mismatch, service failure and closed sessions, plus ten evidence-classification
cases. It does not start host UI, planner or designer.

For the real Wren/DB test, install the minimal host-owned client and pinned
service dependencies. The `host/adapters` package installs only the MCP SDK
dependency tree; it does not install the pi UI or start the application host:

```sh
npm ci --prefix host/adapters --ignore-scripts --no-audit --no-fund
python3.11 -m venv /absolute/path/to/new-worker-venv
/absolute/path/to/new-worker-venv/bin/python -m pip install -r worker/requirements.txt -c collaboration/python-constraints.txt
npm ci --prefix collaboration/runtime --no-audit --no-fund
```

Provide `wren-context-loader` built from Wren's `wren-v0.18.0` revision
`f9444152150b89065481276a136ce6cea8ddfeb6`, or the unchanged loader source in this
checkout. Build in the repository with
`cargo build --locked --release --manifest-path core/wren-context-loader/Cargo.toml`.
Its output is `core/wren-context-loader/target/release/wren-context-loader`.
The archive includes fixture helpers, not the loader source; use a separate Wren
checkout to build it. The loader is not installed by the Wren wheel.

Create a new config using paths on your own machine (no credentials):

```sh
node collaboration/configure-worker.mjs /absolute/path/to/new-worker-config.json \
  /absolute/path/to/new-worker-venv/bin/python \
  /absolute/path/to/new-worker-venv/bin/wren \
  collaboration/runtime/node_modules/.bin/warble \
  collaboration/runtime/node_modules/@warble/pi/dist/service.js \
  /absolute/path/to/wren-context-loader
node collaboration/check.mjs python /absolute/path/to/new-python-results /absolute/path/to/new-worker-config.json
npm run test:worker-service -- /absolute/path/to/new-service-results /absolute/path/to/new-worker-config.json
```

Preflight checks Wren 0.18.0, SQLGlot 29.0.1, compiler/runtime 0.21.1 and records
loader/runtime hashes. The test creates fresh synthetic databases, projects,
HOME/WREN_HOME, stdio services and a loopback scripted model. It never loads real
provider credentials. Six cases: scalar, weekly, clarification/continue, denied
column, wrong grain and provider failure. A correctly rejected negative case is
a passed contract test, not a successful query; inspect both state and score.

The package layout must keep `examples/serve-agent/{setup.py,policy.cedar,adhoc-policy.cedar}`
beside this example. They are included in the archive. Do not copy just `worker/`.
Generated private model requests and audit logs remain in the new service output;
share only the intended synthetic summaries, not all raw logs automatically.

## What to return to the host team

Source revision, changed behavior/contract IDs, tool versions, `summary.json` for
both gates, per-case failures and any runtime compatibility changes. Follow with
`offline` and `host-service` from the collaboration guide before integration.
Do not silently widen metadata/service policy, replace denied results, change UTC
boundaries, add hidden retries or modify cloud authorization to obtain a green run.

Real Nemotron tuning remains an explicit separate evaluation through
`eval/live-worker.mjs` or the programmatic `workerUnit` port. Keep a held-out set,
freeze settings/source, record failed attempts and unknown cost as null. Scripted
tests do not establish live correctness or private endpoint residency. Known
live investigation topics include intermittent invalid evidence and choosing
the wrong business definition; preserved historic traces are maintained outside
this public source package and must be shared through an approved private channel.

## Optional cube-backed report handoff

The [revenue report binding](../revenue/report/README.md) needs a privately verified
cube revision plus complete authorized month/country/channel aggregates. The
worker's deliverable is semantic/reconciliation evidence, not another public MCP
server. The host retains Wren access, authorization, capability projection and
export. Verify additive integer units, transaction-date FX/refund scope, missing
rates and ratio-of-sums before admission. Country/channel breakdowns do not imply
hierarchies. Keep source SQL, model mappings and database details private. The
current report runs from an offline snapshot; its injected transport interface
reserves future host queries without putting credentials in generated frontend code.

## Cube-insufficient report planning

The [report fallback contract](../analysis/README.md) adds an independently evaluable
`plan_semantic_query` Warble component. It selects an authorized semantic source and
repeats the host-admitted aggregate request; it neither executes a connection nor
creates a permanent cube. The host owns the existing Wren client, evidence checks
and `aggregate-report/1` projection. Deployment members supply the authorized
registry and domain verifier; no model-produced verification grant is accepted.

## Multidimensional reports through the same service

`host/report-wren.mjs` sends an admitted cube or semantic plan to `ask_data`.
The worker selects period, dimensions and measures in the requested order and
returns the successful evidence token. Service keys such as `c1` and derived
labels are not SQL aliases: do not rerun a correct query to rename them. Preserve
native date buckets; the trusted host projection may normalize supported date
representations only after independently checking their meaning and values.

For results exceeding the service row limit, `PartitionedReportExecutor` uses a
deployment-owned period policy. Each independent partition gets a fresh Wren
session in `createReportRuntime`; a clarification keeps its original session and
continuation. The host fetches evidence before closing a completed session,
verifies every part, rejects duplicate cells or incomplete coverage, and publishes
only the complete report. Workers must not add LIMIT, omit dimensions or weaken
FX/row-preservation rules to fit the limit. Partition sizing and the shared total
deadline belong to the host and must be evaluated together.

A project-defined rule guarantee is recorded as `satisfied_by_definition`, not as
proof derived from each SQL query. Such guarantees need explicit project-owner
review; they do not replace the report verifier's source, period, completeness
and result checks. Carry unverified semantics in the private evidence. Live model
runs and domain-oracle comparisons remain separate from the scripted CI gates.

The coordinator delegates a short instruction instead of copying the question and
context into another JSON string. The runtime already carries the full original
`parent_request`. Preserve this binding when tuning prompts: duplicating or
summarizing the envelope adds latency and can distort measure definitions.
