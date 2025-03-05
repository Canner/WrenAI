import dataclasses
import json
import logging
import os
import sys
import warnings
from pathlib import Path
from pprint import pprint
from typing import Any, Callable, List, Optional

if sys.version_info < (3, 9):
    from typing_extensions import Annotated
else:
    from typing import Annotated

import typer

# silence UserWarning: 'PYARROW_IGNORE_TIMEZONE'
with warnings.catch_warnings():
    warnings.filterwarnings("ignore", category=UserWarning)
    from hamilton import driver

from hamilton import telemetry
from hamilton.cli import commands

logger = logging.getLogger(__name__)


@dataclasses.dataclass
class Response:
    command: str
    success: bool
    message: Any


class CliState:
    verbose: Optional[bool] = None
    json_out: Optional[bool] = None
    dr: Optional[driver.Driver] = None
    name: Optional[str] = None


cli = typer.Typer(rich_markup_mode="rich")
state = CliState()

MODULES_ANNOTATIONS = Annotated[
    List[Path],
    typer.Argument(
        help="Paths to Hamilton modules",
        exists=True,
        dir_okay=False,
        readable=True,
        resolve_path=True,
    ),
]

NAME_ANNOTATIONS = Annotated[
    Optional[str],
    typer.Option("--name", "-n", help="Name of the dataflow. Default: Derived from MODULES."),
]

CONTEXT_ANNOTATIONS = Annotated[
    Optional[Path],
    typer.Option(
        "--context",
        "-ctx",
        help="Path to Driver context file [.json, .py]",
        exists=True,
        dir_okay=False,
        readable=True,
        resolve_path=True,
    ),
]

VIZ_OUTPUT_ANNOTATIONS = Annotated[
    Path,
    typer.Option(
        "--output",
        "-o",
        help="Output path of visualization. If path is a directory, use NAME for file name.",
        dir_okay=True,
        writable=True,
        resolve_path=True,
    ),
]


# TODO add `experiments` for `hamilton.plugins.h_experiments`
# TODO add `dataflows` submenu to manage locally installed dataflows
# TODO add `init` to load project template
# callback() creates entrypoint for `hamilton` without command
@cli.callback()
def main(
    ctx: typer.Context,
    verbose: Annotated[
        bool,
        typer.Option(
            help="Output all intermediary commands",
            rich_help_panel="Output format",
        ),
    ] = False,
    json_out: Annotated[
        bool,
        typer.Option(
            help="Output JSON for programmatic use (e.g., CI)",
            rich_help_panel="Output format",
        ),
    ] = False,
):
    """Hamilton CLI"""
    if telemetry.is_telemetry_enabled():
        telemetry.create_and_send_cli_event(ctx.invoked_subcommand)
    state.verbose = verbose
    state.json_out = json_out
    logger.debug(f"verbose set to {verbose}")
    logger.debug(f"json_out set to {json_out}")


def _try_command(cmd: Callable, **cmd_kwargs) -> Any:
    """Try a command and raise errors to Typer and exit CLI"""
    cmd_name = cmd.__name__
    try:
        logger.debug(f"calling commands.{cmd_name}")
        result = cmd(**cmd_kwargs)
    except Exception as e:
        response = Response(
            command=cmd_name, success=False, message={"error": str(type(e)), "details": str(e)}
        )
        logger.error(dataclasses.asdict(response))
        raise typer.Exit(code=1) from e

    return result


def _response_handler(ctx: typer.Context, response: Response) -> None:
    """Handle how to display response"""
    if (ctx.info_name == response.command) or state.verbose:
        if state.json_out is True:
            print(json.dumps(dataclasses.asdict(response)))
        else:
            pprint(response.message)


@cli.command()
def build(
    ctx: typer.Context,
    modules: MODULES_ANNOTATIONS,
    name: NAME_ANNOTATIONS = None,
    context_path: CONTEXT_ANNOTATIONS = None,
):
    """Build a single Driver with MODULES"""
    state.dr = _try_command(cmd=commands.build, modules=modules, context_path=context_path)

    if name:
        state.name = name
    else:
        state.name = "_".join([str(Path(m).stem) for m in modules])[:40]

    _response_handler(
        ctx=ctx,
        response=Response(
            command="build",
            success=True,
            message={"modules": [p.stem for p in modules]},
        ),
    )


