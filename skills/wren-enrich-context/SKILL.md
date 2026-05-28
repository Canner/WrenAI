---
name: wren-enrich-context
description: "Augment a Wren project with business context that DB schema cannot carry — enum value meanings, units (USD vs cents, ms vs sec), NULL semantics, magic sentinels (-1 = unknown), soft-delete default filters, business synonyms, time-grain / TZ conventions, cross-system identifiers, currency rules, canonical-table preferences, AND named aggregation metrics (ARR, churn, DAU, WAU, NRR) proposed as cubes. Runs in one of two modes selected at session start: `grill` (one question at a time, user-driven) or `auto-pilot` (agent infers and applies, escalates only on conflicts and high-blast-radius additions like new cubes / views / relationships). Reads everything under <project>/raw/ (PDFs, glossaries, handbooks, code, data dictionaries) and optionally samples low-cardinality columns from the live DB (grill mode), compares against the current MDL / cubes / instructions.md / queries.yml / memory pairs, then fills gaps via the ten-category gap catalog and the cube proposal flow. Confirmed findings are written back to the right sink. Use when: user says 'enrich context', 'augment my project', 'grill me on this project', 'auto-fill my context', 'agent doesn't understand our docs / enum values / units / null meanings', 'business context is missing', 'what does status=A mean', 'is this amount in USD or cents', 'we keep getting wrong aggregations', 'add cubes for ARR / DAU / churn', 'we have a handbook / glossary / data dictionary the agent should know'; or after generating an MDL and noticing the agent lacks business semantics."
license: Apache-2.0
---

# wren-enrich-context — moved into the `wren` CLI

This skill's content now lives inside the `wren` CLI itself, so it always
matches the installed wren-engine version. Fetch it with:

```bash
wren skills get enrich-context
```

Add `--full` to include the reference docs, or `--script <name>` for any
bundled scripts. Run `wren skills list` to see everything available.
