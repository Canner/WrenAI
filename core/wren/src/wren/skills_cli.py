"""``wren skills`` — serve bundled Wren agent skill guides."""

from __future__ import annotations

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
) -> None:
    """Print a skill's main guide to stdout."""
    try:
        content = skills_delivery.get_skill(name)
    except skills_delivery.SkillNotFoundError:
        typer.echo(
            f"Error: unknown skill '{name}'. "
            "Run `wren skills list` for available names.",
            err=True,
        )
        raise typer.Exit(1)
    typer.echo(content)
