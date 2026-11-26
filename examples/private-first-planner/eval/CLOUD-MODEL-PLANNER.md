# Cloud model planner with frozen output contracts

The cloud model planner delegates analytics to a private Wren worker and delivers
an existing evidence-bound result. Before retrieval, the model declares the meaning
of each requested output column. That contract stays fixed for the entire session.

A question asking only for the winning quarter should return the quarter label.
Previously, a model could accept a quarter-plus-count table even when the original
request explicitly asked for the label alone. With the contract, the host reports
that width mismatch and refuses to finish that result. The model can ask Wren for a
corrected projection within the existing request budget. The host never trims
columns, edits cells, computes replacement answers, or changes the scorer.

`cloud-model-planner.mjs` exports `CloudModelPlannerTransport`, `runPlannerCase`,
and `checkOutputContract`. The transport currently calls the OpenAI Responses API;
model choice is explicit at construction. This module is opt-in: existing Host and
PiPlanner entry points are unchanged.

## Calling the planner

Use an already connected Wren port, such as the one returned by
`connectWren` in `host/adapters/wren-client.mjs`:

```js
import {
  CloudModelPlannerTransport,
  runPlannerCase,
} from './eval/cloud-model-planner.mjs';

const planner = new CloudModelPlannerTransport({
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-5.4',
});
const outcome = await runPlannerCase({
  port,
  planner,
  question: 'Which fiscal quarter had the most orders? Answer with just the label.',
  asOf: '2026-06-30',
  signal: AbortSignal.timeout(600_000),
});
// outcome.selected contains the original worker result and its checked evidence
// only when outcome.status === 'completed'. Other statuses must be handled.
```

The planner opens and closes a fresh Wren session, reads only service-authorized
metadata, and has no SQL or filesystem tools. Each completed worker table is checked
against `get_evidence`; the selected result and evidence are rechecked at delivery.
Worker denial or clarification ends the case without inventing a human answer.

The defaults are six planner turns and three worker requests. Contract changes and
invalid finishes consume planner turns; requerying consumes worker requests. There
are no provider retries. Observers can capture request/response bodies for local
analysis; these contain authorized metadata and results and should be stored with
appropriate access controls. Transport call records omit the API key.

## What the contract guarantees

The host checks column count and freezes the declared column meanings. It does not
validate the actual meaning or order of returned columns, row cardinality, numerical
correctness, units, timezone conversion, or business filters. The model must still
review the evidence. A width match is not proof of a correct answer.

The prompt also asks for minimal requested outputs and discourages verification
columns. Prompt guidance and host checks were evaluated together; their individual
contributions have not been isolated.

## Validation

From `examples/private-first-planner`:

```sh
npm run test:harnesses
```

The tests exercise the actual planner and transport, including extra-column
rejection, correction with a new evidence reference, frozen contracts, unchanged
budgets, unknown references, and terminal clarification/denial. They are discovered
by `collaboration/check.mjs offline`, which the private-first CI workflow runs.

## Driftwood 53-question comparison

The private run used the same branch service/worker, metadata, dataset, comparator,
tolerances, model settings, concurrency, and budgets as the historical baseline.
Each question ran once in a fresh service/session/HOME. Neither model received
expected answers, prior SQL, or grader feedback. The comparator ran after each
completed episode. No replacement samples or score-changing normalization occurred.

| Measurement | Historical baseline | Frozen output contract |
| --- | ---: | ---: |
| First delegation correct | 27/53 | 36/53 |
| Final correct | 29/53 (54.7%) | 38/53 (71.7%) |
| Worker requests | 74 | 79 |
| Cloud planner calls | 124 | 132 |
| Worker model calls | 370 | 356 |

Ten questions improved and one regressed, for an observed increase of 17.0 percentage
points. Nine improvements previously had correct values with unsolicited columns.
The UTC-day count also improved after dropping an unnecessary date projection.
The one regression omitted UTC conversion for a legacy multi-year value query.
Another case lost a correct initial answer after a needless correction.

In one live case, the worker returned the winning quarter and an unrequested count.
The host reported the width mismatch; the model requeried for the quarter label and
then finished successfully. No invalid finish was attempted in that run; forced
invalid finishes are tested offline.

The paired statuses, model IDs, source hashes, and resource totals are recorded in
[cloud-model-planner-results.json](cloud-model-planner-results.json). Raw model
traces, fixture paths, credentials, and row data are excluded. The full live suite
runner and local service configuration are not included here, so this summary is
not a self-contained live benchmark command.

This is a single historical comparison on questions already used for failure
analysis, not independent held-out validation. Sampling noise and tuning on this
suite limit generalization claims. Remaining failures include UTC/FX repair semantics,
channel labels, percentage definitions, and month serialization. Two possible
conflicts between golden values and project metric definitions remain scored as
failures pending clarification; they do not change the reported accuracy.
