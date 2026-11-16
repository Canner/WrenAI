# P1: Nemotron-only planning and Wren evaluation

This opt-in harness tests a real Nemotron conversation planner and a separate
Nemotron data-agent context behind `wren serve agent`. No Claude/GPT model or
cloud design adapter is present. It preserves the offline P0 example unchanged.

P0's fixed Q3 `TaskPlan`/`ExportBundle` is not the real Wren wire protocol. P1 uses
a separate, bounded planning contract for scalar/weekly questions with explicit UTC periods,
then maps retrieval groups to real MCP calls. This is an evaluation harness,
not a production migration of the P0 controller or an interactive web app.

## Environment

- Node 22.19+ and Python 3.11+.
- A clean virtual environment using `wrenai[mcp]==0.18.0` and SQLGlot 29.0.1
  (`requirements.txt`). SQLGlot 30 removes `Scope.union_scopes`, which this Wren
  release still uses: unconstrained installation can reject otherwise valid SQL.
- An external context loader built from `wren-v0.18.0`, a compatible Warble compiler,
  and a private-service runtime. Compiler/runtime 0.21.1 are the candidate pair
  for this experiment; always run the preflight rather than trusting version labels.
- An existing `NVIDIA_INFERENCE_API_KEY`, supplied only through the environment.

The example configuration uses NVIDIA's hosted
`nvidia/nemotron-3.5-lightning-30b-a3b`. This proves a private **role**, not private
network deployment. Only use the public synthetic fixture here. The planner
receives the service's authorized metadata; the data agent sees the project's
metadata and authors SQL. Do not substitute real private data under the claim
that NVIDIA hosted inference keeps it local.

The planner uses temperature 0, thinking disabled, at most 1,536 output tokens
and 45 seconds per call. The fixture's Wren execution is bounded at 120 seconds,
12 turns, 24 tool calls and 8,192 output tokens, with private-worker thinking enabled and
provider retries set to zero. The conversation planner and private service
use separate contexts. The service retains the coordinator/worker component
structure required by runtime 0.21.1; its limits cover the nested invocation. No model fallback is configured. A timed-out planner decision may retry once,
before any data mutation, within the same three-attempt case and 12-attempt run
budgets. Schema/HTTP failures and Wren data calls never use that retry. The
private provider itself has retries disabled.

## Prepare and run

From this `p1` directory, install into a **new** environment (do not use an
editable install or `PYTHONPATH` source override):

```sh
uv venv --python 3.11 /absolute/path/to/new-venv
uv pip install --python /absolute/path/to/new-venv/bin/python -r requirements.txt
/absolute/path/to/new-venv/bin/python test/release_compat.py
```

The release wheel does not bundle or download `wren-context-loader`. Build it
from the release checkout and configure the resulting executable explicitly:

```sh
cargo build --release --locked --manifest-path /path/to/WrenAI/core/wren-context-loader/Cargo.toml
```

`wren.__file__` must resolve inside the new venv's `site-packages`; the loader,
compiler and runtime are separately pinned external prerequisites. Record their
hashes, the resolved Python dependencies and the fixture/profile inputs. A CLI
version string alone is not a clean-install test.

Install the locked MCP client dependency:

```sh
npm ci --ignore-scripts --no-audit --no-fund
node --test test/*.test.mjs
```

Create a **new** fixture directory using the Python interpreter of the Wren
environment (`prepare.py` refuses an existing destination):

```sh
/path/to/.venv/bin/python prepare.py /absolute/path/to/new-fixture
```

Copy `config.example.json` to a local operator directory and set its absolute
executable/project/compiler/runtime/loader paths. Never put credentials in JSON.
Use this example's `p1/profile`, which keeps the private coordinator/worker
protocol while constraining each delegation to one retrieval group. Do not set
`PYTHONPATH` for the released-package experiment. Both planner and service model settings must name
the intended Nemotron endpoint. Verify the service's generated `service.yml`.

The `full` preset in this synthetic experiment exposes declared definitions to
the planner. It does not authorize real data disclosure or weaken the service's
SQL/column restrictions. Other presets are different experiments.

First verify startup, capability discovery and session open/close without a
model inference request:

```sh
node run.mjs --preflight /path/to/operator-config.json cases.json /path/to/new-preflight.json
```

Then explicitly opt into the four model-backed cases:

```sh
node run.mjs --live /path/to/operator-config.json cases.json /path/to/new-live-report.json
```

