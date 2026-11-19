# Private-first agent reference

A local, single-user application host that combines a private conversational
planner, Wren data worker, and isolated dashboard design specialist. Behavior is
expressed in application-owned Warble components. The host owns state, user
approval, routing, budgets, and delivery; model output never grants authority.

Start with the [collaboration guide](collaboration/README.md). Data-worker owners
can go directly to the [independent handoff](collaboration/DATA-WORKER.md).

An opt-in [interactive dashboard laboratory](interactive/README.md) adds KPI cards,
filters, dimension switching, drill-down/roll-up and reset over synthetic aggregates.
It preserves free frontend generation and has an independent offline browser gate.

A [monthly revenue replay workflow](revenue/README.md) connects the same pi and host
boundaries to coverage-based planning, verified aggregate replay and free Claude
design. Its prompts, contracts and offline tests are checked-in source.

## Quick contract check

From this example directory, with Node 22 or newer:

```sh
npm run test:worker -- /absolute/path/to/new-worker-contract-results
```

No installation, network, database, credentials, or model calls are required for
this gate. It exercises the actual WorkerSession and data classification with
synthetic ports. It is not evidence of live model quality. Existing output
directories are refused. Full offline, real-service scripted, browser and compiler
gates have separate documented prerequisites.

## Current implementation

| Area | Entry |
| --- | --- |
| Shared contracts and ownership | [Contract index](collaboration/CONTRACTS.md) |
| Durable host, embedded pi UI, cancellation, export, repair | [Host guide](host/README.md) |
| Warble behavior sources and compile drift check | [Components](behaviors/README.md) |
| Independently evaluable planner / worker / cloud designer | [Evaluation guide](eval/README.md) |
| Verified / unverified / rejected data | [Data validation](host/DATA-VALIDATION.md) |
| Blocking failures versus visual warnings | [Dashboard admission](host/VALIDATION.md) |
| Review order, gates and version changes | [Contributor guide](collaboration/README.md) |

Free dashboard generation returns HTML/CSS/JavaScript, not a fixed renderer.
The cloud receives only approved synthetic aggregates and the approved brief.
Metadata, raw data, SQL, private conversation and DB credentials stay outside
that request. Generated code runs only in the documented macOS isolation path;
other platforms fail closed for browser execution. The private-only route in the
current host delivers an inert table, not a Nemotron-generated frontend.

## Source layout

| Directory | Responsibility |
| --- | --- |
| `revenue/` | Supported-period planning, verified replay coordinator and browser evaluation |
| `planner/` | Intent admission and the isolated planner transport |
| `worker/` | Query constraints, private profile and fixture setup |
| `design/` | Claude transport, free frontend contracts and isolated browser QA |
| `host/` | Wren client, application state, embedded pi, policy, routing, export and delivery |
| `behaviors/` | Current Warble intent, free design and repair components |
| `harnesses/` | Shared execution boundaries and release fingerprints |
| `eval/` | Independent suites, shared four-case scenarios and scorers |
| `collaboration/` | Handoff, pinned dependencies, gates and source packaging |

`host/run.mjs` is the application entry; `host/live-benchmark.mjs` evaluates the
same application across three routes. Live runs are explicit opt-in and can
incur charges. CI uses scripted providers only. Generated artifacts, historical
experiments and private audit logs are kept outside this source package.

## Scope

This is a reference example, not a multi-tenant service or general safe-code
hosting platform. Default disclosure, data verification and dashboard content
contracts target the synthetic revenue fixture. Real data requires reviewed
project-specific verification/projection and authorization. An NVIDIA-hosted
endpoint is not a verified private deployment. Stock pi coding-agent CLI, GPT,
a dedicated design-service integration, and cross-process Wren session recovery
are not implemented by this example.
