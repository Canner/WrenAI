# Shared contract index

This is a map to the executable source of truth, not a second schema validator.
The IDs below are local consumer/evaluation contracts, not new Wren MCP APIs.

| Boundary | Version / identity | Authoritative implementation | Owner |
| --- | --- | --- | --- |
| Planner input / decision | `planner-input/1`, `planner-decision/1` | `harnesses/releases.mjs`, `host/pi.mjs`, `planner/intent.mjs` | Planner + host admission |
| Wren MCP transport | Released `serve agent` tool protocol | `host/adapters/wren-client.mjs` | Host client; Wren owns server |
| Data task / result | `wren-data-task/2`, `wren-data-result/2` | `harnesses/worker.mjs`, `worker/retrieval.mjs` | Host session adapter + worker query contract |
| Data classification | `data-verification/1` | `harnesses/data-validation.mjs`, `host/policy.mjs` | Shared evidence rules + domain host policy |
| Authorized design input | `authorized-design/1` | `host/export.mjs`, `host/policy.mjs`, `host/cloud.mjs` | Host |
| Free frontend code | `frontend-code/1` | `design/contracts.mjs:codeSchema/validateCode` | Design + host admission |
| Dashboard delivery | `revenue-dashboard-delivery/2` | `host/validation.mjs` | Host |
| Browser / chart observations | `revenue-browser-evidence/2`, `revenue-chart-presence/2` | `design/qa.mjs`, `design/chart.mjs` | QA |
| Harness release | `harness-release/1` | `harnesses/releases.mjs:releaseFor` | Evaluation |
| Trusted UI command / journal | Strict command shape; store format version 1 | `host/controller.mjs`, `host/store.mjs`, `host/http.mjs` | Host; local single-user only |

Paths are relative to the example root. `contracts.mjs` contains only shared
canonical digest, immutability and assertion utilities. The current boundary
validators listed above are the executable source of truth.

## Authority and lifecycle invariants

- Only trusted UI ingress supplies user answers and export grants. Model output
  proposes a plan; it cannot change caller, project, recipient or service policy.
- Host revision/question ID and Wren revision/continuation ref are different
  namespaces. Host serializes service operations and uses returned revisions.
- `reply_to` refers to a previously accepted result; `continuation_ref` resumes a
  pending clarification. Never swap them or guess a service revision.
- Wren returns controlled results/evidence. The worker adapter checks bindings,
  grain, requested period and applicable semantics. Missing proof is not zero
  and not automatically a wrong answer. See [worker examples](DATA-WORKER.md).
- Verified data still needs a separate current export grant. Grant binds exact
  projected data, brief, recipient, purpose, policy version, epoch and expiry;
  authorization is rechecked at each actual cloud send and before use.
- Delivery and quality differ: functional/data/security blockers reject; visual
  warnings can accompany delivery. Unknown contrast is not a pass. Repairs are
  bounded and receive only filtered diagnostic codes.
- Interrupted effects are not silently replayed. Late results cannot become
  accepted artifacts after cancellation. Wren refs are session-local, not durable
  URLs or cross-restart recovery tokens.

## Compatibility and collaboration

Freeze the input/output ID, component release, provider binding, cases and scorer
for a comparison. Keep expected values outside model input. Add cases without
rewriting historical runs; use a new output directory even for failed probes.
Document whether a result is a real model run, scripted service check or offline
reclassification. Replay old artifacts with their original observations or an
explicit new observation run; do not relabel old records as the new contract.

Worker changes should first pass `worker-contracts`, `worker-service` and `python`,
then `offline` and `host-service` for integration. Planner changes also need its
unit suite and host pi tests. Design/QA changes need `behaviors`, `browser`, and
cloud/host contract tests. A changed shared validator affects multiple releases.

The revenue fixture oracle is deliberately scoped. It does not prove arbitrary
SQL business correctness. Likewise visible chart marks do not certify every bar,
axis, occlusion, aesthetic choice or accessibility requirement. Extend these
contracts with explicit cases before claiming another data domain is supported.
