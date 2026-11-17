# Data verification and private delivery

`harnesses/data-validation.mjs` is the common, versioned `data-verification/1`
contract. `WorkerSession` returns it with completed results; the host recomputes
it from authorized evidence and its accepted plan. Neither model assertions nor
an adapter-supplied optimistic validation field can override that decision.

| Status | Delivery | Automatic work |
| --- | --- | --- |
| verified | Normal private result; eligible for the existing export checks | None |
| unverified | Labeled private preview with per-group reasons; not a verified success | No automatic retry or cloud export |
| rejected | No artifact for the invalid result; prior valid groups remain in local state | One new worker request per rejected group, then stop if still rejected |

Completion of processing is distinct from verification. `task.state=completed`
can mean a preview was produced; consumers must read `task.data_validation`.
The pi interface says “預覽可用（尚未驗證）” for an unverified preview. HTML shows
both overall and per-group status. Missing validation in older records is never
called verified. Unverified results cannot be redesigned or exported.

The bounded scalar/week contract checks shape, UTC timezone, half-open calendar
period and disclosed service rule evidence. Missing/redacted evidence remains
unknown, without requesting higher permissions. Wrong period/inclusivity,
wrong grain/timezone, or an explicit failed rule is rejected. An explicit UTC
calendar range does not depend on fiscal-calendar evidence. `none_applicable`
with no applicable rules does not require inventing new rules. All other
unverified semantic flags remain warnings about data verification, distinct from
dashboard typography/contrast warnings.

Evidence checks cannot independently prove every arbitrary numeric calculation.
The synthetic fixture deployment adds a trusted domain value validator through
`aggregatePolicy({ assessData })`. It only compares the already-authorized public
fixture values for that exact fixture period and revenue/default-filter request after source hash verification; this is not a general database
oracle. General deployments must supply their own domain checks if needed.
The generic worker may therefore verify service evidence while the fixture host
rejects a numeric mismatch. Both use the same status contract; domain checks can
only add information. Hidden eval expectations are never supplied to the model
or included in repair instructions. A repair repeats the original requested
period/grain/rules, without leaking the expected values.

All assessed attempts retain their result/evidence refs, evidence, values and
assessment in the private journal. A repair is a fresh Wren request, preserves
session revision, and may use the existing clarification continuation. The repair
budget survives that clarification. Provider/transport failures are not retried
by this mechanism. Existing export grants, reauthorization, redaction and browser
quality checks are unchanged; passing this check grants no disclosure permission.

## Independent evaluation

From the example directory:

```sh
node eval/data-validation.mjs /absolute/path/to/new-regression-output
node --test host/test/data-validation.test.mjs eval/test/units.test.mjs
node eval/run.mjs data-worker /absolute/path/to/new-service-output /absolute/path/to/worker-config.json
```

The first command exercises the real worker entry and host domain assessment with
fault-injected responses, including correct, missing period, wrong period,
inclusivity, value, grain, timezone, failed rule and unknown semantics. It measures
classification, not model quality. The service suite uses real released Wren with
a scripted loopback provider. Neither command calls a paid model.

For an explicitly authorized live worker check:

```sh
node eval/live-worker.mjs /absolute/path/to/private-config-without-claude.json /absolute/path/to/new-live-output
```

This runs scalar and weekly retrieval twice each against the existing pinned
Nemotron/Wren configuration. There is no planner, Claude, replacement sample or
automatic repair in this isolated measurement. It retains the independent values
oracle and requires `validation.status=verified` for a verified success. The host
repair loop is evaluated separately. Every model attempt, latency, evidence,
release/binding identity and unknown cost is retained. A null temperature means the runtime omits that parameter and uses the provider default. Provider credentials come
only from the configured environment variable. Existing output directories are
never reused. These four samples are a targeted regression, not a new host benchmark cohort
or a claim that an intermittent provider/evidence issue cannot recur.
