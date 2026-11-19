# Monthly revenue replay workflow

This opt-in entrypoint runs the shared pi planner, verified aggregate replay,
ExportBroker, Claude adapter and isolated browser evaluator from repository
source. It does not query Wren, replace the durable Wren host controller, or
claim that a hosted planner endpoint is private. Real data-worker integration
remains a separate boundary.

## Planning and browser contracts

The host derives complete calendar month, quarter, half-year, trailing six-month
and full-coverage options from verified monthly coverage. Incomplete options are
omitted. Each option explicitly declares whether its entire prior-year interval
exists. The model selects a supported option and discloses defaults; it cannot
invent dates, claim user confirmation or enable an uncovered prior-year analysis.
A genuine clarification stops the workflow before export. The original explicit-
intent planner remains unchanged; `PiPlanner` accepts an injected decision contract
so both paths use the same executor and credential isolation.

Application-owned Warble components live in `behaviors/profile/`. The host admits
a narrow versioned IR and verifies compiled artifact/source hashes. Behavior is
compiled with the same pinned compiler as the rest of the example.

The browser receives **`window.dashboardData = payload`**, deeply frozen, in an
opaque sandboxed iframe. It never receives the request envelope. There is no
`dashboardData.payload` or runtime `design_brief`. The designer may embed only
admitted presentation settings from the generation-time brief; numbers and
labels must be read from runtime aggregates. Free HTML/CSS/JavaScript generation
and layout remain model-owned.

The Claude gateway accepts at most 2 MiB of SSE wire bytes, independently of the
existing 64 KiB decoded spec, 20k-character fields and bounded CLI stdout. SSE
framing can exceed 256 KiB even for a small valid result. Model, schema, system
prompt, output-token cap and every send authorization are still checked. The
monthly workflow requests 12288 output tokens (including thinking), medium
effort, a 90-second per-call ceiling and the existing US$0.50 CLI budget. One
functional repair is allowed inside the export grant's unchanged lifetime.
CLI/provider usage may omit partial streams: the CLI budget and total are not
proof of a complete invoice or strict aggregate spend accounting.

## Operator inputs

Use Node 22+, installed locked `host`, `design` and `host/adapters` dependencies,
Claude Code 2.1.309, and macOS with the pinned Playwright Chromium. The run is
explicitly live and may incur charges. Neither tests nor setup invoke paid models.

Supply a private local config, outside the repository:

```json
{
  "question": "Build a dashboard that clearly explains revenue health.",
  "cloud_authorized": true,
  "replay": {"payload": "/absolute/path/payload.json", "grant": "/absolute/path/grant.json"},
  "planner": {"id": "nvidia/your-nemotron-model", "baseUrl": "https://your-planner.example/v1", "credentialEnv": "PLANNER_KEY"},
  "claude": {"command": "/absolute/path/claude", "model": "your-claude-model", "baseUrl": "https://your-cloud.example", "credentialEnv": "DESIGN_KEY"}
}
```

`cloud_authorized` represents the operator's actual grant, never a model decision.
Do not set it without authorization. Credentials are read only from the named
process environment variables, not copied into run manifests or child environments.

The replay payload is a verified synthetic USD dataset with complete-month
`coverage: {lower, upper_exclusive}`, UTC, a positive integer `amount_scale`,
columns `[month,country,channel,gross_units,refund_units]`, and aggregate row arrays.
Amounts are nonnegative safe integers; net can be negative. Duplicate cells,
unsafe sums, invalid months, uncovered rows and oversized payloads are rejected.
`definitions` provides authorized business semantics. No raw customer data or SQL
belongs in this payload.

The operator-produced grant binds exact bytes to independently verified evidence:

```json
{
  "version": "verified-replay/1",
  "payload_sha256": "<64 lowercase hex characters>",
  "verified_checks": {"gross": true, "refunds": true},
  "sources": [{"path": "/absolute/path/source", "sha256": "<64 lowercase hex characters>"}]
}
```

This is a trust input, not proof manufactured by the adapter. Reuse evidence from
an actual independent reconciliation. Payload, grant and source hashes are checked
before planning and on each authorized export use/send. Only aggregate payload
and the allowlisted plan projection reach the designer. Free-text planner notes,
private metadata and source paths remain outside that request.

```sh
node revenue/run.mjs /absolute/path/config.json /absolute/path/new-output
```

The output directory must be new. It retains the protocol, source revision,
compiled behavior identity, original question, planner proposal, plan, replay
evidence, grant, every observed cloud request/result, every candidate, browser QA,
and terminal report. A clarification yields `waiting_for_user`; it is never
answered automatically. Failures and internal HTTP retries are counted. Model
USD costs without a verified price source remain unknown. Do not rerun over old
outputs or treat a recovered run as first-pass success.

## Verification and evaluation

The existing `offline`, `browser` and `behaviors` collaboration gates include this
workflow's tests and compiler check. Offline tests cover dynamic periods, prior-
year coverage, malformed proposals, clarification, evidence mutation, actual pi
loopback transport, export projection and SSE limits. Isolated-browser tests cover
immutable direct payload access, the wrong-envelope regression, real scrollable
control reachability, hidden/disabled controls and counterfactual insight checks.

The `revenue-browser/2` evaluator drives 23 states over desktop/mobile and original/
changed aggregates (92 observations). KPI, trend, detail, filters, dimension,
drill, roll-up, reset and invalid interval behavior are checked independently.
Missing insight summaries reduce quality coverage; incorrect visible values fail
admission. Ordinary JS errors may use the bounded repair; network attempts do not.
A scrollable drill button must pass a real trial-click reachability probe, then the
journey exercises actual chart-label/mark clicks and Enter/Space activation. The
breakdown chart owns one accessible `data-drill` control per root group, containing
both `data-chart-label` and `data-drill-mark`. Its `data-chart-section="breakdown"`
also contains the roll-up button, next to the chart heading or breadcrumb. Tables
alone cannot satisfy drill navigation. Touch activation is covered by an offline
browser regression. It retains a horizontal-scroll quality warning.
Visual/contrast warnings stay separate from data and interaction failures.

Historical comparison requires an explicit scope alignment. A different model-
selected default, changed prompt or output cap prevents causal quality/latency
claims. Preserve old artifacts and report all failed attempts, not just the last
successful model response. No deployment configuration, dataset, generated code
or private model trace is included in the public source package.
