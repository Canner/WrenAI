# Private-first application host

This is a runnable **local, single-user** composition of the three independently
evaluable harnesses. It uses the released Wren 0.18.0 service and Warble 0.21.1
behavior artifacts. The private conversation executor is pi-agent-core 1.0.4;
pi-tui 1.0.4 is a thin UI. There is no second conversation planner behind pi.

## Ownership

| Layer | Owns |
| --- | --- |
| Warble components | Intent extraction, dashboard design instructions, repair instructions; compiled artifacts and hashes |
| Application host | Durable commands/events/task history, question IDs, revisions, route policy, grants, budgets, cancellation, artifacts and QA |
| Private pi planner | One bounded intent decision using the compiled `resolve_intent` behavior and private authorized context |
| Wren `serve agent` | Private worker profile, metadata, SQL generation/validation/execution, session revisions, continuation/result/evidence references |
| Isolated Claude specialist | Approved aggregate dashboard code; no access to the private transcript, metadata, SQL or database credentials |
| pi terminal | Display and trusted user commands; no authorization or routing logic in the model |

The dependency direction stays application → public Warble contracts. Nothing in
this example requires a workflow engine, durable application state, or Wren
knowledge in the Warble compiler.

## Install and start

Run from this example's root using Node 22:

```sh
npm ci --prefix host --ignore-scripts
npm ci --prefix p1 --ignore-scripts
npm ci --prefix p5 --ignore-scripts
p5/node_modules/.bin/playwright install chromium
node host/run.mjs scripted /absolute/path/to/new-local-run
```

This mode uses a real pi loop and deterministic provider/worker replies. Cloud
generation is scripted; real browser QA runs. Browser execution requires macOS
with `sandbox-exec`, matching the existing free-design experiment. Other systems
fail closed rather than run generated JavaScript without that isolation.

The host prints a connection-file path, not its access token. In another terminal:

```sh
node host/tui.mjs /absolute/path/to/new-local-run/connection.json
```

Example request:

> 請用專案定義的營收，2026-01-01（含）到 2026-01-19（不含）、UTC，顯示總營收及按週營收，做成漂亮精緻的主管 dashboard。

The terminal shows the exact proposed aggregate payload, approved brief, recipient,
expiry and repair ceiling. `/approve` authorizes that proposal; `/deny` retains the
private result. Ordinary conversation text cannot grant export. Other commands:

- `/plan <request>`: plan only; no data query.
- `/cancel`: revoke current export and close the owned Wren session.
- `/redesign default`: reuse current results after reauthorization, then request a new grant. No repeated query.
- `/quit`: disconnect the UI; the separate host keeps its state. Reconnect with the same connection file.

Private results are inert HTML. Successful cloud artifacts are JSON plus desktop
and mobile QA screenshots. The [delivery contract](VALIDATION.md) separates
blocking data/runtime/security failures from visual warnings. The host can deliver
a candidate with typography, overflow or contrast warnings; pi displays those
warnings and does not silently request another model call for them. Delivery is
not the same as passing all quality checks. To interact with a delivered dashboard:

```sh
node host/preview.mjs /absolute/path/to/accepted-candidate.json
```

The viewer uses the same OS network/home restrictions, opaque iframe and CSP as
QA. It refuses rejected candidates. Do not paste generated code into the host
origin or execute it in Node. The viewer closes after five minutes.

## Real Wren, without paid models

Use the same explicit `worker-config.json` fields as `eval/README.md`: absolute
`python`, `wren`, `warble`, `runtime`, and `context_loader` executable paths. The
preflight checks Wren 0.18.0, SQLGlot 29.0.1, compiler/runtime 0.21.1.

```sh
node host/run.mjs scripted-wren /absolute/path/to/new-run /absolute/path/to/worker-config.json
node host/verify.mjs /absolute/path/to/new-evidence /absolute/path/to/worker-config.json --browser
```

The latter runs all four existing P4 requests across private-only, fixed-cloud,
and adaptive routing (12 flows). It checks the independent numeric/period oracle,
required clarification, exact route, grant-before-send, private canary exclusion,
and optionally real browser QA. Scripted replies test architecture, **not model
quality**. Neither endpoint latency nor real-model costs can be inferred from them.

## Live bindings

`node host/run.mjs live RUN_DIRECTORY CONFIG_JSON` is explicit opt-in and can incur
model charges. No live mode is selected by default. `runtime.liveHost` accepts:

- `planner`: `{id, baseUrl, credentialEnv}` for Nemotron. The endpoint is fixed for
  the lifetime of the host; HTTPS or explicit loopback HTTP only. Credential env
  values are read by the host and are not serialized into task state.
- `wren`: the existing `connectWren` config `{command,args,credentialEnv,env}`.
  `args` must include `--service-config PATH`. Bind an absolute project, worker
  profile, runtime, compiler, loader and full result/evidence policy. Use the
  pinned environment from the worker evaluation. A new local copy of the service
  config gets a fresh exclusive audit path on each host start; source files stay
  unchanged. One Wren service is shared by sequential, independent task sessions.
