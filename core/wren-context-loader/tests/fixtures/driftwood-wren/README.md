# driftwood-wren — a deliberately messy semantic-layer project

Driftwood Outfitters is a synthetic outdoor-gear e-commerce company built as an eval
substrate: a schema where cheap and strong LLMs genuinely disagree, and where the semantic
layer (MDL + knowledge) measurably closes the gap. Where `jaffle-wren` is the clean
minimal example, driftwood is the adversarial one.

**Narrative:** launched on a self-built legacy platform in 2019, migrated platforms during
2023 (dual-write window — migrated orders exist in BOTH systems), launched a subscription
product in 2024, sells in the US and Europe (multi-currency), and runs a February-start
fiscal year. Every dirty detail is a consequence of that history, not injected noise.

## The 15 traps

Each trap maps 1:1 to a golden tag (`eval/golden/driftwood/cases.yaml`) and to a canonical
rule in `knowledge/rules/` — that pairing is the point (see "eval design" below).
`TRAPS.md` documents each with a validation SQL + the expected value.

| # | tag | trap |
| --- | --- | --- |
| T1 | cross-system-union | historical metrics span legacy + new platform |
| T2 | dedup-migration | migrated orders exist in both systems |
| T3 | unit-cents | `legacy_orders.amt_c` is integer cents |
| T4 | same-name-diff-meaning | `payments.amount` (net) vs `orders.order_total` (gross) |
| T5 | refund-double-count | refunds exist as a `refunds` row AND a negative payment |
| T6 | test-and-deleted | `is_test` / `deleted_at` inflate naive counts |
| T7 | enum-drift | multiple spellings per canonical channel/status value |
| T8 | semi-additive | MRR / inventory snapshots must not be summed across time |
| T9 | fiscal-calendar | fiscal year starts Feb 1 |
| T10 | timezone | legacy timestamps are naive America/Los_Angeles local time |
| T11 | currency | multi-currency sums need FX; `fx_rates` is weekdays-only |
| T12 | sentinel-null | legacy `ship_dt` uses a `1970-01-01` sentinel |
| T13 | identity-dedup | same humans in both systems; xref covers only ~87% |
| T14 | grain-mismatch | header total ≠ Σ line items on ~8% of orders |
| T15 | returns-vs-refunds | merchandise returns ≠ monetary refunds |

## Generating the data

The DuckDB is **not** committed (22 MB); the generator is, and it is deterministic:

```sh
cd examples/driftwood-wren
uv run generate.py          # ~4 min → driftwood.duckdb (18 tables, ~693k rows, seed 42)
```

Same seed → identical query results across runs (stdlib `random.Random(42)` only — no
faker, no `datetime.now()`; "today" is pinned to 2026-06-30). File bytes may differ;
golden truths depend on query results, which do not.

### Pinned eval fixture

The expensive live eval does not regenerate those ~693k rows. A synthetic clean base is published
as the dedicated GitHub Release asset pinned by `fixture.lock.json`; `fixture.py` verifies its exact
size and SHA-256 and stores it under a content-addressed local cache:

```sh
just driftwood-fixture
# or choose an isolated cache/output explicitly
python3 fixture.py fetch --cache-dir /tmp/warble-fixtures --output /tmp/driftwood.duckdb
```

A cache hit performs no network request. A missing release asset, bad lock, wrong size, or checksum
mismatch fails loudly — it never falls back to generation. The base fixture is synthetic and
derived; `generate.py`, `BASE_FIXTURE_VERSION`, and the committed lock remain the authority.

Refreshing is deliberately explicit:

1. Change base-generation semantics and bump `BASE_FIXTURE_VERSION` (injection-only/tooling changes
   do not require a refresh).
2. Generate the clean database locally with `uv run generate.py`; verify table count, total rows,
   and the maximum `subscription_snapshots.snapshot_date`.
3. Publish it under a new `eval-fixtures-vN` GitHub Release/tag and asset name.
4. Update every identity/checksum/expectation field in `fixture.lock.json` in the same PR, then run
   `uv run test_fixture.py` and the fixture-backed injection smoke below.

