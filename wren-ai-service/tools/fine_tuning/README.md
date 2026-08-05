# Codestral SQL Fine-Tuning

This folder prepares verified Wren text-to-SQL examples for supervised fine-tuning.
It does not invent database examples. Use only production-reviewed question/SQL pairs.

## Input Format

Create a JSONL file where each line has this shape:

```json
{
  "question": "Natural language question",
  "schema": "Relevant deployed schema DDL or structured schema text",
  "relationships": "Approved join paths and relationship definitions",
  "business_metadata": "Business definitions, metrics, dimensions, and rules",
  "sql_dialect": "mssql",
  "expected_sql": "Verified production SQL"
}
```

For unanswerable examples, use:

```json
{
  "question": "Natural language question",
  "schema": "Relevant deployed schema DDL or structured schema text",
  "relationships": "Approved join paths and relationship definitions",
  "business_metadata": "Business definitions, metrics, dimensions, and rules",
  "sql_dialect": "mssql",
  "expected_sql": null,
  "insufficient_information_reason": "The required field is not present in the deployed schema."
}
```

## Prepare Dataset

```bash
python tools/fine_tuning/prepare_sft_dataset.py \
  --input eval/dataset/verified_sql_examples.jsonl \
  --output-dir outputs/fine_tuning/codestral-sql \
  --seed 42
```

Outputs:

- `train.jsonl`
- `validation.jsonl`
- `test.jsonl`
- `dataset_report.json`

Each output row is a chat-style SFT sample with `system`, `user`, and `assistant`
messages.

## Train

Use the generated files with a GPU training tool such as Axolotl. `axolotl-codestral-sql-qlora.yml`
is a template. Update model path, dataset paths, GPU settings, and output directory
before running it.

## Serve

Serve the fine-tuned adapter behind an OpenAI-compatible endpoint, then point
`wren-ai-service/config.yaml` `api_base` to that endpoint.

Keep Wren retrieval enabled. The adapter should learn how to obey schema context,
not memorize the database.
