# Independent harness evaluation

Run the private planner, data worker, or cloud planner/designer independently.
Each run records a component-specific release fingerprint, execution binding,
case/oracle fingerprints, attempts, outcome, scores, and resource measurements.
An existing output directory is never overwritten.

The CLI ships **scripted contract suites**, not a new model
quality benchmark. Synthetic token counts are explicitly associated with
`mode: scripted`; cost remains unknown. The data-worker suite does execute the
real Wren service, pi runtime, query gate, and isolated synthetic database.

## Run one unit

From this example's directory, with Node 22 or newer and the host-owned `host/adapters`
client dependencies installed:

```sh
node eval/run.mjs private-planner /absolute/path/to/new-planner-run
node eval/run.mjs cloud-planner /absolute/path/to/new-cloud-run
node eval/run.mjs data-worker /absolute/path/to/new-worker-run /absolute/path/to/worker-config.json
node --test eval/test/*.test.mjs
```

The first two commands make no network/model calls. The worker command starts
only a loopback scripted model server and its own stdio Wren processes. It does
not read real provider credentials, use an existing database, or require the
conversation planner/cloud designer. Every worker case gets a fresh project,
database, service, session, and HOME/WREN_HOME.

The optional browser path uses the isolated design browser and its watchdog:

```sh
node eval/run.mjs cloud-planner /absolute/path/to/new-cloud-browser-run --browser
```

This requires the `design` dependencies and Chromium already installed, and the
current browser implementation requires macOS. Without `--browser`, generated
code is admitted but not executed; `quality_measured` is false. A successful code
contract is never presented as a passing browser/design quality score.

Worker configuration contains trusted executable paths, **no credentials**:

```json
{
  "python": "/absolute/path/to/pinned-venv/bin/python",
  "wren": "/absolute/path/to/pinned-venv/bin/wren",
  "warble": "/absolute/path/to/node_modules/.bin/warble",
  "runtime": "/absolute/path/to/node_modules/@warble/pi/dist/service.js",
  "context_loader": "/absolute/path/to/wren-context-loader"
}
```

Preflight requires Wren 0.18.0, SQLGlot 29.0.1, Warble and `@warble/pi` 0.21.1.
Node version, runtime-entry digest, and loader digest are recorded under the
adjacent `<output>-services/environment.json`. The service subprocess uses the
same Node executable directory as the evaluator. The context loader remains an
explicit prerequisite; the evaluator never builds or downloads missing tools.

## Shared production paths

| Unit | Executed code | Isolation |
| --- | --- | --- |
| `private-planner` | `harnesses/planner.mjs`, existing Nemotron transport, compiled `resolve_intent`, intent parser | Fixed capabilities and scripted user replies; no Wren/cloud tools |
| `data-worker` | `harnesses/worker.mjs`, host-owned Wren client, real `serve agent`, worker profile and private runtime | Fresh synthetic DB and loopback model; no conversation planner or cloud |
| `cloud-planner` | `design/design.mjs:generateCode`, fixture broker, code admission, optional isolated browser QA | Pre-authorized synthetic aggregate; no planner or DB query |

The current application host and isolated cloud evaluator both use `generateCode`.
Use `host/eval.mjs:piPlannerUnit` for the production embedded pi executor; the
CLI planner suite uses the isolated transport with the same intent contract.
There is no second copy of prompts under `eval/`; they remain in Warble components.

The Wren client and `WorkerSession` belong to the host team and are reused here
without starting the application UI. The worker team owns profile/query behavior
and these isolated worker cases.

The worker's private root-to-leaf delegation is part of the worker harness. Its
scripted provider returns real tool calls and echoes host-issued evidence tokens;
the expected result numbers are not substituted into the service response.
The evaluator checks the real results against a separate numeric/period oracle.

## What is covered

- Planner: explicit requirements, clarification plus actual scripted answer,
  missing period, unsupported request, unrequested grain, provider timeout.
- Worker: scalar/weekly results, clarification/resumption, denied column,
  wrong-grain output admission, provider failure.
- Cloud: valid code, revoked grant before send, stale data version, inline script
  rejection, revocation before use; optional actual rendering and data rebinding.
- Runner: exclusive artifacts, hidden oracle separation, failure preservation,
  version pins, independent component fingerprints, cancellation/late completion,
  cleanup errors, unknown costs, and no unconfigured provider calls.

