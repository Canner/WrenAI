#!/usr/bin/env python3
"""Utilities for the Spodbtify A/B agent eval.

The eval itself is model- and agent-agnostic. This script validates the spec,
generates isolated prompts, runs optional agent command templates, and sums
0/1/2 rubric scores supplied by a human or external grader.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import shlex
import subprocess
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
SPEC_PATH = ROOT / "spodbtify_ab_eval.json"
AGENT_OUTPUT_SCHEMA_PATH = ROOT / "agent_output.schema.json"
DIMENSIONS = ("correct_table", "correct_sql", "correct_answer")
WORKFLOWS = ("schema_only", "dbt_integrated")


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return data


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


def question_by_id(spec: dict[str, Any], question_id: int) -> dict[str, Any]:
    for question in spec["questions"]:
        if question["id"] == question_id:
            return question
    raise ValueError(f"unknown question id: {question_id}")


def workflow_by_id(spec: dict[str, Any], workflow_id: str) -> dict[str, Any]:
    for workflow in spec["workflows"]:
        if workflow["id"] == workflow_id:
            return workflow
    raise ValueError(f"unknown workflow id: {workflow_id}")


def validate_spec(spec: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if spec.get("id") != "spodbtify_ab":
        errors.append("spec id must be 'spodbtify_ab'")

    question_ids = [q.get("id") for q in spec.get("questions", [])]
    if question_ids != list(range(1, 21)):
        errors.append("questions must have ids 1 through 20 in order")

    workflows = {w.get("id") for w in spec.get("workflows", [])}
    missing_workflows = set(WORKFLOWS) - workflows
    if missing_workflows:
        errors.append(f"missing workflows: {sorted(missing_workflows)}")

    dimensions = [
        d.get("id") for d in spec.get("scoring", {}).get("dimensions", [])
    ]
    if tuple(dimensions) != DIMENSIONS:
        errors.append(f"scoring dimensions must be {DIMENSIONS}")

    expected_total = (
        len(spec.get("questions", []))
        * len(DIMENSIONS)
        * 2
    )
    if spec.get("scoring", {}).get("max_total") != expected_total:
        errors.append(f"max_total must be {expected_total}")

    table_names = [t.get("name") for t in spec.get("dataset", {}).get("tables", [])]
    if len(table_names) != len(set(table_names)):
        errors.append("dataset table names must be unique")

    return errors


def validate_score_file(score_file: dict[str, Any], spec: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    expected_ids = {q["id"] for q in spec["questions"]}
    for run_index, run in enumerate(score_file.get("runs", []), start=1):
        workflow = run.get("workflow")
        if workflow not in WORKFLOWS:
            errors.append(f"run {run_index}: unknown workflow {workflow!r}")

        scores = run.get("scores", [])
        seen_ids: set[Any] = set()
        duplicate_ids: set[Any] = set()
        for entry in scores:
            qid = entry.get("question_id")
            if qid in seen_ids:
                duplicate_ids.add(qid)
            seen_ids.add(qid)
        if duplicate_ids:
            errors.append(
                "run "
                f"{run_index}: duplicate question ids: "
                f"{sorted(duplicate_ids, key=str)}"
            )
        if seen_ids != expected_ids:
            errors.append(
                "run "
                f"{run_index}: expected question ids 1-20, "
                f"got {sorted(seen_ids, key=str)}"
            )

        for entry in scores:
            qid = entry.get("question_id")
            for dim in DIMENSIONS:
                score = entry.get(dim)
                if not isinstance(score, int) or score < 0 or score > 2:
                    errors.append(
                        f"run {run_index} question {qid}: {dim} must be 0, 1, or 2"
                    )
    return errors


def score_entry(entry: dict[str, Any]) -> int:
    return sum(int(entry[dim]) for dim in DIMENSIONS)


def score_run(run: dict[str, Any]) -> dict[str, Any]:
    question_scores = [
        {
            "question_id": entry["question_id"],
            "total": score_entry(entry),
            **{dim: entry[dim] for dim in DIMENSIONS},
        }
        for entry in run["scores"]
    ]
    total = sum(item["total"] for item in question_scores)
    return {
        "name": run.get("name", ""),
        "agent": run.get("agent", ""),
        "workflow": run.get("workflow", ""),
        "total": total,
        "percent": total / 120 * 100,
        "question_scores": question_scores,
    }


def print_score_summary(score_file: dict[str, Any], spec: dict[str, Any]) -> None:
    errors = validate_score_file(score_file, spec)
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)

    summaries = [score_run(run) for run in score_file["runs"]]
    for summary in summaries:
        print(
            f"{summary['name']} "
            f"({summary['agent']}, {summary['workflow']}): "
            f"{summary['total']}/120 ({summary['percent']:.1f}%)"
        )

    by_workflow = {summary["workflow"]: summary for summary in summaries}
    if {"schema_only", "dbt_integrated"} <= set(by_workflow):
        gap = (
            by_workflow["dbt_integrated"]["total"]
            - by_workflow["schema_only"]["total"]
        )
        print(
            "Gap dbt_integrated - schema_only: "
            f"{gap} points ({gap / 120 * 100:.1f}%)"
        )

    consistency = score_file.get("multi_run_consistency", [])
    if consistency:
        schema_totals = [int(row["schema_only_total"]) for row in consistency]
        dbt_totals = [int(row["dbt_integrated_total"]) for row in consistency]
        gaps = [dbt - schema for schema, dbt in zip(schema_totals, dbt_totals)]
        print(
            "Multi-run mean: "
            f"schema_only={sum(schema_totals) / len(schema_totals):.1f}/120, "
            f"dbt_integrated={sum(dbt_totals) / len(dbt_totals):.1f}/120, "
            f"gap={sum(gaps) / len(gaps):.1f}"
        )


def render_prompt(
    spec: dict[str, Any], *, agent: str, workflow_id: str, question_id: int
) -> str:
    workflow = workflow_by_id(spec, workflow_id)
    question = question_by_id(spec, question_id)
    dataset = spec["dataset"]
    setup_steps = "\n".join(f"- {step}" for step in workflow["setup_steps"])
    allowed_context = "\n".join(f"- {item}" for item in workflow["allowed_context"])
    forbidden_context = "\n".join(
        f"- {item}" for item in workflow["forbidden_context"]
    )

    return f"""# Spodbtify A/B Eval