Do not replace an existing release asset in place: immutable tag + asset + checksum identity makes
old commits reproducible and prevents a cache from silently changing underneath them.

To query it through the `wren` CLI, register a duckdb profile whose `url` is this
directory (the project binds `profile: driftwood` in `wren_project.yml`), then
`wren context build`.

## Fault injection

`generate.py` can also inject a deterministic anomaly into a *second* copy of the same
seed-42 dataset, for building/testing `monitor_freshness`-style detectors:

```sh
uv run generate.py --inject stopped_updates          # → driftwood-stopped_updates.duckdb + .manifest.yaml
uv run generate.py --inject sudden_drop --out /tmp/x.duckdb
uv run generate.py --verify                          # self-check suite; writes nothing
```

To reuse the pinned/generated clean base rather than regenerate it:

```sh
base=$(python3 fixture.py fetch)
uv run generate.py --inject stopped_updates --base "$base" --out /tmp/injected.duckdb
```

`--base` copies the database and reads/rewrites only the tables touched by the selected scenario;
the source fixture is never modified. For `stopped_updates`, that means only
`subscription_snapshots`, so preparation takes seconds instead of rebuilding the full dataset.

- `--inject <scenario>` generates the clean `driftwood.duckdb` as usual (or accepts an existing
  clean database through `--base`), then applies one of the four scenarios below and writes it to
  `driftwood-<scenario>.duckdb` (override with `--out`), alongside a
  `driftwood-<scenario>.manifest.yaml` (or `<out>` with a `.manifest.yaml` suffix)
  describing exactly what was mutated.
- `--verify` runs the self-check suite (reproducibility, manifest shape, oracle sanity)
  and exits nonzero on failure.
- Scenario logic never touches the shared `random.Random(42)` sequence: mutations use
  fixed literals, so `--inject` is reproducible by construction, and the clean db's rows
  are byte-for-byte the same whether or not `--inject` is also passed.

Both the clean and the injected db are built from the *same* seeded run — the clean db is
the false-alarm baseline (a competent detector must **not** flag anything in it); the
injected db is the true-positive target. Scoring only the injected db can't measure false
alarms — you need the pair.

### The four scenarios

| scenario | table.column | mechanism |
| --- | --- | --- |
| `stopped_updates` | `subscription_snapshots.snapshot_date` | drop every month-end snapshot after 2026-03-31 — the feed silently stopped |
| `sudden_drop` | `orders.order_total` | multiply the header total by 0.3 for every order placed in 2026-03 — a level shift, not gradual |
| `drift` | `fx_rates.usd_rate` (EUR) | compound the rate upward ~0.15%/day over 2026-01-01..2026-06-30 — a stale/broken FX feed |
| `duplicates` | `orders` + `order_items` + `payments` | re-insert orders 1000-1004 (and their items/payments) verbatim under new ids — a retried batch job |

Only `stopped_updates` produces a genuine freshness verdict (`expected_fresh` /
`expected_severity`), computed with the exact heuristic `monitor_freshness` uses
(`hub/components/monitor_freshness/steps/assess_severity.md`): `fresh = lag_hours <=
cadence_hours`; otherwise `warn` if `lag_hours <= 2 * cadence_hours` else `critical`
(assumed cadence: 730h, a month-end snapshot table). The other three scenarios are
magnitude anomalies, not freshness ones — their `expected_severity` is a self-authored,
documented-in-`generate.py` heuristic (or `null` for `duplicates`, a content anomaly with
no natural magnitude axis).

### Manifest schema

`seed, base, injected, reference_now, dataset, scenario, injections[]`, where each
injection has `id, kind, entity, location{table,column,row_id_range,timestamp_cutoff,
date_window}, magnitude{...}, expected_verdict, expected_fresh, expected_severity,
expected_cause, attribution_keywords[]`, plus extra fields for scorer-checkability
(`affected_row_ids`, `new_row_ids`, `pre_mutation_summary`, `post_mutation_summary`). A scenario's `injections`
list usually has one entry, but can have more — `duplicates` emits three (one per touched
table), since it genuinely spans more than one entity.