- `claude`: `{command,model,baseUrl,credentialEnv}`. The isolated CLI adapter still
  requires Claude Code 2.1.309. Each generation/repair has its own disposable CLI
  state, no tools or MCP servers, an allowlisted environment and mandatory
  reauthorization at every actual HTTP request. The existing ceiling is USD 0.50
  per invocation, at most two invocations; actual billed costs may be unavailable.
- `synthetic_files`: an explicit map of absolute fixture source paths to
  `digest(Buffer.from(file).toString('base64'))`, using `contracts.mjs`'s canonical
  digest. Pin the database and project inputs. The default policy permits only
  the known synthetic revenue payload, not real data.

Programmatic callers can supply a trusted deployment `policy` to `liveHost`.
`aggregatePolicy({id,version,briefs,verify,project})` is the domain-policy seam:
`verify` must establish source identity, aggregation semantics, allowed dimensions,
required evidence and period scope; `project` must discard all private labels,
refs, metadata and SQL. These are reviewed application code, **never model tools**.
There is deliberately no universal "this looks aggregated" classifier. The
bundled revenue component and QA oracle target the revenue payload contract;
other domains need their own versioned projection, behavior and QA contract.

An NVIDIA-hosted Nemotron endpoint is not an attested private deployment. Endpoint
residency and network controls require deployment-specific verification.

## Durable control contract

The authenticated loopback API provides `GET /state` and `POST /commands`.
There is no browser CORS surface; requests with an Origin header are refused.
Protect `connection.json` like a local control credential. Commands have exactly:

```json
{"id":"unique-command-id","expected_revision":12,"type":"answer","payload":{"question_id":"host-question-id","answer":"user answer"}}
```

`submit`, `answer`, `export`, `redesign`, and `cancel` are validated in
`controller.mjs`; `uiCommand` is the reference UI mapping. An identical command ID
and body returns its stored receipt even after revision advances. Reusing an ID
with another body or submitting a stale revision/question is rejected. On a lost
HTTP response, retry the **same complete command**, not a new ID. The CLI UI does
not silently retry an unknown outcome.

All transitions and command receipts are atomically persisted and fsynced before
side effects. The store also retains prior task snapshots, export decisions,
checks and artifact references. Files are local/private (directories 0700, files
0600). One owner process holds the store. This is a local JSON journal, not a
multi-process transactional database or multi-tenant authorization system.

Wren's revision, continuation and result refs stay inside `WorkerSession` and are
distinct from UI revisions/question IDs. Human waits consume no active effect
deadline. Planner decisions are capped at three, worker calls at eight, each
active segment at five minutes, and cloud design at two attempts. Expired grants
are rejected; repair cannot extend or broaden one. Usage/cost unknowns remain
null. Per-stage time, candidate QA and known usage remain in task/artifact records.

UI disconnect/reconnect preserves the running host. Host restart interrupts all
unfinished work, invalidates grants and clears current reuse eligibility; it does
not pretend to restore Wren's in-memory sessions or retry an unknown cloud side
effect. Historical artifacts remain local. A new task starts a fresh session.
Service loss also fails closed; resubmit explicitly after fixing the deployment.
Cancel uses Wren's public `close_session`, not an invented `cancel_task` API. Late
model/browser/worker results cannot become accepted artifacts.

## Tune each unit independently

| Unit | Behavior | Shared execution / isolated eval |
| --- | --- | --- |
| Private planner | `behaviors/profile/components/resolve_intent/` | `host/pi.mjs`, `host/eval.mjs:piPlannerUnit`, `eval/runner.mjs` |
| Data worker | `p1/profile/` | `harnesses/worker.mjs`, `eval/units.mjs:workerUnit` |
| Cloud planner/designer | `design_free_dashboard/`, `repair_dashboard/` | `host/cloud.mjs`, `host/eval.mjs:cloudRepairUnit`; single-attempt `cloudUnit` remains available |

The host snapshots per-unit release hashes. The planner release now includes its
pi adapter; the cloud release includes both design and repair components and the
QA executor. Changing one component changes that unit's release, without silently
promoting another. Provider bindings, expectations and scorers remain separate.
Use the existing runner's immutable case manifests and explicit live factory
ports; do not give the model expected outputs or turn production approvals into
model-visible tools. Keep new runs in new output directories and preserve P4/P5.

```sh
node --test host/test/*.test.mjs
node --test host/browser.test.mjs
node --test eval/test/*.test.mjs
node eval/run.mjs private-planner /absolute/path/to/new-planner-eval
node eval/run.mjs data-worker /absolute/path/to/new-worker-eval /absolute/path/to/worker-config.json
node eval/run.mjs cloud-planner /absolute/path/to/new-cloud-eval --browser
```

The legacy planner CLI uses its existing adapter for baseline comparability. Use
`piPlannerUnit` to evaluate the production pi adapter; its case/output/scoring
contract is the same. `cloudRepairUnit` accepts an already trusted broker and
the same designer/QA/artifact ports as the host, with no Wren or private planner
required. Stock pi coding-agent CLI, web UI, GPT transport and multi-tenant hosting
are separate adapters/deployments, not implemented by this local terminal entry.

Private data delivery uses [data-verification/1](DATA-VALIDATION.md). Completion of a preview does not imply verified data; UI and evaluation consumers must use the data assessment.