Agent: {agent}
Workflow: {workflow['name']} ({workflow_id})
Question: {question_id}

You are answering one analytical question against the Spodbtify DuckDB dataset
through Wren. Treat this as a fresh eval session for this workflow.

Dataset path:
{dataset['duckdb_path']}

dbt project path:
{dataset['dbt_project_dir']}

Workflow setup:
{setup_steps}

Allowed context:
{allowed_context}

Forbidden context:
{forbidden_context}

Question:
{question['text']}

Return only JSON with this shape:
{{
  "question_id": {question_id},
  "workflow": "{workflow_id}",
  "agent": "{agent}",
  "selected_tables": ["table_or_model_name"],
  "sql": "the SQL you executed",
  "answer": "the final analytical answer with key numbers",
  "notes": "optional caveats, tie-breaking, or data quality issues"
}}
"""


def selected_workflows(value: str) -> list[str]:
    if value == "both":
        return list(WORKFLOWS)
    if value not in WORKFLOWS:
        raise argparse.ArgumentTypeError(
            f"workflow must be one of {', '.join(WORKFLOWS)} or both"
        )
    return [value]


def selected_questions(value: str) -> list[int]:
    if value == "all":
        return list(range(1, 21))
    try:
        question_id = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("question must be an integer or all") from exc
    if question_id < 1 or question_id > 20:
        raise argparse.ArgumentTypeError("question must be between 1 and 20")
    return [question_id]


def create_score_template(agent: str, workflow: str) -> dict[str, Any]:
    return {
        "eval_id": "spodbtify_ab",
        "run_date": dt.date.today().isoformat(),
        "runs": [
            {
                "name": f"{agent} - {workflow}",
                "agent": agent,
                "workflow": workflow,
                "scores": [
                    {
                        "question_id": question_id,
                        "correct_table": None,
                        "correct_sql": None,
                        "correct_answer": None,
                        "notes": "",
                    }
                    for question_id in range(1, 21)
                ],
            }
        ],
    }


def quote_mapping(mapping: dict[str, str]) -> dict[str, str]:
    return {key: shlex.quote(value) for key, value in mapping.items()}


def run_agent(args: argparse.Namespace, spec: dict[str, Any]) -> None:
    timestamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    output_root = (
        Path(args.output_dir).expanduser()
        if args.output_dir
        else ROOT / "runs" / f"{timestamp}_{args.agent}"
    )
    prompts_dir = output_root / "prompts"
    answers_dir = output_root / "answers"
    prompts_dir.mkdir(parents=True, exist_ok=True)
    answers_dir.mkdir(parents=True, exist_ok=True)

    for workflow in selected_workflows(args.workflow):
        for question_id in selected_questions(args.question):
            prompt = render_prompt(
                spec, agent=args.agent, workflow_id=workflow, question_id=question_id
            )
            prompt_file = prompts_dir / f"{workflow}_q{question_id:02d}.md"
            output_file = answers_dir / f"{workflow}_q{question_id:02d}.json"
            prompt_file.write_text(prompt, encoding="utf-8")

            if args.dry_run or not args.agent_command:
                print(f"wrote {prompt_file}")
                continue

            raw_mapping = {
                "prompt_file": str(prompt_file),
                "output_file": str(output_file),
                "agent": args.agent,
                "workflow": workflow,
                "question_id": str(question_id),
                "schema_file": str(AGENT_OUTPUT_SCHEMA_PATH),
            }
            command = args.agent_command.format(**quote_mapping(raw_mapping))
            print(f"running q{question_id:02d} {workflow}: {command}")
            try:
                result = subprocess.run(
                    command,
                    shell=True,
                    cwd=str(Path.cwd()),
                    timeout=args.timeout_seconds,
                )
            except subprocess.TimeoutExpired:
                raise SystemExit(
                    f"agent command timed out for q{question_id:02d} {workflow}"
                ) from None
            if result.returncode != 0:
                raise SystemExit(result.returncode)

    print(f"run directory: {output_root}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("validate", help="Validate the eval spec and schemas.")

    prompt_parser = subparsers.add_parser("prompt", help="Print one eval prompt.")
    prompt_parser.add_argument("--agent", required=True)
    prompt_parser.add_argument("--workflow", required=True, choices=WORKFLOWS)
    prompt_parser.add_argument("--question", required=True, type=int)

    score_parser = subparsers.add_parser("score", help="Summarize a score JSON file.")
    score_parser.add_argument("--scores", required=True)

    template_parser = subparsers.add_parser(
        "new-score-template", help="Create an empty score template."
    )
    template_parser.add_argument("--agent", required=True)
    template_parser.add_argument("--workflow", required=True, choices=WORKFLOWS)
    template_parser.add_argument("--output", required=True)

    run_parser = subparsers.add_parser(
        "run-agent", help="Generate prompts and optionally run an agent command."
    )
    run_parser.add_argument("--agent", required=True)
    run_parser.add_argument("--workflow", default="both")
    run_parser.add_argument("--question", default="all")
    run_parser.add_argument("--command", dest="agent_command")
    run_parser.add_argument("--output-dir")
    run_parser.add_argument("--dry-run", action="store_true")
    run_parser.add_argument(
        "--timeout-seconds",
        type=int,
        default=300,
        help="Per-question timeout for external agent command.",
    )

    args = parser.parse_args()
    spec = load_json(SPEC_PATH)

    if args.command == "validate":
        spec_errors = validate_spec(spec)
        schema_errors: list[str] = []
        if AGENT_OUTPUT_SCHEMA_PATH.exists():
            try:
                load_json(AGENT_OUTPUT_SCHEMA_PATH)
            except (OSError, ValueError) as exc:
                schema_errors = [str(exc)]
        errors = spec_errors + schema_errors
        if errors:
            for error in errors:
                print(f"ERROR: {error}", file=sys.stderr)
            raise SystemExit(1)
        print("OK: spec and schemas are valid")
        return

    if args.command == "prompt":
        print(
            render_prompt(
                spec,
                agent=args.agent,
                workflow_id=args.workflow,
                question_id=args.question,
            )
        )
        return

    if args.command == "score":
        print_score_summary(load_json(Path(args.scores).expanduser()), spec)
        return

    if args.command == "new-score-template":
        write_json(
            Path(args.output).expanduser(),
            create_score_template(args.agent, args.workflow),
        )
        print(f"wrote {args.output}")
        return

    if args.command == "run-agent":
        run_agent(args, spec)
        return

    raise AssertionError(f"unhandled command: {args.command}")


if __name__ == "__main__":
    main()