@cli.command()
def diff(
    ctx: typer.Context,
    modules: MODULES_ANNOTATIONS,
    name: NAME_ANNOTATIONS = None,
    context_path: CONTEXT_ANNOTATIONS = None,
    output_file_path: VIZ_OUTPUT_ANNOTATIONS = Path("./"),
    git_reference: Annotated[
        str,
        typer.Option(
            help="[link=https://git-scm.com/book/en/v2/Git-Internals-Git-References]git reference[/link] to compare to"
        ),
    ] = "HEAD",
    view: Annotated[
        bool,
        typer.Option(
            "--view",
            "-v",
            help="Generate a dataflow diff visualization",
        ),
    ] = False,
):
    """Diff between the current MODULES and their specified GIT_REFERENCE"""
    if state.dr is None:
        ctx.invoke(version, ctx=ctx, modules=modules, name=name, context_path=context_path)

    # default value isn't set to None to let Typer properly resolve the path
    # then, we change the file name
    if output_file_path.is_dir():
        output_file_path.mkdir(parents=True, exist_ok=True)
        output_file_path = output_file_path.joinpath(f"diff_{state.name}.png")

    diff = _try_command(
        cmd=commands.diff,
        current_dr=state.dr,
        modules=modules,
        git_reference=git_reference,
        view=view,
        output_file_path=output_file_path,
        context_path=context_path,
    )
    _response_handler(
        ctx=ctx,
        response=Response(
            command="diff",
            success=True,
            message=diff,
        ),
    )


@cli.command()
def validate(
    ctx: typer.Context,
    modules: MODULES_ANNOTATIONS,
    context_path: CONTEXT_ANNOTATIONS,
    name: NAME_ANNOTATIONS = None,
):
    """Validate DATAFLOW execution for the given CONTEXT"""
    if state.dr is None:
        ctx.invoke(build, ctx=ctx, modules=modules, name=name, context_path=context_path)

    validated_context = _try_command(commands.validate, dr=state.dr, context_path=context_path)
    _response_handler(
        ctx=ctx,
        response=Response(
            command="validate",
            success=True,
            message=validated_context,
        ),
    )


@cli.command()
def version(
    ctx: typer.Context,
    modules: MODULES_ANNOTATIONS,
    name: NAME_ANNOTATIONS = None,
    context_path: CONTEXT_ANNOTATIONS = None,
):
    """Version NODES and DATAFLOW from dataflow with MODULES"""
    if state.dr is None:
        ctx.invoke(build, ctx=ctx, modules=modules, name=name, context_path=context_path)

    dataflow_version = _try_command(cmd=commands.version, dr=state.dr)
    _response_handler(
        ctx=ctx,
        response=Response(
            command="version",
            success=True,
            message=dataflow_version,
        ),
    )


@cli.command()
def view(
    ctx: typer.Context,
    modules: MODULES_ANNOTATIONS,
    name: NAME_ANNOTATIONS = None,
    context_path: CONTEXT_ANNOTATIONS = None,
    output_file_path: VIZ_OUTPUT_ANNOTATIONS = Path("./"),
):
    """Build and visualize dataflow with MODULES"""
    if state.dr is None:
        ctx.invoke(build, ctx=ctx, modules=modules, name=name, context_path=context_path)

    if output_file_path.is_dir():
        output_file_path.mkdir(parents=True, exist_ok=True)
        output_file_path = output_file_path.joinpath(f"dag_{state.name}.png")

    _try_command(cmd=commands.view, dr=state.dr, output_file_path=output_file_path)
    _response_handler(
        ctx=ctx,
        response=Response(command="view", success=True, message={"path": str(output_file_path)}),
    )


@cli.command()
def ui(
    ctx: typer.Context,
    port: int = 8241,
    base_dir: str = os.path.join(Path.home(), ".hamilton", "db"),
    no_migration: bool = False,
    no_open: bool = False,
    settings_file: str = "mini",
    config_file: Optional[str] = None,
):
    """Runs the Hamilton UI on sqllite in port 8241"""
    try:
        from hamilton_ui import commands
    except ImportError as e:
        logger.error(
            "hamilton[ui] not installed -- you have to install this to run the UI. "
            'Run `pip install "sf-hamilton[ui]"` to install and get started with the UI!'
        )
        raise typer.Exit(code=1) from e

    ctx.invoke(
        commands.run,
        port=port,
        base_dir=base_dir,
        no_migration=no_migration,
        no_open=no_open,
        settings_file=settings_file,
        config_file=config_file,
    )


if __name__ == "__main__":
    cli()
