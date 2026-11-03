---
sidebar_label: Refine answer quality
---

# Refine answer quality

Scaffolding gives you a baseline MDL. This recipe is how you close the loop. Bring in the business meaning that lives outside the database, store proven examples, and let the agent compound from every confirmed answer. It is the hands-on side of the [learning loop](/oss/concepts/agent_learning): richer knowledge here means more trustworthy BI downstream.

## What you'll end up with

- Business rules under `knowledge/rules/` capturing canonical tables and team conventions
- Confirmed natural-language-to-SQL pairs under `knowledge/sql/`, committed to your repo
- A memory index over MDL + `knowledge/` so agents retrieve relevant context per question
- An agent that gets better at your business each time someone confirms an answer

## Optional: the `memory` extra

Refinement works out of the box — `wren memory store`, `index`, and `recall` operate over
the markdown in `knowledge/` with no extra dependency (token/substring matching).

Install the `memory` extra only when you want **semantic** (embedding) recall and schema
search (`wren memory fetch`):

```bash
pip install "wrenai[memory]"
# combine with your data source extra as needed:
pip install "wrenai[memory,postgres]"
```

With the extra, recall is embedding-based and LanceDB caches the index; without it, the
same commands fall back to the dependency-free grep backend.

## The flow today

The day-to-day refinement loop runs on the `usage` guide plus a few `wren memory` and
`knowledge/rules/` edits. When you need to go deeper than incremental edits, such as
backfilling enum meanings, units, default filters, synonyms, or named metrics across a
whole project, reach for the [`enrich-context`](#enrich-context) guide described below.

### 1. Capture business rules in `knowledge/rules/`

`knowledge/rules/` is where you write down the rules that are not visible from the schema.
Use one markdown file per topic (e.g. `knowledge/rules/revenue.md`):

```markdown
## Business rules
- Revenue queries must use `net_revenue`, not `gross_revenue`.
- All active-customer queries exclude rows where `is_internal = true`.

## Canonical tables
- Use `customers` for analytics, not `customers_v3` or `loyalty_v3`.

## Formatting
- Currency is USD; display with thousand separators and 2 decimals.
- Timestamps are stored in UTC.
```

Each file (and `##` heading within it) becomes a retrievable chunk in memory. Edit by hand,
or have your agent propose changes when it spots a recurring confusion. (Older projects: a
top-level `instructions.md` is still read, but it's deprecated — move it into
`knowledge/rules/`; see [Migration](/oss/reference/migration).)

#### Declaring default rules a host can enforce

A rule that must hold on every query can also be *declared*. Open the rules file with
a `---` fenced YAML block holding a `defaults:` list; the block stays in the rule text
your agent reads, next to the prose it summarises. A host that serves the project through
`wren governed-stdio` then refuses a query that breaks a declared rule before it runs and
names the rule's `id`, so the agent can repair the query and try again.

```markdown
---
defaults:
  - id: exclude-test-accounts
    kind: exclude_rows
    column: customers.is_test
    exclude: true
    covers: {reaching: customers, via: many_to_one}
    when: aggregated
    unless:
      - addresses_column
      - filtered_by: orders.legacy_ord_id IS NOT NULL
  - id: usd-at-transaction-date
    kind: require_rate_join
    when: aggregated
    amounts:
      - {columns: [payments.amount], currency: payments.currency, dates: [payments.captured_at]}
    rate: {model: fx_rates, currency: fx_rates.currency, date: fx_rates.date, match: on_or_before}
    unless:
      - groups_by_currency
      - filters_currency_literal
---
# Reporting conventions

Exclude internal test accounts from every business metric. Report money in USD at the
rate on the transaction date.
```

A rules file that opens with a `---` line must close the fence with another `---` line:
an unclosed leading `---` is a declaration error, and `governed-stdio` refuses to start.
Rule ids are unique across the project; files are read in sorted order under
`knowledge/rules/` and the legacy `instructions.md` is read last, which fixes the order of
the ids a host sees.

Three kinds exist. Declarations are never inferred from the prose, and an invalid one makes
`wren context validate` fail and `governed-stdio` refuse to start, so a typo cannot
silently turn enforcement off.

- **`exclude_rows`**: statements that read a covered model must exclude the rows where
  `column = exclude`. The covered models are the `reaching` model plus every model that
  reaches it through a chain of `MANY_TO_ONE` relationships in the MDL (`except_models`
  removes a model and what is reachable only through it). The check is satisfied by a
  `WHERE`, `HAVING` or `QUALIFY` filter, or the ON condition of an INNER or comma join,
  that excludes the flag in one of these forms, anywhere in the statement and through
  CTEs, derived tables and subqueries: `NOT c`, `c = FALSE`,
  `c IS FALSE`, `c IS NOT TRUE`, `c IS DISTINCT FROM TRUE`, `c <> TRUE`,
  `COALESCE(c, FALSE) = FALSE`, `c = FALSE OR c IS NULL`, and
  `NOT EXISTS` / `NOT IN` over a subquery that selects `c = TRUE`. `exclude` must be a
  boolean. In the `OR` form the null check may be on any column of the flag's own model,
  so a `LEFT JOIN` that keeps rows without a match can write
  `k.id IS NULL OR k.c = FALSE`; a null check on another model's column, or any other
  extra disjunct, does not qualify. No outer-join ON predicate is accepted as an
  exclusion, because it does not remove rows of the preserved side: put the exclusion in
  `WHERE` or in an INNER or comma join's ON. The check is not scope-aware: an exclusion
  inside a nested inner-join group, a subquery or a CTE that the statement outer-joins is
  accepted although it does not reach the preserved side's rows, so write it in the outer
  `WHERE`.
- **`require_rate_join`**: statements that aggregate a listed amount column must read the
  rate model joined on one of the declared currency columns and bounded
  `rate.date <= <expression over a declared transaction-date column>` (an inner
  `MAX(date)`, `ORDER BY date DESC LIMIT 1`, `LATERAL`, `ASOF JOIN` and
  `rate.date BETWEEN ... AND <upper bound>` all qualify; only the upper bound is checked,
  and a cast of the rate date to a date or timestamp type, such as `rate.date::date` or
  `CAST(rate.date AS DATE)`, is looked through).
  Same-day equality and an unbounded latest rate do not.
- **`sale_statuses`**: statements that read the status column's model must keep exactly the
  declared set of status values (`values`) out of the column's whole value set (`domain`,
  or else the `enum_values` the column lists). The check computes which values the
  statement's filters still return (`=`, `<>`, `IN`, `NOT IN`, `IS [NOT] NULL`, with
  `AND` / `OR` / `NOT` and `LOWER`, `UPPER` or `TRIM` around the column; case is ignored)
  rather than looking for a filter, so `NOT IN ('cancelled')` keeps every other value in
  the domain. `overridable_by_caller: true` lets a host that supports it take a confirmed
  set from the user instead. Each read of the model is judged on its own: a nullable-side
  ON predicate of an outer join restricts that read (`customers c LEFT JOIN orders o ON
  c.id = o.customer_id AND o.status IN ('paid', 'shipped')` with `SUM(o.amount)` is
  satisfied), while a preserved-side, FULL, SEMI/ANTI or unnamed join-group ON predicate
  never counts. A confirmed set cannot clear a statement that keeps NULL statuses
  (`... OR status IS NULL` is always a superset); the statement has to be rewritten.

