"""3-line quickstart: attach a CLI-prepared Wren project to a Pydantic AI agent.

Prereq:
    wren profile add my_project --datasource duckdb
    wren context init
    wren context set-profile my_project
    wren context build

Run:
    OPENAI_API_KEY=sk-... python examples/pydantic_ai_demo.py

    # Route the agent through the OrcaRouter gateway instead of OpenAI:
    ORCAROUTER_API_KEY=sk-orca-... python examples/pydantic_ai_demo.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from pydantic_ai import Agent
from pydantic_ai.models.openai import OpenAIChatModel

from wren_pydantic import WrenToolkit
from wren_pydantic.orcarouter import create_orcarouter_model


def build_model() -> OpenAIChatModel:
    """Return a model, routed through OrcaRouter when ``ORCAROUTER_API_KEY`` is set.

    OrcaRouter (https://www.orcarouter.ai) is an OpenAI-compatible gateway, so the
    Pydantic AI ``OpenAIChatModel`` endpoint works. When no OrcaRouter key is present
    the demo falls back to the default OpenAI model.
    """
    if os.environ.get("ORCAROUTER_API_KEY"):
        return create_orcarouter_model()
    return OpenAIChatModel("gpt-4o")


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
    if not (os.environ.get("OPENAI_API_KEY") or os.environ.get("ORCAROUTER_API_KEY")):
        sys.exit("OPENAI_API_KEY (or ORCAROUTER_API_KEY) is required.")

    toolkit = WrenToolkit.from_project(project_path)
    agent = Agent(
        build_model(),
        instructions=toolkit.instructions(),
        toolsets=[toolkit.toolset()],
    )

    question = "How many rows are in each model in this project?"
    result = agent.run_sync(question)
    print(f"Q: {question}\n")
    print(result.output)


if __name__ == "__main__":
    main()
