import argparse
import json
import random
import re
from pathlib import Path
from typing import Any


REQUIRED_FIELDS = {
    "question",
    "schema",
    "relationships",
    "business_metadata",
    "sql_dialect",
}

SQL_IDENTIFIER_PATTERN = re.compile(
    r"\b(?:FROM|JOIN|UPDATE|INTO)\s+([A-Za-z_][\w.$\[\]\"]*)",
    re.IGNORECASE,
)


SYSTEM_PROMPT = """You are a text-to-SQL model for Wren AI.
Generate SQL only from the provided database schema, relationships, and business metadata.
Use only declared tables, columns, relationships, metrics, and business definitions.
Never invent tables, columns, joins, filters, calculations, or business logic.
Prefer business-facing models over technical, staging, temporary, or raw tables when both are available.
If the requested information cannot be fully grounded, return {"sql": null, "reason": "INSUFFICIENT_INFORMATION"}.
Return only JSON."""


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows = []
    with path.open("r", encoding="utf-8") as file:
        for line_number, line in enumerate(file, start=1):
            stripped = line.strip()
            if not stripped:
                continue
            try:
                row = json.loads(stripped)
            except json.JSONDecodeError as exc:
                raise ValueError(f"{path}:{line_number}: invalid JSON: {exc}") from exc
            row["_line_number"] = line_number
            rows.append(row)
    return rows


def validate_row(row: dict[str, Any]) -> list[str]:
    errors = []
    missing = sorted(field for field in REQUIRED_FIELDS if not row.get(field))
    if missing:
        errors.append(f"missing required fields: {', '.join(missing)}")

    has_sql = bool(row.get("expected_sql"))
    has_insufficient_reason = bool(row.get("insufficient_information_reason"))
    if not has_sql and not has_insufficient_reason:
        errors.append(
            "expected_sql is empty; insufficient_information_reason is required"
        )

    if has_sql and has_insufficient_reason:
        errors.append(
            "provide either expected_sql or insufficient_information_reason, not both"
        )

    if has_sql:
        sql = str(row["expected_sql"]).strip()
        if not sql.lower().startswith(("select", "with")):
            errors.append("expected_sql must start with SELECT or WITH")
        if re.search(r"\b(select\s+\*)\b", sql, re.IGNORECASE):
            errors.append("expected_sql must not use SELECT *")

    return errors


def build_user_content(row: dict[str, Any]) -> str:
    return "\n\n".join(
        [
            f"QUESTION:\n{row['question']}",
            f"SQL_DIALECT:\n{row['sql_dialect']}",
            f"DATABASE_SCHEMA:\n{row['schema']}",
            f"RELATIONSHIPS:\n{row['relationships']}",
            f"BUSINESS_METADATA:\n{row['business_metadata']}",
        ]
    )


def build_assistant_content(row: dict[str, Any]) -> str:
    if row.get("expected_sql"):
        return json.dumps(
            {"sql": str(row["expected_sql"]).strip()},
            ensure_ascii=False,
            separators=(",", ":"),
        )
    return json.dumps(
        {
            "sql": None,
            "reason": "INSUFFICIENT_INFORMATION",
            "detail": str(row["insufficient_information_reason"]).strip(),
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )


def to_chat_sample(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": build_user_content(row)},
            {"role": "assistant", "content": build_assistant_content(row)},
        ],
        "metadata": {
            "source_line": row["_line_number"],
            "sql_dialect": row.get("sql_dialect"),
            "tables_referenced": sorted(
                set(SQL_IDENTIFIER_PATTERN.findall(str(row.get("expected_sql") or "")))
            ),
        },
    }


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as file:
        for row in rows:
            file.write(json.dumps(row, ensure_ascii=False) + "\n")


def split_rows(
    rows: list[dict[str, Any]],
    validation_ratio: float,
    test_ratio: float,
    seed: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    shuffled = list(rows)
    random.Random(seed).shuffle(shuffled)

    total = len(shuffled)
    test_count = round(total * test_ratio)
    validation_count = round(total * validation_ratio)
    train_count = total - validation_count - test_count

    return (
        shuffled[:train_count],
        shuffled[train_count : train_count + validation_count],
        shuffled[train_count + validation_count :],
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--validation-ratio", type=float, default=0.1)
    parser.add_argument("--test-ratio", type=float, default=0.1)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    rows = read_jsonl(args.input)
    validation_errors = []
    valid_rows = []
    for row in rows:
        errors = validate_row(row)
        if errors:
            validation_errors.append(
                {"line": row["_line_number"], "errors": errors}
            )
        else:
            valid_rows.append(row)

    if validation_errors:
        args.output_dir.mkdir(parents=True, exist_ok=True)
        report_path = args.output_dir / "dataset_report.json"
        report_path.write_text(
            json.dumps(
                {
                    "status": "failed",
                    "input_rows": len(rows),
                    "valid_rows": len(valid_rows),
                    "validation_errors": validation_errors,
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        raise SystemExit(f"Dataset validation failed. See {report_path}")

    if len(valid_rows) < 10:
        raise SystemExit("Need at least 10 verified examples before splitting.")

    samples = [to_chat_sample(row) for row in valid_rows]
    train, validation, test = split_rows(
        samples,
        validation_ratio=args.validation_ratio,
        test_ratio=args.test_ratio,
        seed=args.seed,
    )

    args.output_dir.mkdir(parents=True, exist_ok=True)
    write_jsonl(args.output_dir / "train.jsonl", train)
    write_jsonl(args.output_dir / "validation.jsonl", validation)
    write_jsonl(args.output_dir / "test.jsonl", test)

    report = {
        "status": "ok",
        "input_rows": len(rows),
        "train_rows": len(train),
        "validation_rows": len(validation),
        "test_rows": len(test),
        "seed": args.seed,
    }
    (args.output_dir / "dataset_report.json").write_text(
        json.dumps(report, indent=2),
        encoding="utf-8",
    )
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