A negative case can have `state: failed` and `score.passed: true`: the expected
behavior was rejection. Summary `passed` means expected contract behavior, **not**
successful task completion. Both fields are retained. No failed sample is replaced.
An interrupted run may contain a manifest and completed sample records without a
summary; do not reuse that directory or interpret it as complete.

## Tune one harness

1. Keep the other harness releases, provider bindings, case set, and scorer fixed.
2. Edit the selected component/context/tool implementation. For behavior changes,
   regenerate the compiled artifact with `node behaviors/compile.mjs` using the
   pinned compiler. The existing admission rejects stale artifacts.
3. Run its contract suite and relevant adjacent-contract tests.
4. Run a separately configured **live** evaluation using the programmatic ports
   below. The CLI intentionally has no implicit live-mode switch or credential
   discovery. Fake results establish execution correctness, not prompt quality.
5. Compare per-case quality, failures, time and cost under a preregistered protocol;
   then rerun the four-case host integration protocol before adopting a release pin.

`releaseFor(id)` hashes the selected compiled behavior and its host dependencies.
A cloud prompt change does not change the private-planner or worker fingerprint.
A shared implementation change can legitimately change several fingerprints.
Input/output contract versions are separate from release IDs. Run bindings do
not contain secrets; models, parameters and budgets are separate from behaviors.

## Programmatic evaluation ports

`runSuite` accepts:

```js
await runSuite({
  harnessId: 'private-planner',
  cases,                 // [{id, input, expected}]; expected stays in the scorer
  binding,               // mode, model, deployment, runtime, parameters, limits
  createUnit,            // ({input, binding, signal, observeAttempt}) => unit
  score,                 // (runRecord, expected) => {passed, checks}
  scorerVersion,
  out,                   // new directory
  repeat: 3,
  expectedRelease        // optional release fingerprint; mismatch refuses early
});
```

The unit supplies `run()` and optional idempotent `close()` / `traceRefs`.
Use `plannerUnit` with the real `NemotronPlanner` and `plannerContract`,
`workerUnit` with a real `connectWren` port, or `cloudUnit` with the existing real
designer adapter and a trusted broker. Factories must bind exactly the declared
model, parameters, tools and limits, honor cancellation, report **each transport
attempt**, and clean up their owned resources. They are trusted host code, not
model-controlled plug-ins. The runner is not an OS sandbox for arbitrary adapters.

For planner runs, `plannerUnit` collects existing model call records, including
failed/truncated responses. For worker/cloud integrations, use `observeAttempt`
or the unit's `collectAttempts` hook to normalize provider/audit records. Do not
invent per-attempt costs from an invocation total. An unobservable value is null.
On deadline, `attempts_complete: false` prevents a partial trace being mistaken
for a complete usage ledger. `mode: live` labels an operator-supplied live binding;
it does not itself prove that a custom adapter contacted a model.

Caller-supplied suites/scorers can extend the starter cases. Keep development and
held-out cases separate; expected outputs and judge answers never enter
`createUnit`. The report captures built-in eval source fingerprints; custom
factory/scorer code must also be versioned by the integration that supplies it.

## Evidence and remaining work

`manifest.json` freezes releases, binding, case/oracle hashes, schedule, scorer
version and built-in eval source hashes. Each `<case>-<repeat>.json` includes
output, attempts, elapsed time, scores and trace references. `summary.json`
retains per-sample state, pass/fail and resource totals. Worker audit and captured
private model requests stay in the adjacent service directory, with private file
permissions; they must not be uploaded as public or cloud-judge input.

The durable application host and pi terminal are documented in [host/README.md](../host/README.md).
This evaluation runner does not implement a general real-data export policy,
automatic promotion, or a comprehensive held-out dataset.
Live model quality baselines and independently reviewed visual scores still need
their own runs. Previously recorded artifacts remain outside this source package as comparison baselines.

For worker evidence classification, historical regression and isolated live worker runs, see [data verification](../host/DATA-VALIDATION.md). The worker v2 contract carries an explicit requested period and returns verification independently of execution completion.

## Interactive dashboard cases

The [interactive laboratory](../interactive/README.md) is an independent synthetic
design harness, outside the old revenue benchmark denominator. Run
`node collaboration/check.mjs interactive NEW_OUTPUT` for browser journeys and
failure/repair probes. Current runs use a fake designer and make no quality claim
about live providers. Old results and four-case inputs remain untouched.
