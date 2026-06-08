"""``wren skills`` — serve bundled Wren agent skill guides."""

from __future__ import annotations

from typing import Optional

import typer

from wren import skills_delivery

skills_app = typer.Typer(
    name="skills",
    help="Serve Wren agent skill guides (run `wren skills list`).",
)


@skills_app.command(name="list")
def list_cmd() -> None:
    """List the available skill guides."""
    skills = skills_delivery.list_skills()
    if not skills:
        typer.echo("No skills available.")
        return
    typer.echo("Available skills (run `wren skills get <name>`):")
    for skill in skills:
        typer.echo(f"  {skill.name:16}{skill.summary}")
        extras = []
        if skill.references:
            extras.append("references: " + ", ".join(skill.references))
        if skill.scripts:
            extras.append("scripts: " + ", ".join(skill.scripts))
        if extras:
            typer.echo(f"  {'':16}" + "    ".join(extras))


@skills_app.command()
def get(
    name: str = typer.Argument(..., help="Skill name (see `wren skills list`)."),
    full: bool = typer.Option(
        False, "--full", help="Include the skill's reference docs."
    ),
    script: Optional[str] = typer.Option(
        None, "--script", help="Print a bundled script instead of the guide."
    ),
) -> None:
    """Print a skill's main guide (or a bundled script) to stdout."""
    try:
        if script is not None:
            content = skills_delivery.get_script(name, script)
        else:
            content = skills_delivery.get_skill(name, full=full)
    except skills_delivery.SkillNotFoundError:
        typer.echo(
            f"Error: unknown skill '{name}'. "
            "Run `wren skills list` for available names.",
            err=True,
        )
        raise typer.Exit(1)
    except skills_delivery.ScriptNotFoundError:
        typer.echo(
            f"Error: skill '{name}' has no script '{script}'. "
            "Run `wren skills list` to see available scripts.",
            err=True,
        )
        raise typer.Exit(1)
    typer.echo(content)
