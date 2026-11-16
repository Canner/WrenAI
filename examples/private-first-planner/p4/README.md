# Paired private-only / fixed Claude / adaptive comparison

This exploratory P4 harness uses exactly the approved P2/P3 synthetic revenue
fixture, common brief, DashboardSpec and renderer. It does not add free-form UI
code generation, new data grants, models, or production claims.

`protocol.mjs` preregisters four cases (basic charts, standard dashboard, polished
executive dashboard, and an ambiguous polished request), each repeated twice.
Every block runs the real Nemotron conversation and Wren retrieval once. Each of
three design arms receives the same validated result projection:

- `private_only`: Nemotron produces the same DashboardSpec; never calls Claude.
- `fixed_claude`: Claude designs every eligible case, regardless of router proposal.
- `adaptive`: the Nemotron planner's proposal selects private or Claude design.

The planner knows that basic/default dashboards can be generated privately. It
never sees case IDs or expected labels. All cases need the same total and weekly
values and use the same approved design brief. The case affects intent, routing
and clarification; it does not change the schema or secretly grant one designer
more components or a richer prompt. Both designers get the same semantic design
instruction and bundle. Their provider-native output transports differ (Nemotron
function call versus Claude Code StructuredOutput); the latter adds its runtime
system framing. Both retain their fixed earlier serving settings.

The benchmark host may bypass **only the proposal requirement** in FixtureBroker
when a fixed mode is explicitly selected. All existing data/evidence/source,
recipient, expiry, audit and export payload checks remain mandatory. Each block
keeps its Wren session open. The evidence-only design phase uses an explicit
32-call / 290-second lease over the actual session and refs; it cannot mutate or
query new data. P1's query/model budgets remain unchanged. Each design arm gets
one attempt with the same 100-second controller ceiling. Private design uses the
existing 45-second Nemotron provider timeout; Claude retains its 90-second process
ceiling. No fallback or replacement sample is allowed. Global limits are 16
Claude invocations, 16 private designs and 35 minutes. Model/SQL retries that
already exist within the fixed P1 data stage remain recorded.

The common data stage is a control, not three independent observations. Report:

1. Shared planner/Wren wall time and tokens once per block.
2. Each design arm's measured wall time, use, routing, failures and artifacts.
3. `shared + arm` as **composed latency**, never independently measured E2E.
4. Cloud client list estimate separately from Nemotron use and unknown total
   cost. Missing cost remains null, including failed cloud calls without usage.
5. Raw outcomes and nearest-rank P50/P95; n=8 is not a reliable production-tail
   estimate. Do not drop failures to improve completion rate or claim statistical
   significance from this pilot. Latency quantiles for successful arms are labeled
   as such, with failures separately retained.

The finite renderer strongly limits aesthetic variation. Automatic checks cover
schema/data/reference correctness, no scripts/external requests, overflow,
expandable values, KPI large-text contrast >=3, and mobile chart-label size >=12px.
The latter two are design quality diagnostics, not reasons to discard a sample.
Anonymous visual assessment scores hierarchy, readability, chart fit, consistency
and polish 1–5. An implementing agent's visual review is subjective and is not an
independent human blind trial. Identical visual fingerprints can share one review;
that does not make them independent evidence of quality.

## Run and inspect

Use the P2 operator config plus `auditPath` pointing to this run's dedicated Wren
service audit. Copy and verify the same fixture files before approving their hashes.
The cloud provider and credentials are unchanged; only approved aggregates leave.
Keep all outputs private.

```sh
npm ci --ignore-scripts --no-audit --no-fund --prefix ../p1
node --test test/*.test.mjs
node run.mjs /private/config.json /private/new-run
node gallery.mjs /private/new-run
```

`preregistered.json` saves the protocol, cases, order, config and source hashes
before the first model call. `report.json` updates after each arm, preserving failed
blocks. Each block saves private evidence and model calls; each arm saves authorized
exports, real provider requests and HTML when valid. Final source hashes must match.
The gallery generates a separate anonymous view and a private reveal mapping.
The shared private phase's worker tokens come from the actual Wren audit, not from
estimated prompt length. Cached Claude tokens are included in its reported usage;
arm execution order is counterbalanced, but provider-side cache/queue effects
cannot be eliminated and are not hidden.

## Clarification and readability regression checks

The planner distinguishes missing intent from optional choices: a resolved metric
and period proceed with project defaults. Illustrative tool decisions cover a
complete request, an overall-only request, missing metric/period, and a resolved
follow-up. Their metrics and dates differ from the benchmark fixture. They do not
supply human answers, force tool selection, or bypass a Wren confirmation. Prompt
examples improve observed behavior but do not establish a deterministic guarantee;
retain live failures and evaluate both positive and ambiguous requests.

The renderer uses theme-specific accents and larger text inside narrow chart
containers. Date-label spacing leaves room for full dates; chart values and data
bindings are unchanged. Check every theme/accent/layout/chart combination at
320, 390, 680, 768 and 1280 pixels for text size, contrast, overlap and clipping.
Keep the original benchmark's contrast >=3 and mobile label >=12px thresholds.

For a retest, archive the prior source, config, complete results and file hashes
before editing. Freeze the corrected source before any scheduled benchmark call.
Only relocate local fixture/audit/output paths; verify model, endpoint, budgets,
case text, human answers, ordering, data, schema and scoring thresholds against
the prior preregistration. Keep any planner-only development probes separate from
the scheduled matrix, including unsuccessful candidates. Compare all eight slots
for completion and matched successful blocks for latency/cost; do not compare
raw cost totals from different numbers of completed designs as a cost regression.

P4 now uses a single `resolve_intent` model call to extract metric definitions,
periods and requested grains with exact quotes from actual user turns. The host
maps complete, grounded fields to the existing P2 plan; missing or ungrounded
metric/period fields produce a question only about those fields, discarding any
partial groups. Metadata, assistant messages and illustrative dates cannot count
as user evidence. There is no free-form confirmation field. Weekly groups also
need actual user wording containing an explicit Chinese/English week marker.
Malformed plans still fail closed through the existing date/capability/group
validators. Exact quote matching proves provenance, not semantic correctness or
negation handling; this remains a bounded Chinese/English synthetic experiment.

Concrete definitions are bound host-side into every referencing group; the model
cannot silently omit a different definition from one group. The number of calls,
three-attempt limit, timeout, token budget and Wren authorization protocol remain
unchanged. P1/P2 keep their existing contracts; the transport only supplies actual
conversation context to this optional parser. A tested clarification self-review
candidate was rejected because it guessed missing facts; it is not enabled here.
## Warble behavior source

Planning and dashboard design instructions now come from the compiled
[`../behaviors/profile`](../behaviors/README.md). The host's routing, authorization,
validators and renderer are unchanged. Follow the behavior README to regenerate
the artifact after editing a component; stale artifacts fail before model calls.
