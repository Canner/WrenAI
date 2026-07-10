"""``wren ask`` — wrap a user prompt for agent consumption.

Mode (``--guided`` or ``--direct``) must be chosen explicitly; there is no
default. The reason: the two modes wrap prompts very differently, and a
silent default-change would alter agent behavior across an upgrade.
"""

from __future__ import annotations

import typer

from wren import ask as _ask


def ask(
    prompt: str = typer.Argument(
        ..., help="The user's natural-language question to wrap."
    ),
    guided: bool = typer.Option(
        False,
        "--guided",
        help="Wrap in a strict-flow guided prompt (for weaker LLMs).",
    ),
    direct: bool = typer.Option(
        False,
        "--direct",
        help="Wrap in a minimal direct prompt (for stronger LLMs).",
    ),
) -> None:
    """Wrap PROMPT into a processed prompt for an agent.

    Choose exactly one of ``--guided`` or ``--direct``.
    """
    if guided == direct:
        # both False or both True
        typer.echo(
            "Error: choose exactly one of --guided or --direct (no default).",
            err=True,
        )
        raise typer.Exit(2)
    mode = "guided" if guided else "direct"
    typer.echo(_ask.render(mode, prompt))
