# Private-first agent reference

A local, single-user application host that combines a private conversational
planner, Wren data worker, and isolated dashboard design specialist. Behavior is
expressed in application-owned Warble components. The host owns state, user
approval, routing, budgets, and delivery; model output never grants authority.

Start with the [collaboration guide](collaboration/README.md). Data-worker owners
can go directly to the [independent handoff](collaboration/DATA-WORKER.md).

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

## Earlier experiments

The [P0 fake controller](collaboration/P0.md), [P1 live Wren integration](p1/README.md),
[P2 cloud adapter](p2/README.md), [P4 constrained-design comparison](p4/README.md),
and [P5 free-design comparison](p5/README.md) remain available to reproduce their
own protocols. They are not interchangeable scoring regimes. Live runners are
explicit opt-in, can incur charges, and are never invoked by collaboration CI.
Historical generated dashboards, provider requests and private audit logs are
not part of this source package; preserve them separately with their original
source/config hashes. Do not overwrite or replace failed samples.

## Scope

This is a reference example, not a multi-tenant service or general safe-code
hosting platform. Default disclosure, data verification and dashboard content
contracts target the synthetic revenue fixture. Real data requires reviewed
project-specific verification/projection and authorization. An NVIDIA-hosted
endpoint is not a verified private deployment. Stock pi coding-agent CLI, GPT,
a dedicated design-service integration, and cross-process Wren session recovery
are not implemented by this example.
