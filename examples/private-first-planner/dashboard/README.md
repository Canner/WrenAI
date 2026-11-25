# Independent dashboard planning and frontend generation

The private planner chooses the analysis and admitted data scope. This package
splits the cloud task into two independently runnable units:

| Unit | Input | Output and evaluation |
| --- | --- | --- |
| `dashboard-plan` | Authorized aggregate report, question, definitions, default period | Validated plan: section questions, measure/dimension bindings, chart choices and rationales, interactions and limitations |
| `dashboard-frontend` | The same report plus a fixed validated plan | Free HTML/CSS/JavaScript; numerical, interaction, plan-fidelity and geometric browser checks |
| `pipeline` | The report and question | Plan first, then frontend with at most one repair of that same plan |

The existing `eval/run.mjs cloud-planner` is retained for compatibility with its
legacy code-generation contract suite. It does not evaluate the new planning
stage. `fixtures.mjs` contains synthetic test code, never a live renderer.

## Offline evaluation

From the example directory, with Node 22+:

```sh
node dashboard/eval.mjs dashboard-plan /absolute/path/to/new-plan-eval
node dashboard/eval.mjs dashboard-frontend /absolute/path/to/new-frontend-eval
node dashboard/eval.mjs dashboard-frontend /absolute/path/to/new-browser-eval --browser
```

The first two commands use scripted models and no network. The browser command
requires the existing `design` dependencies and macOS isolated Chromium. Every
output directory must be new. Expected rejection passes a contract case but is
not successful task completion; both fields are retained. No model quality or
real cost is inferred from scripted fixtures. The collaboration `offline`,
`browser`, and `behaviors` gates include these units and tests in existing CI jobs.

`units.mjs` exposes `planDashboard`, `frontendUnit`, and `dashboardPipeline` for
host integrations with explicit broker/model/inspection ports. Plan failure
stops the pipeline. Each frontend repair uses the same immutable validated plan;
repair diagnostics sent to the cloud are the existing allowlisted categories.
No user interaction, routing, Wren client, or database access moves to Warble.

## Explicit live replay

Live calls require all inputs and a separate binding file, plus `--allow-cloud`:

```sh
node dashboard/run.mjs pipeline INPUT.json BINDING.json NEW_OUTPUT --allow-cloud
node dashboard/run.mjs dashboard-plan INPUT.json BINDING.json NEW_OUTPUT --allow-cloud
node dashboard/run.mjs dashboard-frontend FIXED_PLAN_INPUT.json BINDING.json NEW_OUTPUT --allow-cloud
```

Input has `{report, scope:{lower,upper}, question, definitions}`. Frontend-only
input additionally has `plan`. It validates that plan against the same report,
then rebinds only its export ID to a fresh approved grant, recording the original
digest; it makes no planning call. The input must be an operator-authorized
aggregate snapshot. Structural report validation is not an independent proof
of database correctness or authorization. This replay CLI explicitly approves
that supplied snapshot; applications must use their normal user-grant flow.

Binding has `command` (absolute Claude executable), `base_url`, `api_key`,
`model: "claude-opus-5-5"`, `effort: "low"`, `timeout_ms: 240000`,
`plan_output_tokens: 4096`, and `frontend_output_tokens: 24576`. No credential
discovery or implicit live switch is provided. Never commit binding files or
real report inputs. CLI 2.1.309 remains pinned. Each invocation retains the
existing USD 0.50 CLI budget; it is not a hard aggregate billing cap. One plan
call plus up to two frontend calls is the maximum logical-call schedule.

Plan deadline is 240 seconds, frontend lifecycle 600 seconds, and grant TTL
900 seconds. The adapter bounds each call at 240 seconds; defaults for legacy
callers remain 90 seconds and 120-second grants. Cancellation, expiration,
revocation, freshness, recipient and per-HTTP-attempt authorization still apply.

`manifest.json` records input and independent unit release digests. Each request,
result envelope (including nonzero CLI exits), safe diagnostic, validated plan,
candidate, QA and final result is saved with private local permissions.
Transport diagnostics retain usage and stop reason incrementally, rather than
depending on a shared proxy's full-response retention. They omit headers and
stderr. Budget, max-token, stream-size and timeout failures have distinct codes;
malformed output and admitted-code rejection remain distinguishable. A partial
usage trace must not be treated as a complete cost ledger.

## Contract and tuning boundaries

Behavior prompts live only in `behaviors/profile/components/plan_dashboard`
and `generate_dashboard_frontend`. Compile with the pinned Warble 0.21.1 using
`node dashboard/behaviors/compile.mjs`; `--check` rejects stale artifacts.
Host `contracts.mjs` owns structured schemas and capability validation. Runtime
configuration is independent of those prompts. `releaseFor(unit)` fingerprints
the selected prompt and relevant host code, not the other unit's prompt.

Version 1 retains five semantic sections (metrics, breakdown, trend, details,
observations), whose order and layout the planner chooses. Supported category
charts are horizontal bars/dots; trends support bars, lines and areas. This is
a bounded visualization vocabulary, not arbitrary chart admission. The planner
chooses chart types; the frontend implements them without a fixed renderer.

Browser checks compare original and changed data on desktop/mobile across
filters, dimension switches, label/mark/keyboard/touch drill, roll-up, reset,
period changes and invalid ranges. Visible semantic markers bind sections and
real graphical marks to the plan. Bar scales tolerate 2 pixels or 5% rounding;
dot/trend point positions use a 2-pixel tolerance. These checks are useful
regressions, not proof of every pixel: line-path fidelity, semantics of prose,
negative-value designs and subjective layout still need review. The current
numeric oracle expects a two-dimension monthly revenue report with gross and
optional refund/net measures. Do not present it as a general BI chart verifier.

Wrong numbers, broken interactions, plan substitution or material geometric
distortion fail QA. Font size, wrapping, overflow and contrast are quality
observations, not arbitrary aesthetic rejection. Visual review stays separate
from automatic scores. The live generator remains free to choose HTML/CSS/SVG
or canvas, but the current point/line QA requires inspectable SVG trend marks
and paths for line/area. Unsupported rendering strategies need a new verifier.

Tune planning with fixed reports; tune frontend with fixed plans. Then run the
combined pipeline separately and retain all failures. Compare generation,
correctness, visual quality, repairs, latency, tokens and estimated cost as
separate measurements. Never change prompts or replace failed trials mid-batch.
