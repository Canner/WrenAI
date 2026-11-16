# Private-first Claude Code design experiment

This bounded P2/P3 example extends the P1 Nemotron conversation and Wren session
with an **optional** Claude Code design worker. It does not change Wren, Warble
admission, or the P1 default (which remains private-only).

The host exposes `dashboard_design` as a proposal in Nemotron's planning contract.
An explicit dashboard request with missing metric/dates still requires a human
answer. After Wren completes both scalar and weekly groups, the host prepares a
new export bundle. Claude receives that bundle and a strict output schema. It has
no Wren/MCP, filesystem, command, browser, or network tools. Only Claude Code's
`StructuredOutput` return tool is allowed. The private renderer binds the original
approved values; Claude chooses theme, accent, layout, card order and chart type.

## Scope of the disclosure grant

**Only the public synthetic P1 fixture is supported.** This is not a production
policy engine, general aggregation classifier, or de-identification mechanism.
The operator must verify and approve an immutable fixture file manifest in
`fixtureGrant`. The grant permits exactly USD 770 total and the three weekly
aggregates USD 50 / 220 / 500, for 2026-01-01 inclusive to 2026-01-19 exclusive UTC,
with the fixture's default scope. Other values, periods, datasets, columns,
additional filters, status sets or unverified semantics are denied. The only
accepted unverified marker is the existing fiscal-calendar marker; this fixture
uses explicit calendar bounds and makes no fiscal-calendar claim.

The broker verifies operator-approved source hashes and retrieves evidence through
Wren's existing `get_evidence` authorization path, then checks host-derived source,
aggregation, period and scope evidence. It creates new public dataset IDs, fixed
approved labels and brief. No SQL, original column labels, metadata/rules, raw
rows, Wren refs, model objective, transcript or evidence envelope is forwarded.
The grant binds provider URL + fixed model, purpose, data digest, plan revision,
policy version and expiry. Recipient/policy are host configuration, never model
arguments. Policy is immutable for a task; `revoke()` invalidates its bundles.

The gateway reauthorizes **every actual HTTP attempt**, including CLI retries,
and allows at most three requests in one cloud invocation. Source/evidence checks
and the durable audit must succeed before forwarding. The configured Claude Code
2.1.309 CLI runs with bare/safe mode, no tools, empty MCP/settings and an isolated
temporary config directory. No parent credentials other than the explicit cloud
credential enter the transport; the child gets a disposable local gateway key.
The gateway checks the initial payload, system prompt, output schema and fixed
model before forwarding. Private queries use the existing independent NVIDIA
credential. Existing enterprise-managed provider behavior is not replaced by an
OS-level network or filesystem sandbox; test with synthetic data only.

A task has the existing P1 limits (three planner attempts, five data mutations,
three clarifications, 24 MCP calls and 300 seconds), plus one cloud draft under a
400-second overall runner ceiling and a 100-second design ceiling. The CLI process
has a maximum 90-second window and USD 0.50 budget. No alternate model, automatic
repair or second cloud task is used. Expired/revoked/changed results cannot be
rendered. Cloud failure leaves a clearly labeled local table preview with the
validated private results; it is not reported as a completed design.

## Run

Use Node 22, the clean `wrenai[mcp]==0.18.0` / SQLGlot 29.0.1 environment and the
external loader/compiler/runtime described in [P1](../p1/README.md). Reuse the P1
service configuration with a new audit path and this checkout's `p1/profile`.
The experiment never installs a model or changes the existing Claude provider.

```sh
npm ci --ignore-scripts --no-audit --no-fund --prefix ../p1
node --test test/*.test.mjs
node run.mjs /private/config.json /private/case.json /private/new-output-directory
```

The config extends P1's `{model, service}` with:

- `cloud`: `{command, model, baseUrl, credentialEnv}`. `command` is an absolute path
  to Claude Code 2.1.309. Use a fixed provider-supported model ID, not an alias.
  HTTP endpoints must be loopback; otherwise HTTPS is required. The credential is
  read from the named environment variable, never stored in config. An existing
  authenticated local proxy can use its documented local credential convention.
- `recipient`: the adapter's `recipient` value, computed as
  `claude-code:<model>:<digest(baseUrl)>`, where `digest` is the canonical JSON
  SHA-256 function in `../contracts.mjs`.
- `fixtureGrant`: nonempty array of `{path, sha256}` for **all** approved fixture
  database, model, rule, policy and service configuration files. Review these
  files before approving their hashes; do not auto-approve arbitrary input data.
  A supplied manifest is trusted operator configuration, not an attestation of
  arbitrary remote servers. Use the local read-only synthetic fixture.

The case contains `{question, human_answers: [...]}`. Answers are scripted human
responses for evaluation, consumed only when a real clarification is pending.
For example ask for a beautiful executive dashboard without giving metric/dates,
then supply revenue, the fixed January bounds, total + weekly, and project defaults.

The new private output directory contains `private-report.json`,
`export-audit.jsonl`, the actual `cloud-requests.jsonl`, `bundle.json`,
`design.json` and `dashboard.html`. Open the HTML locally; no server or external
assets are required. On cloud failure it instead writes `private-results.html`.
Reports may contain private context; do not publish them or use them as cloud
prompts. Capture files contain provider protocol details in addition to the
approved bundle. CLI-generated ephemeral device/session IDs are provider metadata,
not Wren session capabilities.

`DashboardSpec` permits only two supported datasets, KPI + line/bar, finite theme,
accent and layout choices, approved titles and matching export/data version.
Unknown references, additional fields, code, URLs and model-written numeric claims
are rejected. HTML is constructed by the host with escaped values and a restrictive
Content Security Policy; it contains no script or external dependency. Native
`details` exposes the exact source values, and the layout adapts to small screens.

This is a single fixture integration acceptance, **not** a quality comparison,
production private deployment, general prompt-injection proof or full P2/P3
roadmap completion. Persistent conversations, arbitrary authorized aggregates,
cloud-requested clarification, design repair and richer layouts remain separate
work. Hosted Nemotron only verifies role separation, not private network residency.
