---
name: enrich-context
description: "Augment a Wren project with business context that DB schema cannot carry — enum value meanings, units (USD vs cents, ms vs sec), NULL semantics, magic sentinels (-1 = unknown), soft-delete default filters, business synonyms, time-grain / TZ conventions, cross-system identifiers, currency rules, canonical-table preferences, AND named aggregation metrics (ARR, churn, DAU, WAU, NRR) proposed as cubes. Runs in one of two modes selected at session start: `grill` (one question at a time, user-driven) or `auto-pilot` (agent infers and applies, escalates only on conflicts and high-blast-radius additions like new cubes / views / relationships). Reads everything under <project>/raw/ (PDFs, glossaries, handbooks, code, data dictionaries) and optionally samples low-cardinality columns from the live DB (grill mode), compares against the current MDL / cubes / knowledge (rules + NL→SQL pairs), then fills gaps via the ten-category gap catalog and the cube proposal flow. Confirmed findings are written back to the right sink. Use when: user says 'enrich context', 'augment my project', 'grill me on this project', 'auto-fill my context', 'agent doesn't understand our docs / enum values / units / null meanings', 'business context is missing', 'what does status=A mean', 'is this amount in USD or cents', 'we keep getting wrong aggregations', 'add cubes for ARR / DAU / churn', 'we have a handbook / glossary / data dictionary the agent should know'; or after generating an MDL and noticing the agent lacks business semantics."
license: Apache-2.0
metadata:
  author: wren-engine
---

# Wren Enrich Context — Fill the Business-Context Gap

This skill exists because most business context never lives in a DB schema — it lives in handbooks, glossaries, finance reports, support playbooks, code comments, Slack rules-of-thumb. The agent reads those raw artifacts, finds what's missing from the Wren project, and **either grills the user one question at a time (grill mode) or applies its best inferences directly and hands over an audit (auto-pilot mode)** before writing back. The output lands in the sinks each project already has — MDL, `cubes/`, `knowledge/rules/`, and `knowledge/sql/` — no new artifact, no new tooling.

## Hard rules — READ FIRST

### Universal (apply to both modes)

1. **Only add, never modify existing.** If you find an existing MDL description / relationship / rule that looks wrong, **do not edit it**. Surface it on the "please fix manually" list shown in Step 9.
2. **Every MDL edit must validate.** Right after any MDL YAML change, run `wren context validate`. If it fails, **revert that single change** and feed the error back. Never leave a project in an invalid state.
3. **Pre-draft every proposal.** Whether you're showing the draft to the user (grill) or applying it directly (auto-pilot), generate the concrete content — never lazy-ask "what should the description say?".
4. **Be explicit about confidence.** In grill mode, open Lane 3 inference questions with "I'm guessing — ". In auto-pilot, tag every Lane 3 inference and partial Lane 2 match in the Step 9 audit with confidence (high / med / low) and source.

### Grill mode only

5. **One question at a time. Grill relentlessly.** Walk every gap top-down, resolve one decision before moving to the next. Provide a recommended answer for every question.
6. **Skip is final for this session.** No pending queue, no nagging next round. If the user wants to revisit, they re-run the skill.

### Auto-pilot mode only

7. **Drop into grill for three cases.** Always interrupt auto-pilot and ask the user when:
   - (a) **Lane 2 conflict** — raw and current MDL disagree.
   - (b) **High-blast-radius proposal (any lane)** — new cube, new view, new relationship, or new MDL metric/calculated column. These become public artifacts visible to every future agent session, so blast radius doesn't depend on whether the trigger was raw evidence (Lane 2) or inference (Lane 3).
   - (c) **Lane 2 routing ambiguity** — you can't confidently pick a sink (MDL / `knowledge/rules/` / `knowledge/sql/` / `cubes/`).

   Everything else: apply directly and log to the audit list.

## Step 0 — Mode selection (before anything else)

Before touching the project or reading any file, ask the user which mode to run in. Lock the choice for the whole session — **no mid-session switching**; the user re-runs to change.