### The oracle

`score_detections(manifest, detections)` scores a hand-authored *detection set* — a list
of `{entity, verdict, cause}` dicts covering both the injected entities and some clean ones
— against a manifest, producing four metrics:

- **recall** — fraction of real injections the detector flagged. Counted **per injection**,
  not per scenario: `duplicates` emits three injections (`orders`, `order_items`,
  `payments`) for what is conceptually one event, so a detector that flags only `orders`
  scores 1/3 recall, not 1/1 — intentional, it rewards flagging every affected entity.
- **precision** — fraction of the detector's `anomaly` claims that were real. Counted **per
  detection** (unaffected by how many injections one scenario emits).
- **false_alarm_rate** — the headline metric: fraction of *clean* entities the detector
  wrongly flagged, also per detection. This is why the clean/injected pair matters — false
  alarms aren't measurable from the injected db alone.
- **attribution_accuracy** — of the true positives, the fraction whose stated `cause`
  keyword-overlaps (≥50%) the short canonical `attribution_keywords` set serialized on each
  injection (the phenomenon verb + the table/column name), not
  the full `expected_cause` sentence (which embeds ids/dates a paraphrasing detector won't
  quote). A detector's own words only need to name the same table/column/phenomenon — it
  never has to reproduce the manifest text. `--verify` checks all four scenarios: each
  injection's own `expected_cause` self-matches at 1.0, a realistic hand-written paraphrase
  scores ≥ 0.5, and an unrelated cause scores < 0.5.

`score_detections` assumes at most one detection per entity in `detections` (raises
`ValueError` otherwise) — with two detections for the same entity, precision and
false_alarm_rate could otherwise exceed 1.0.

`--verify` demonstrates this on hand-authored perfect (recall = precision = 1.0,
false_alarm_rate = 0.0) and imperfect (misses one injection, false-alarms on one clean
entity) detection sets for `stopped_updates`, asserting the hand-computed expected numbers.

## Eval design: MDL vs knowledge is the experiment axis

- **MDL column descriptions carry only *local* facts** — units (cents), timezones,
  sentinels, net-vs-gross, snapshot grain. Regenerate with `uv run scaffold_models.py`
  (descriptions are embedded there and cross-checked against `schema_dump.csv`).
- **Global business rules live only in `knowledge/rules/`** — canonical revenue formula,
  cross-system dedup, test-account exclusion, UTC reporting timezone, fiscal calendar,
  units-sold definition.

The `schema-only` control injects the compiled schema without `knowledge/rules/`; the
`schema+knowledge` treatment also injects those rules from this Wren project. The suite now
contains 53 goldens; the historical 43-case measurement was run with `warble eval run`
(`answer_query` via headless Claude Code):

| accuracy (cost) | schema-only | schema+knowledge |
| --- | --- | --- |
| **haiku (cheap)** | 0.23 ($1.60) | **0.60** ($2.38) |
| **sonnet (strong)** | 0.44 ($8.36) | **0.93** ($7.10) |

A cheap model with knowledge beats a strong model without it — and unlike on jaffle
(where every tier scores 100%), the tier gap here is real, so the eval loop produces a
non-trivial tier decision.

**Golden discipline learned the hard way:** golden truths must apply the project's own
knowledge rules (the v1 goldens didn't; the stronger model followed the rules and was
marked wrong). Any new golden's truth SQL must honor every canonical rule, and top-N
goldens must be checked for rank ties.

## Project shape (wren CLI v5)

This project is authored in the current wren CLI project shape — keyed `relationships:`
mapping and per-cube `cubes/<name>/metadata.yml` (with a root `cubes.yml` mirror) — so it
also serves as the in-repo integration fixture for that adapter path (`jaffle-wren`
covers the older bare-list shape).
