"""Structured output example using Pydantic AI's `output_type=`.

Shows how to combine the Wren toolset with a typed agent output — the
framework validates the model's response against the declared schema,
making downstream code easier to write.

Prereq: same as pydantic_ai_demo.py.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from pydantic import BaseModel
from pydantic_ai import Agent

from wren_pydantic import WrenToolkit


class TopCustomers(BaseModel):
    """The agent must return its answer in this shape."""

    period: str
    customers: list[str]
    notes: str | None = None


def main() -> None:
    project_path = Path(os.environ.get("PROJECT_PATH", "./analytics_db")).expanduser()
    if not (project_path / "wren_project.yml").exists():
        print(f"PROJECT_PATH={project_path} not a Wren project", file=sys.stderr)
        sys.exit(1)

    toolkit = WrenToolkit.from_project(project_path)
    agent = Agent(
        "openai:gpt-4o",
        instructions=toolkit.instructions(),
        toolsets=[toolkit.toolset()],
        output_type=TopCustomers,
    )

    result = agent.run_sync(
        "Top 5 customers by revenue last quarter — return names only."
    )
    # result.output is a validated TopCustomers instance, not a free-form string.
    print(f"Period: {result.output.period}")
    print("Customers:")
    for name in result.output.customers:
        print(f"  - {name}")
    if result.output.notes:
        print(f"\nNotes: {result.output.notes}")


if __name__ == "__main__":
    main()