> Two modes for this session:
>
> **a) Grill mode** — I walk every gap with you, one question at a time, proposing a draft and waiting for your accept / edit / skip. You stay in the driver's seat. Best when the raw material is sensitive, when you want to learn what I don't know about your project, or when you'd rather review than re-do.
>
> **b) Auto-pilot mode** — I read raw + current context, make my best inferences, and apply them. I'll only stop to grill you on (1) conflicts between raw and existing MDL and (2) high-blast-radius additions like new metrics, views, or relationships. The session ends with a full diff + confidence-tagged inference list for you to audit.
>
> Which? (a / b)

Remember the choice as `MODE = grill | autopilot` and use it to branch Steps 6 and 9.

## Preflight

### Step 1 — Choose the Wren project

**Always ask the user which project to enrich before doing anything else** — never assume cwd. A user can have several Wren projects and an ambient `~/.wren` profile that doesn't match the one they want to augment.

Offer concrete hints in the question so the user can answer in one round-trip:

```bash
# Hint 1 — does cwd look like a project?
test -f wren_project.yml && pwd

# Hint 2 — does ~/.wren/config.yml point at a default project?
grep -E '^project_path:' ~/.wren/config.yml 2>/dev/null
```

Then ask:

> Which Wren project do you want me to augment?
> a) `$PWD` (current directory)         ← if Hint 1 matched
> b) `<path from ~/.wren/config.yml>`   ← if Hint 2 matched
> c) something else — paste the absolute path

After the user answers, lock the path in for the whole session:

```bash
cd <chosen-path>
test -f wren_project.yml || {
  echo "Error: <chosen-path> is not a Wren project (no wren_project.yml)."
  exit 1
}
wren context show >/dev/null 2>&1 || {
  echo "Error: wren context show failed — manifest may be invalid."
  exit 1
}
```

If either check fails, stop and tell the user — suggest `wren skills get onboarding` if it's not a project, or `wren context validate` if the manifest is broken.

From this point on, **every command and file path in this skill is relative to the chosen project root**. Do not switch projects mid-session — if the user wants to work a different project, end this session and re-run.

### Step 2 — Detect semantic-memory availability

```bash
wren memory fetch -q probe >/dev/null 2>&1
```

Writing NL→SQL pairs (`wren memory store` → `knowledge/sql/*.md`) works **regardless** — that
sink is always open. This probe only tells you whether the optional `memory` extra is
installed, which gates the *embedding* features used while reading:

- Exit 0 → set `MEMORY_AVAILABLE = true`. Semantic recall and `wren memory fetch` are usable, and `wren memory index` will build an embedding index in Step 8.
- Exit non-zero → set `MEMORY_AVAILABLE = false`. Skip the semantic read/index paths below; pair writeback still happens via `wren memory store`.

### Step 3 — Ensure raw/ folder exists

From the project root (cwd is already there from Step 1):

```bash
mkdir -p raw
```

If you just created it (the directory was empty or new):

> I've created `raw/` at the project root. Drop anything you think helps explain this project's business context — PDFs, glossaries, handbooks, financial reports, data dictionaries, sample queries, code with comments, screenshots of dashboards, anything.
>
> **Heads-up:** the contents may be sensitive. Decide for yourself whether to commit `raw/` to git — I won't touch `.gitignore`.
>
> Tell me when you've added the files and I'll start reading.

Wait for the user to confirm before continuing.

## Step 4 — Read everything

Read both sides — the raw material and the current Wren context — before forming any opinion.

### Raw

Read every file under `raw/`. Use whatever capability your agent has natively (text, markdown, code, PDF). If you genuinely can't read a particular file, **tell the user once** which file and suggest converting it to text or pasting the relevant excerpt — then move on to the rest. Do **not** install extra Python packages, **do not** reach for new CLI subcommands.

### Current Wren context

| Source | Command |
|---|---|
| MDL (full) | `wren context show --output json` |
| Business rules | `wren context instructions` (reads `knowledge/rules/` + any legacy `instructions.md`) |
| Existing cubes (names) | `wren cube list` |
| Existing cubes (measures + dimensions) | `wren cube describe <cube>` for each name above |
| NL→SQL pairs | read `knowledge/sql/*.md` directly |
| (Memory) stored pairs | `wren memory list -n 200 --output json` |
| (Memory) schema as text | `wren memory describe` |