Reports are created exclusively with mode 0600; an existing report is never
overwritten. The output contains private-session metadata and tool results and
must stay local. If configuring `audit_path` in the service YAML, use a fresh
audit destination for each service invocation; it is operator evidence, not
model context. The runner prints short progress records, not service stderr or
credentials. Historical live results are deliberately not checked into source.

## Cases and scoring

1. Explicit metric and period: proceed without redundant planner clarification.
2. Ambiguous intent: ask first, then use a scripted human answer naming the
   metric and dates. No query should precede that answer.
3. Explicit all-status order scope: preserve the user's request; if Wren asks
   for confirmation, resume only with the supplied human answer and the actual
   continuation ref/revision.
4. Total and weekly revenue: plan separate scalar/week groups and execute them
   sequentially in one session.

The fixture extends the public serve-agent example with cancelled, pending and
test orders so incorrect defaults change the answer. The independent oracle is
770 USD revenue, 13 non-test orders across all statuses, and weekly revenue
50/220/500 for week starts Dec 29, Jan 5 and Jan 12. All questions bound Jan 1
inclusive through Jan 19 exclusive, UTC. The first week's label precedes the
lower bound because only the in-period rows of that week are counted.

Flow scores and data scores are separate. `completed` alone is not a pass.
The numeric oracle and `evidence.applied_period` must both match. Date-only
and midnight timestamp boundaries are equivalent only with the host UTC
timezone; other dates, non-midnight times and timezones still fail. Expected
answers are never sent to Nemotron or used to repair queries. Host column keys,
not private aliases, bind result cells. The oracle verifies this fixture's
values/period; it does not prove arbitrary semantic correctness. Inspect
`has_unverified_semantics` and the actual evidence when interpreting a result.

The process exits nonzero on failed flow/data scores. A waiting question with
no scripted human answer remains unresolved. A denied/unavailable task is
recorded as such; it is not zero and causes no retry or alternative-tool bypass.
Independent completed groups remain in the report when another group fails.

## Ownership and limits

`planning.mjs` validates the model's three possible decisions: `plan_queries`,
`clarify_intent`, `unsupported`. The model cannot choose provider, endpoint,
session/revision IDs, evidence refs, or tools outside that registry.
`session.mjs` owns those values, serializes mutations, and calls `get_evidence`
again before binding a completed result. It keeps plan and service revisions
separate. Human answers enter only through `answer()`; there is no model-facing
tool that can call it. The scripted answers are test inputs, not authentication.

Each case has a five-minute deadline, at most three planner attempts (including a timeout retry), five data
mutations, three clarification questions and 24 MCP calls. The entire run has a
12-call planner ceiling. The service's internal calls are additionally bounded
by its execution settings; they are not included in the planner call counter.
Cleanup has its own 10-second window and the service child is closed at exit.

Each plan group contains only a metric/business definition and grain. Shared
constraints carry an explicit half-open UTC period, filters and the separately
required requested_statuses array ([] means project defaults). The host renders
only those fields as one natural-language Wren request. Requested statuses are
not confirmation: the human must still answer the service clarification. The original multi-group user
request stays with the conversation planner; it is not appended to each worker
request. These fields are model proposals, not proof of intent preservation.
The independent oracle still checks the original test objective.

Before binding evidence, the host requires a scalar result to contain one row
and one finite numeric column. A weekly result must contain one date column
(Monday, midnight UTC), one finite numeric column, and unique ascending weeks.
Time-of-day splits, extra dimensions and repeated weeks fail closed without a
repair retry. The worker prompt uses native DATE_TRUNC week grouping and asks
for one delegation and immediate evidence return, reducing redundant work
without raising the 120-second deadline. The worker reads relevant context
directly instead of an unnecessary select/read round trip; both use the same
host authorization checks. Shape validation does not verify all
business semantics or prove general latency/reliability guarantees.

Clarifications contain only an open-ended question, without an optional
model-generated choices list. The planner sends normal conversation messages after authorized context, uses
explicit date-only parameter schemas and disables parallel tool calls. The host
still rejects multiple calls or invalid decisions rather than choosing one.
Status confirmation answers use the service's requested comma-separated value
format and are passed unchanged; no model manufactures a confirmation.

This harness stops at bound result/evidence artifacts. It does not synthesize a
free-text final answer, render a dashboard, persist sessions, or handle arbitrary
follow-up replanning. No claim about Nemotron reliability follows from a few
passing samples. Record failed attempts and prompt/model/runtime changes before
comparing later runs.

Offline tests use a fake MCP port and fake HTTP responses. CI runs those tests,
not `--live`; there is no API-key requirement for CI. Run P0's tests separately
from the parent directory to verify its contracts remain intact.
