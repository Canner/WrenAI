# Spodbtify A/B Eval

This eval compares two workflows for turning the same DuckDB database into a
queryable Wren semantic layer, then scoring how well an AI coding agent answers
20 analytical Spotify playlist questions.

The eval is intentionally agent-agnostic. It is not tied to Claude Code: use
the same spec with Claude, Codex, Cursor, an MCP client, or any runner that can
consume a prompt file and write an answer file.

## Dataset

Expected local dataset:

```bash
export SPODBTIFY_DUCKDB_PATH=/path/to/spodbtify.duckdb
```

Expected dbt project artifacts:

```bash
export SPODBTIFY_DBT_PROJECT_DIR=/path/to/spodbtify-dbt-project

$SPODBTIFY_DBT_PROJECT_DIR/target/manifest.json
$SPODBTIFY_DBT_PROJECT_DIR/target/catalog.json
$SPODBTIFY_DBT_PROJECT_DIR/target/run_results.json
$SPODBTIFY_DBT_PROJECT_DIR/target/compiled/
```

The dataset is intentionally not checked into this repository.

## Files

- `spodbtify_ab_eval.json` is the canonical eval spec: workflows, controls,
  table inventory, scoring rubric, questions, and result schema.
- `agent_output.schema.json` is an optional JSON Schema for agents that support
  structured output.
- `run_eval.py` validates the spec, generates prompts, runs arbitrary agent
  command templates, and summarizes score files.

## Quick Validation

```bash
python3 evals/spodbtify_ab/run_eval.py validate
```

## Generate Prompts

Print one prompt:

```bash
python3 evals/spodbtify_ab/run_eval.py prompt \
  --agent codex \
  --workflow dbt_integrated \
  --question 1
```

Materialize prompt files for all questions without running an agent:

```bash
python3 evals/spodbtify_ab/run_eval.py run-agent \
  --agent codex \
  --workflow both \
  --dry-run
```

## Run With Any Agent CLI

`run-agent` accepts a shell command template. These placeholders are available:

- `{prompt_file}`
- `{output_file}`
- `{agent}`
- `{workflow}`
- `{question_id}`
- `{schema_file}`

Example shape:

```bash
python3 evals/spodbtify_ab/run_eval.py run-agent \
  --agent codex \
  --workflow schema_only \
  --command 'codex exec --sandbox danger-full-access --output-schema {schema_file} -o {output_file} - < {prompt_file}'
```

Use the equivalent command for Claude or another agent:

```bash
python3 evals/spodbtify_ab/run_eval.py run-agent \
  --agent claude \
  --workflow dbt_integrated \
  --command 'claude -p "$(cat {prompt_file})" > {output_file}'
```

Exact CLI flags vary by tool and installation. The eval contract is the prompt
file in, answer file out. Keep one fresh session per workflow and do not share
answers or memory between workflows.

## Scoring Contract

Agents should return JSON with:

```json
{
  "question_id": 1,
  "workflow": "dbt_integrated",
  "agent": "codex",
  "selected_tables": ["Top_Artists", "Artist_Collaborators"],
  "sql": "SELECT ...",
  "answer": "The analytical answer...",
  "notes": "Optional caveats"
}
```

After a human or external grader assigns the three 0/1/2 scores for each
question, store them in the score schema shown by:

```bash
python3 evals/spodbtify_ab/run_eval.py new-score-template \
  --agent codex \
  --workflow dbt_integrated \
  --output /tmp/codex-dbt-score.json
```

Then summarize:

```bash
python3 evals/spodbtify_ab/run_eval.py score --scores /tmp/codex-dbt-score.json
```

Do not commit agent answer files, run directories, or scored result files.