The memory rows only matter when `MEMORY_AVAILABLE = true`. Reading cubes is essential before any Lane 3 metric proposal — see `cube_proposals` for the duplication guard.

## Step 4.5 — Ground-truth probe (grill mode default; auto-pilot opt-out)

When raw is silent on a column's enum / unit / null / magic / time semantics, the catalog's column-local categories (#1, #2, #3, #5, #7 in `gap_catalog`) can often be settled directly by sampling distinct values from the live DB. Read `gap_catalog` before this step — its *Trigger* column tells you which columns are probe candidates.

**Default policy by mode:**

| Mode | Default | How to override |
|---|---|---|
| **Grill** | Probe on. Before the first query, ask the user once: "I want to sample N columns with `LIMIT 30` each to find enum / sentinel / time-grain values — OK?" Lock the answer for the session. | User says no → skip Step 4.5 entirely; rely on Lane 2 + Lane 3 instead. |
| **Auto-pilot** | Probe off. The skill never queries the live DB in auto-pilot mode. | None — user must re-run in grill mode if probe would unblock high-confidence inferences. |

**Candidate selection (no DB call yet):**

A column is a probe candidate when *all* hold:

- Description is empty OR does not yet contain the relevant `[tag]` (catalog write format).
- Column type / name pattern matches catalog #1 (enum), #3 (NULL), #5 (magic), or #7 (time grain).
- For #3 and #7, the description also lacks event-vs-record or TZ wording.

Categories #2 (unit), #4, #6, #8, #9, #10 are **not** probable — `SELECT DISTINCT` doesn't reveal units, default filters, synonyms, external mappings, currency conventions, or canonical-table preferences. Those need raw evidence or human judgment.

**Probe query:**

```bash
wren --sql "SELECT DISTINCT <col> FROM <model> LIMIT 30" --output json
# For magic sentinels (catalog #5), also fetch min/max:
wren --sql "SELECT MIN(<col>) AS lo, MAX(<col>) AS hi FROM <model>" --output json
```

- **≤ 30 distinct values returned** → enum / sentinel / grain candidate. Draft the `[tag]` line and surface to user (grill) with confidence "med — probed values, semantics still inferred".
- **30 returned (LIMIT hit)** → cardinality too high; not an enum / sentinel candidate. Skip.
- **Query fails** (permissions, connection, large-table timeout) → do not retry. Log the failure to the audit list, surface in Step 9, continue with Lane 2 + Lane 3 only.

**Safety:**

- Probe each (model, column) at most once per session.
- Never probe a column that already has a matching `[tag]` line — Universal Rule 1.
- Probe results stay in working memory; do not write them to disk.

## Step 5 — Three gap-detection lanes (in your head, no artifact)

Hold all three lanes in working memory. Do not write a `gaps.yml`.

Before sweeping, load `gap_catalog` — the ten business-semantic categories the schema cannot carry. Each lane consumes the catalog differently: Lane 1 walks it as type-aware mechanical triggers, Lane 2 classifies each atomic raw claim into one of the 10 categories before routing, Lane 3 seeds inference prompts when a trigger fires but raw is silent.

### Lane 1 — Structural coverage (mechanical)

Scan the current MDL and check:

- Every model has a non-empty `properties.description`?
- Every column has a description (at least for non-PK, non-FK ones)?
- Every model has a `primary_key`?
- Every model has at least one relationship (orphan models are suspicious)?
- `knowledge/rules/` has real content beyond the scaffold default?
- `knowledge/sql/` has at least a few canonical NL→SQL pairs?

Plus, walk every column / model against `gap_catalog` triggers:

- For each column matching catalog #1 / #2 / #3 / #5 / #7 triggers → is the corresponding `[tag]` line present in `properties.description`?
- For each model with a soft-delete column (`deleted_at`, `is_active`, `archived_at`, etc.) → is there a `## Default filters` rule in `knowledge/rules/` covering it (catalog #4)?
- For each lookalike table pair (e.g. `users` / `users_v3`) → is there a `## Canonical tables` rule (catalog #10)?
- For each `*_currency` / `fx_rate` / external-system ID column → is the matching `## Currency` (#9) or `## External identifiers` (#8) section present?
- Business terms in `knowledge/rules/` or raw that don't map verbatim to model / column names → catalog #6 `## Naming conventions` rule missing.

Each unsatisfied check is a candidate. Combine with Step 4.5 probe results (if available) before moving to Lane 2.

### Lane 2 — Claim-diff (raw vs current context)

For each raw file, internally extract 5–15 **atomic claims** — single statements that could be true or false, e.g. "an order has exactly one customer", "user means type=default by default", "ARR equals MRR × 12 minus refunds". Then for each claim, classify against the current Wren context:

| Class | Meaning | Resolution outcome |
|---|---|---|
| **covered** | already reflected in MDL / instructions / pairs | skip |
| **partial** | the topic exists but the wording / scope differs | propose tightening |
| **new** | nothing in current context matches | route to a sink |
| **conflict** | raw says A, current context says B | grill the user (both modes), **but do not edit existing** — surface for manual fix |

### Lane 3 — Inference (your own guesses)

After reading raw and the current MDL, propose additions the user did **not** literally state in raw but that would clearly help the agent later. Examples:

- "I see `quarterly_churn` referenced five times in `finance.pdf`. No existing cube covers it. Want me to add `cubes/quarterly_churn/metadata.yml` with measure = `COUNT(*) FILTER (WHERE churned_at IS NOT NULL) / NULLIF(COUNT(*), 0)`?" — see `cube_proposals` for the YAML template and duplication guard.
- "Your support handbook keeps mentioning `core users` without defining it. Is this `users WHERE tier = 'premium'`? Want me to make a view?"
- "The data dictionary says `events.payload` is JSON but the column has no description — let me draft one."

For any aggregation-shaped proposal (`SUM`, `COUNT`, `AVG`, "by month / by status / per customer" patterns), **default to a cube**. Run `wren cube list` + `wren cube describe` first to confirm no existing cube already covers the measure expression; if one does, skip the proposal and add a `knowledge/sql/` example pointing at the existing cube instead. The full decision tree, naming rules, and validation flow live in `cube_proposals`.

**In grill mode, open every Lane 3 question with "I'm guessing — ".** In auto-pilot, tag the audit entry with `agent inference` so the user sees you extrapolated.

## Step 6 — Resolve gaps

Branch on the `MODE` locked in Step 0.

### Grill mode

Use this conversational pattern for every gap surfaced in Lanes 1–3:

> Interview the user relentlessly about every gap until we reach a shared understanding. Walk down each branch of the decision tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.
>
> Ask the questions one at a time.
>
> If a question can be answered by exploring the codebase or the raw files, do that instead of asking.

For every grill turn:

1. State the gap and where it came from (Lane 1 / 2 / 3, and for Lane 2 quote the raw file + a short excerpt).
2. Propose the concrete answer — draft the description, the rule, the SQL pair, the relationship.
3. **Propose the sink** ("I'll add this to `knowledge/rules/` as a rule" / "I'll add this to the `users` model description in MDL").
4. Let the user accept / edit / skip.
5. On accept: write back (Step 7).
6. On edit: apply their wording, then write back.
7. On skip: drop it, move to the next gap. Do not requeue.

When the user gives a curve-ball answer ("actually we don't track that") — pivot. The goal is shared understanding, not pushing a pre-built list.

### Auto-pilot mode

Process every finding from Lanes 1–3 directly — **except** for the three escalation cases from Universal Rule 7:

- **Lane 2 conflict** — drop into grill for this single question, never auto-resolve.
- **Lane 3 proposing a new metric / view / relationship** — drop into grill before applying.
- **Lane 2 routing ambiguous** — drop into grill for the sink choice only, then auto-apply.

For everything else (Lane 1 mechanical fixes, Lane 2 unambiguous new claims, Lane 3 low-impact description tweaks):

1. Synthesize the concrete proposal (description / rule / SQL pair) using your best inference.
2. Decide the sink using the routing table (Step 7).
3. Write back.
4. Run `wren context validate` immediately after any MDL edit. On failure: revert the single change and log the revert with the error.
5. Append to the audit list: the finding, the sink, confidence tag (high / med / low), and source (raw file + excerpt for Lane 2, `agent inference` for Lane 3, `structural` for Lane 1).

Auto-pilot does not pause for confirmation on each item — the user reviews the full diff + audit list in Step 9. They are the reviewer, not the gatekeeper.

## Step 7 — Routing & writeback

Decide the sink as part of the proposal (Step 6.3 in grill mode; Step 6.2 in auto-pilot), so the user can correct routing in grill mode and audit it in auto-pilot.

| Finding type | Sink | How to write |
|---|---|---|
| Schema structure / relationship / view / model or column description | **MDL YAML** under `models/`, `views/`, `relationships.yml` | Edit the YAML file directly. For catalog #1 / #2 / #3 / #5 / #7 / PII, append a `[tag]` line to `properties.description` (prose first, then one tag per category). See `gap_catalog` for the exact tag format and triggers. |
| Aggregation metric / named measure (with measures + dimensions) | **`cubes/<name>/metadata.yml`** | New file per cube. Default sink for any `SUM` / `COUNT` / `AVG` / ratio metric raw defines or Lane 3 infers. See `cube_proposals` for the YAML template, naming policy, duplication guard, and validation flow. Run `wren context validate` + `wren cube query --cube <name> --sql-only` after writing; revert on either failure. **Always escalates to grill in auto-pilot** (Universal Rule 7b). |
| Default filter / implicit rule / business convention / naming convention / external mapping / currency / canonical table | **`knowledge/rules/`** | Append under the catalog-specified `##` section heading (#4 → `## Default filters`, #6 → `## Naming conventions`, #8 → `## External identifiers`, #9 → `## Currency`, #10 → `## Canonical tables`) inside a topic file under `knowledge/rules/` (e.g. `knowledge/rules/conventions.md`). Create the file/heading if absent; never modify existing text. |
| NL→SQL example (canonical or ad-hoc) | **`knowledge/sql/`** | `wren memory store --nl "..." --sql "..." --tags "source:enrich"` — writes `knowledge/sql/<slug>.md` (committable) and indexes it when the extra is present. Works whether or not `MEMORY_AVAILABLE`. |

Catalog-driven routing means every column-local proposal goes to the column's `properties.description` with a `[tag]` line; every cross-model rule goes to `knowledge/rules/` under a fixed heading. This keeps re-enrichment deterministic (greppable) and avoids inventing new sink locations.

### After every MDL edit

```bash
wren context validate
```

If it fails:
1. Revert the single change you just made.
2. Show the user the validation error (grill mode) or log it in the audit (auto-pilot).
3. In grill mode, re-grill on that specific gap with the error as new context.
4. In auto-pilot, mark the finding as "revert: validation failed" and move on.

### Format reminders

- NL→SQL pairs are written by `wren memory store`; each becomes a `knowledge/sql/<slug>.md` with YAML frontmatter (`nl`, `sql`, `source`, optional `datasource`/`tags`). Don't hand-write the files — use `wren memory store --tags "source:enrich"`.
- MDL YAML uses snake_case keys (e.g. `primary_key`, `is_calculated`, `not_null`). `wren context build` converts to camelCase for `target/mdl.json`.
- `knowledge/rules/` holds free-form markdown, one file per topic. Group rules by topic with `##` headings.

## Step 8 — Session finalize

After Step 6 ends (user says stop in grill mode, or every finding is processed in auto-pilot):

```bash
wren context build
```

This recompiles `target/mdl.json` from the YAML edits.

If `MEMORY_AVAILABLE = true`:

```bash
wren memory index
```

This re-embeds the new schema items, the updated `knowledge/rules/`, and the new `knowledge/sql/` pairs.

## Step 9 — Summary

### Both modes — common section

Print a tight session report:

```text
Wren Enrich Context — session summary  (mode: <grill|autopilot>)

Added:
  MDL              : N model descriptions, N column descriptions, N relationships, N views
                     by tag: [enum]=N [unit]=N [null]=N [magic]=N [time]=N [pii]=N
  cubes            : N new (names: <list>)                                    via cubes/<name>/metadata.yml
  knowledge/rules/ : N new rules across sections
                     by section: Default filters=N | Naming conventions=N | External identifiers=N | Currency=N | Canonical tables=N
  knowledge/sql/   : N new NL→SQL pairs                                       via wren memory store
  Probe            : N columns sampled, M failed                             (grill mode only)

Please fix manually (we don't edit existing fields):
  - models/orders/metadata.yml: existing description seems to contradict raw/glossary.pdf p.3
  - relationships.yml: existing orders↔customers is MANY_TO_ONE but raw/data_dict.md p.7 says MANY_TO_MANY
  - …
```

### Grill mode extras

Append:

```text
Skipped this session: N gaps (re-run /wren-enrich-context to revisit)
```

### Auto-pilot mode extras

Append a detailed audit so the user can sanity-check inferences:

```text
Inferred items (please review):
  high   | MDL model:orders.description            | from raw/glossary.pdf p.2 — "Order = ..."
  high   | knowledge/rules/ rule                   | from raw/handbook.md §4 — "default tier ..."
  med    | MDL column:users.signup_source.desc     | agent inference from raw/onboarding.md
  low    | knowledge/sql/: "weekly active customers" | agent inference, no direct raw evidence

Validation:
  K successful applies, M reverted after wren context validate failed:
    - relationships.yml: <error> → reverted

Escalated to grill (raw vs MDL conflicts / high-impact additions):
  - <count> items — see grill transcript above
```

The user should be encouraged to skim the audit and either accept it as-is, manually tweak low-confidence rows, or re-run in grill mode if they want to revisit interactively.

## Things to avoid

- Do not write a `gaps.yml`, `state.yml`, or any other tracking artifact. The session lives entirely in conversation.
- Do not modify any existing MDL field, `knowledge/rules/` rule, or `knowledge/sql/` pair — only append / add. Surface mismatches on the manual-fix list.
- Do not install new Python packages (`pypdf`, `docling`, …) to read raw. Use what your agent already has; ask the user to convert files you can't open.
- Do not auto-resolve a conflict between raw and current MDL — always grill the user, in **both** modes.
- Do not present Lane 3 inferences as if they were quoted from raw. Open with "I'm guessing — " (grill) or tag `agent inference` (auto-pilot).
- `wren memory store` works whether or not `MEMORY_AVAILABLE` — it always writes the `knowledge/sql/*.md` pair (and indexes it only when the extra is present). No need to fall back to another sink.
- Do not commit anything to git. The user owns the commit decision.
- Do not nag about skipped questions. Skip is skip for this session (grill mode only — auto-pilot has no skip concept).
- Do not run `wren context build` after every single MDL edit — once at the end is enough. Do run `wren context validate` after every edit.
- Do not assume `raw/` was created by `wren context init` — it isn't. This skill creates it.
- Do not switch modes mid-session. The user re-runs to change mode.
- Do not append a `[tag]` line if the same category tag already exists for that column — Universal Rule 1. Surface contradictions on the manual-fix list instead.
- Do not invent new `knowledge/rules/` section headings. Stick to the five catalog-defined headings (`## Default filters`, `## Naming conventions`, `## External identifiers`, `## Currency`, `## Canonical tables`). Anything that doesn't fit goes on the manual-fix list.
- Do not probe the live DB in auto-pilot mode. Step 4.5 is grill-only by default.
- Do not propose a cube whose measure expression already exists in another cube on the same `base_object` — write a `knowledge/sql/` example pointing at the existing cube instead. See `cube_proposals` duplication guard.
- Do not modify an existing cube YAML even when raw contradicts it — Universal Rule 1. Surface on the manual-fix list.
- Do not write a new cube alongside an old MDL `metrics:` entry that already covers the same logic. Surface as "consider migrating to cube" on the manual-fix list.
- Do not skip `wren cube query --cube <name> --sql-only` after creating a cube. Structural `wren context validate` doesn't catch unresolvable measure / dimension expressions.
- In auto-pilot, do not auto-apply Lane 2 conflicts or new metric / view / relationship inferences — always drop into grill for those.

## See also

- `gap_catalog` — the ten business-semantic gap categories, with triggers, default sinks, and write formats. Read this before Step 4.5 and Step 5.
- `cube_proposals` — decision tree for when to propose a cube vs view vs calculated column, the cube YAML template, naming policy, duplication guard, and validation flow. Read this before any Lane 3 aggregation-shaped proposal.
