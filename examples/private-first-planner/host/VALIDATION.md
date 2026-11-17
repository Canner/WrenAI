# Dashboard delivery contract

`revenue-dashboard-delivery/2` is the host's delivery policy for the synthetic
revenue dashboard. It accepts arbitrary HTML/CSS/JavaScript layouts within the
existing isolated code contract; it does not choose a renderer or judge aesthetics.
It is not yet a validator for arbitrary domains, languages or chart semantics.

## Decisions

| Decision | Meaning | Automatic repair |
| --- | --- | --- |
| `accept` | Required checks pass, no recorded visual warnings | No |
| `accept_with_warnings` | Required checks pass; visual problems or uncertainty remain | No |
| `reject` | A required check fails or evidence is incomplete | At most once for functional failures only |

`pass` means deliverable. `quality_pass` requires delivery **and** zero warnings.
Neither proves aesthetic quality or accessibility conformance. Both the artifact
record and pi status retain the distinction. The isolated preview CLI also prints
warnings. The original browser `passed` score is retained as
`strict_quality_pass`, including the historical rule that any contrast unknown
fails the strict score. Existing benchmark files are never rewritten.

## Required checks

Before QA, the existing export authorization, payload version, code structure and
size checks still apply. Generated code runs only in the existing network-denied,
home-denied browser with an opaque iframe and CSP. Authorization is checked again
before use. An authorized aggregate does not authorize arbitrary external fetches.

Browser measurements must complete normally and include both 1280×900 and 390×844
views plus the changed-data probe. Missing evidence, timeout, invalid evidence
version or abnormal process exit rejects; it never becomes a visual warning.

At both viewports, required revenue values, week dates and period must match the
payload, the chart and synthetic-data label must be present, the specified details
control must work, and there must be no captured JavaScript errors or network/CSP
violations. The changed-data probe checks updated values/dates/period, chart and
label presence, plus runtime/network errors. This catches hardcoded fixture values
and failures triggered only by changed data. It does not test every possible input.

The current content contract still uses `data-value`, `data-week`, `data-period`,
`data-chart`, `data-action` and `data-details` selectors. Period text contains the
two dates, UTC, `inclusive` and `exclusive`; a synthetic label contains `synthetic`.
These are declared fixture requirements, not inferred universal design rules.
Chart presence accepts SVG, canvas and CSS bars under `revenue-chart-presence/2`.
The visible `data-chart="revenue_weekly"` element may be the chart itself or its
container. Empty/hidden SVG, blank or solid canvas, text-only labels and hidden
ancestors are not positive chart evidence. SVG needs visible painted geometry;
canvas needs nonuniform painted pixels; CSS needs a visible colored text-free
leaf per weekly row. This is bounded presence detection, **not** correctness of
every bar, axis, legend, clipping/occlusion or arbitrary chart implementation.
Pseudo-element-only CSS charts are not observed; use DOM bars, SVG or canvas.

If the marker is misplaced, one unambiguous visible `role="img"` element with an
accessible weekly-revenue label, all weekly semantic value/date markers and actual
rendered chart marks can be recovered. Delivery then includes
`chart_marker_mismatch`, without a paid repair. An unrelated decorative image or
a text table cannot satisfy this fallback. Data and changed-data checks still run.

Browser evidence is now `revenue-browser-evidence/2`; old evidence must be replayed,
not silently relabeled. The prior SVG/canvas presence boolean remains as
`chart_legacy_present` for the historical strict score. Thus a recovered valid CSS
chart can be deliverable while its unchanged historical strict score is false.

## Advisory visual checks

| Local warning | Measurement | Delivery effect |
| --- | --- | --- |
| `chart_marker_mismatch` | A uniquely identified rendered weekly chart is outside the required marker | Accept with warning |
| `small_text` | Visible text below approximately 12px; SVG screen scaling included | Accept with warning |
| `horizontal_overflow` | Document exceeds viewport by more than 1px | Accept with warning |
| `contrast_violation` | axe reports a contrast violation | Accept with warning; confirmed issue retained |
| `contrast_unverified` | axe cannot determine contrast | Accept with warning; uncertainty retained |

Even severe measured typography or contrast issues remain visible warnings in
this version; acceptance is not a claim of mobile usability. Invisible/missing
required data still rejects through the functional checks. No model is asked to
approve its own work, and no aesthetic score gates delivery. Do not reinterpret
unknown contrast as verified contrast, nor a warning as a repaired problem.

## Repair and evidence

Data, missing required content, interaction and runtime failures may request one
repair under the existing grant and deadline. Only allowlisted `data_binding`, `chart_rendering` and
`interaction` classifications leave the host; selectors, raw errors and local
measurements stay in the local QA directory. Warnings alone never cause a cloud
repair. Network, missing-evidence and authorization failures do not automatically
retry. The repair component describes `chart_rendering` explicitly; it is not misreported as a numeric binding error.

`qa.json` stores raw measurements; `assessment.json` stores the versioned decision,
blockers, warnings and original strict score. The cloud harness release hash
includes the policy source. A policy or severity change must be documented and
versioned, with regression cases for both rejection and warning acceptance.

## Offline replay

With the pinned Node/browser dependencies already installed, run:

```sh
node host/revalidate.mjs /absolute/path/to/live-report.json /absolute/path/to/new-output
```

The command replays up to 24 previously generated candidates in the same isolated
browser, records source/input hashes and compares old/new decisions. It never
calls a model or Wren, renews an expired grant, changes old verdicts, or publishes
an artifact. Results are retrospective QA, not a new live workflow success rate.
The original generation latency and costs remain historical observations.

Validation: `node --test host/test/validation.test.mjs host/browser.test.mjs`.
The isolated browser tests retain their strict-quality assertions. The host tests
cover warning-only delivery without repair, incorrect values repaired once,
rejected candidate preview, changed-data errors, network isolation and binding.
