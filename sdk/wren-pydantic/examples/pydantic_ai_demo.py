"""3-line quickstart: attach a CLI-prepared Wren project to a Pydantic AI agent.

Prereq:
    wren profile add my_project --datasource duckdb
    wren context init
    wren context set-profile my_project
    wren context build

Run:
    OPENAI_API_KEY=sk-... python examples/pydantic_ai_demo.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from pydantic_ai import Agent

from wren_pydantic import WrenToolkit


def main() -> None:
    project_path = Path(os.environ.get("PROJECT_PATH", "./analytics_db")).expanduser()
    if not (project_path / "wren_project.yml").exists():
        print(
            f"PROJECT_PATH={project_path} doesn't look like a Wren project "
            "(no wren_project.yml). Run `wren context init` there first, "
            "or set PROJECT_PATH to an existing project.",
            file=sys.stderr,
        )
        sys.exit(1)

    toolkit = WrenToolkit.from_project(project_path)
    agent = Agent(
        "openai:gpt-4o",
        instructions=toolkit.instructions(),
        toolsets=[toolkit.toolset()],
    )

    question = "How many rows are in each model in this project?"
    result = agent.run_sync(question)
    print(f"Q: {question}\n")
    print(result.output)


if __name__ == "__main__":
    main()