A `semantics:` list in the same front-matter (`{id, models, note}`) names meanings no check
reads, such as a fiscal calendar; a host reports the id as unverified whenever a query touches
one of its models.

Optional fields: `when: aggregated` limits a rule to statements that use an aggregate
function or `GROUP BY`, so exploration queries are not refused. `unless` lists SQL facts
that exempt a statement; the question is never consulted. `exclude_rows` accepts
`addresses_column` (the statement selects the flag positively in a filter, groups by it
or uses it inside an aggregate) and `filtered_by: <model.column predicate>` (the
statement carries that predicate); `require_rate_join` accepts `groups_by_currency` and
`filters_currency_literal`. Ids match `^[a-z0-9][a-z0-9_-]{0,63}$`, are unique across
the project, and at most 8 rules may be declared.

What the check does not verify: that the rate is actually multiplied into the amount,
that the rate join yields one row per transaction, or which of several declared date
columns is the right one; that a filter in an unrelated branch of the statement applies
to the aggregated rows; and any flag written in a form outside the list above (it is
treated as missing). A statement that cannot be parsed against the model schema gets no
verdict: the engine runs it and reports its own error. `wren serve agent`, the governed
MCP server (`wren serve mcp --service-config`) and `governed-stdio` enforce declarations;
`wren query` does not. A project without declarations behaves exactly as before.

#### Declaring a view's columns

