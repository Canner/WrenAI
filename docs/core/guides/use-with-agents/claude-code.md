# Use with Claude Code

Wren AI is designed to work as Claude Code's grounding layer for any database it needs to query. With the Wren skills installed, Claude Code stops guessing about your schema — it discovers tables, looks up canonical models, recalls similar past queries, and generates SQL through the semantic layer.

## Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview) installed and authenticated
- A [Wren AI project](/oss/get_started/quickstart) with at least one profile

## Install the Wren skills

```bash
npx skills add Canner/WrenAI --skill '*'
```

Or via the install script:

```bash
curl -fsSL https://raw.githubusercontent.com/Canner/WrenAI/main/skills/install.sh | bash
```

The CLI auto-detects Claude Code. If you have multiple agents installed and want to target Claude Code specifically:

```bash
npx skills add Canner/WrenAI --skill '*' --agent claude-code
```

## What each skill does

| Skill | When to use |
|-------|------|
| `wren-generate-mdl` | One-time setup — explore a new database and write the initial MDL project. |
| `wren-usage` | Day-to-day querying — fetch context, recall similar queries, write and execute SQL, store the result for future recall. |
| `wren-onboarding` | First-time install — set up the environment, scaffold a project, run a first query. |
| `wren-dlt-connector` | Connect a SaaS data source via [dlt](https://dlthub.com/) and scaffold a Wren project from the loaded data. |

## Typical workflow

1. **Open Claude Code in your Wren project directory** — `cd ~/my-wren-project && claude`
2. **Ask a question in natural language**:

   ```text
   How many customers placed more than one order this month?
   ```

3. **Claude Code uses `wren-usage`** to fetch context, recall examples, write SQL, execute via `wren --sql "..."`, and store the result.

## Tips

- Re-run `wren memory index` after editing `instructions.md` or model descriptions so the new content is searchable.
- If Claude Code picks the wrong table, add a `## Canonical tables` section to `instructions.md` and rebuild.
