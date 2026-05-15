# How agents use Wren AI (Skills)

Wren AI ships with a small set of **skills** — structured workflows that tell an AI coding agent (Claude Code, Openclaw, Hermes, Codex, etc.) how to operate the `wren` CLI without having to memorize commands.

A skill is a markdown file with metadata that the agent reads before acting. Skills are installed once per project with `npx skills add Canner/WrenAI --skill '*'`, and from then on the agent picks the right skill for each user request — generating an MDL from a new database, querying through the semantic layer, enriching context from your team docs, and so on.

Two skills are central to the workflow:

- `wren-generate-mdl` — one-time scaffolding. The agent explores your database, normalizes types, and writes an initial MDL project.
- `wren-usage` — day-to-day querying. The agent gathers context, recalls past queries, writes SQL through the semantic layer, executes, and stores successful pairs back into memory.

A third skill, **`wren-enrich-context`**, is in active development. It is the second beat of the "scaffold fast, enrich deep" workflow — once your MDL covers structure, enrich-context fills in business meaning (what `status = 4` really means, which table is canonical, how internal project codenames map to data) by either grilling you one question at a time, or by ingesting your team's raw docs in auto-pilot mode.