A view's `metadata.yml` may list its output columns so an agent sees them without parsing the
view's SQL: `columns: [{name, type, description}]`, where `name` matches `^[a-z0-9_]+$`, `type`
is not empty and `description` (optional) is at most 400 characters. The list is yours to
keep in step with the view's `statement`. A host that can parse the statement refuses to
start when the declared names differ from the statement's output (a statement whose output
names are not stable, such as an unaliased `id::BIGINT` anywhere in the statement, or `COLUMNS(...)`, is not checked), and a
malformed or duplicate entry is reported as `view_columns_invalid`. Views without `columns` behave as before.

### 2. Let `usage` compound from every confirmed answer

The day-to-day `usage` guide stores confirmed answers automatically:

```text
User asks a question
  → wren memory recall  (find similar past pairs)
  → wren memory fetch   (retrieve relevant schema)
  → write SQL, dry-plan, execute
  → wren memory store   (write the confirmed pair to knowledge/sql/ + index)
```

Each `store` writes a `knowledge/sql/<slug>.md` file — that markdown is the durable record;
the index is built from it. Future similar questions get faster and more accurate, with no
separate enrichment phase needed.

### 3. Re-index after each change

Whenever you edit MDL or `knowledge/`, rebuild the memory index so the agent's retrieval
reflects the new context:

```bash
wren memory index
```

This re-reads MDL + `knowledge/rules/` + `knowledge/sql/` into the index. Targeted
retrieval (`wren memory fetch -q "..."`) and recall (`wren memory recall -q "..."`) now see
the new context. Run `wren memory check` to see whether the index is in sync with the
markdown.

### 4. Commit the learned context

The pairs are already files — committing `knowledge/` *is* the export:

```bash
git add knowledge/
git commit -m "curate query pairs and rules from this sprint"
```

A new environment picks them up automatically on the next `wren memory index` (which
rebuilds the local index from the committed markdown).

## When to come back here

- A user complains the agent picked the wrong table
- A new business term shows up (a project name, a metric, a customer segment)
- You import a new dataset and need to teach the agent its quirks
- You want a teammate's environment to inherit accumulated learning

## Memory hygiene

Because the pairs are files under `knowledge/sql/`, hygiene is mostly ordinary file edits:

| Action | How |
|---|---|
| Browse stored pairs | `wren memory list`, or read `knowledge/sql/*.md` |
| Fix an incorrect pair | edit (or delete) its `knowledge/sql/<slug>.md`, then `wren memory index` |
| Share confirmed pairs | commit `knowledge/sql/` (no export step) |
| Check index vs. markdown | `wren memory check` |

See the [CLI reference](/oss/reference/cli) for the full memory command surface.

## `enrich-context`

The `enrich-context` guide goes deeper than incremental `knowledge/rules/` edits. It reads everything you drop into `<project>/raw/` (PDFs, glossaries, handbooks, analyst SQL, data dictionaries), compares it against the current MDL and `knowledge/`, and fills the gaps, writing back only to reviewable, version-controlled artifacts. It works from a ten-category gap catalog: enum value meanings, units, NULL semantics, magic sentinels, default filters, synonyms, time conventions, cross-system identifiers, currency rules, and canonical-table preferences. Named aggregation metrics (ARR, churn, DAU) are proposed as cubes.

Pick one of two modes at session start:

- **Grill mode**: the agent walks each gap one question at a time and asks focused questions ("Which of `customers`, `customers_v3`, `loyalty_v3` is canonical?", "What does `status = 4` mean?"). You answer in plain language; the agent drafts the change and patches MDL or `knowledge/` (rules and NL→SQL pairs) based on the answer category. With your OK, it can also sample low-cardinality columns from the live DB to discover enum and sentinel values.
- **Auto-pilot mode**: drop docs, glossaries, SQL history, or a metric handbook into `<project>/raw/` and the agent reads them, applies its best inferences directly, and escalates to grill only on raw-vs-MDL conflicts and high-blast-radius additions (new cubes / views / relationships). It hands you a confidence-tagged audit at the end.

Both modes only **add**. They never modify an existing field; contradictions are surfaced on a "please fix manually" list. With the `wren` skill installed (`npx skills add Canner/WrenAI`), trigger it by saying "enrich context" or "grill me on this project". The stub fetches the guide with `wren skills get enrich-context`. See the [skills reference](/oss/reference/skills#enrich-context) for the full breakdown.

## See also

- [How does the agent learn from your context?](/oss/concepts/agent_learning): the design behind the loop
- [How does memory get smarter over time?](/oss/concepts/memory_system): what's indexed and how recall works
- [Model your business](./model.md): the scaffolding step before you start refining
