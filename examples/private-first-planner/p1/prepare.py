"""Create a fresh public synthetic fixture for the private-first evaluation."""

import argparse
import json
import runpy
from pathlib import Path

import duckdb
import yaml


def prepare(destination: Path):
    setup = Path(__file__).resolve().parents[2] / "serve-agent/setup.py"
    runpy.run_path(str(setup))["prepare_adhoc"](destination)
    with duckdb.connect(str(destination / "data/synthetic.duckdb")) as db:
        # Make status/default and test-row mistakes observable in numeric results.
        db.executemany(
            "INSERT INTO raw_orders VALUES (?, ?, ?, ?, ?, ?)",
            [
                (101, 1, "2026-01-08", 50.0, False, "cancelled"),
                (102, 2, "2026-01-08", 70.0, False, "pending"),
                (103, 3, "2026-01-08", 999.0, True, "paid"),
            ],
        )
    config_path = destination / "project/service.yml"
    config = yaml.safe_load(config_path.read_text())
    config["execution"] = {
        "deadline_ms": 120000,
        "as_of": "2026-01-19",
        "max_turns": 12,
        "max_tool_calls": 24,
        "max_tokens": 8192,
        "thinking": "on",
        "provider_max_retries": 0,
    }
    config_path.write_text(yaml.safe_dump(config, sort_keys=False))
    (destination / "expected.json").write_text(
        json.dumps(
            {
                "period": {"lower": "2026-01-01", "upper": "2026-01-19"},
                "revenue": 770,
                "all_status_order_count": 13,
                "weekly_revenue": [
                    ["2025-12-29", 50],
                    ["2026-01-05", 220],
                    ["2026-01-12", 500],
                ],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    prepare(parser.parse_args().destination.resolve())
