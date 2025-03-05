import functools
import itertools
import json
import os
from typing import Union

import pandas as pd
from fastapi import FastAPI
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastui import AnyComponent, FastUI, prebuilt_html
from fastui import components as c
from fastui.components.display import DisplayLookup, DisplayMode
from fastui.events import GoToEvent
from fastui.forms import SelectSearchResponse
from pydantic import BaseModel, Field

from hamilton.plugins.h_experiments.cache import JsonCache
from hamilton.plugins.h_experiments.data_model import (
    NodeMaterializer,
    RunMetadata,
    model_from_values,
)


def convert_graph_hash_to_version(runs):
    """Convert graph hash to incremental id, per experiment"""
    versioned_runs = []
    for _, group in itertools.groupby(runs, lambda r: r.experiment):
        group = sorted(group, key=lambda run: run.date_completed)

        current_version = 1
        current_hash = None
        for r in group:
            if current_hash is None:
                current_hash = r.graph_hash

            if r.graph_hash != current_hash:
                current_hash = r.graph_hash
                current_version += 1

            r.graph_version = current_version
            versioned_runs.append(r)
    return versioned_runs


def get_runs(metadata_cache_path: str) -> list[RunMetadata]:
    """Create RunMetadata objects for all runs JSON found in cache"""
    cache = JsonCache(cache_path=metadata_cache_path)
    runs = [RunMetadata.model_validate_json(cache.read(run_id)) for run_id in cache.keys()]
    runs = convert_graph_hash_to_version(runs)
    runs = sorted(runs, key=lambda run: run.date_completed, reverse=True)
    return runs


# environment variables are the most convenient approach
# to configure FastAPI application
base_directory = os.getenv("HAMILTON_EXPERIMENTS_PATH", "")

# disable Swagger UI /docs because they are currently bugged for FastUI
app = FastAPI(docs_url=None, redoc_url=None)
app.mount("/experiments", StaticFiles(directory=base_directory), name="experiments")
runs = get_runs(base_directory)


def base_page(*components: AnyComponent) -> list[AnyComponent]:
    """Template applied to all pages. Includes: title, navigation, and footer"""
    return [
        c.PageTitle(text="📝 Hamilton Experiment Manager"),
        c.Navbar(
            title="📝 Hamilton Experiment Manager",
            title_event=GoToEvent(url="/"),
            class_name="+ mb-4",
        ),
        c.Page(components=[*components]),
        c.Footer(
            extra_text="Powered by Hamilton",
            links=[
                c.Link(
                    components=[c.Text(text="GitHub")],
                    on_click=GoToEvent(url="https://github.com/dagworks-inc/hamilton"),
                ),
            ],
        ),
    ]


@functools.cache
def run_lookup():
    """Cache a mapping of {run_id: run} to query runs"""
    return {run.run_id: run for run in runs}


@app.get("/api/filter/{field}", response_model=SelectSearchResponse)
async def search_filter(field: str) -> SelectSearchResponse:
    """Get all the unique values for a RunMetadata field to populate menus"""
    options = {str(getattr(run, field)): getattr(run, field) for run in runs}
    return SelectSearchResponse(options=[{"label": v, "value": v} for v in options])


class RunFilter(BaseModel):
    """Filter the runs_overview() page using `experiment` and `graph_version`"""

    experiment: str = Field(
        json_schema_extra={
            "search_url": "/api/filter/experiment",
            "placeholder": "Select Experiment ...",
        }
    )
    graph_version: str = Field(
        json_schema_extra={
            "search_url": "/api/filter/graph_version",
            "placeholder": "Select Graph version ...",
        },
    )


@app.get("/api/runs", response_model=FastUI, response_model_exclude_none=True)
def runs_overview(
    experiment: Union[str, None] = None,
    graph_version: Union[int, None] = None,
) -> list[AnyComponent]:
    """RunOverview page with filters for the table"""

    # refresh cache to display new runs
    runs = get_runs(os.getenv("HAMILTON_EXPERIMENTS_PATH", ""))

    selection = dict()

    if experiment:
        selection["experiment"] = dict(value=experiment, label=experiment)

    if graph_version:
        selection["graph_version"] = dict(value=graph_version, label=str(graph_version))

    selected_runs = runs
    if selection:
        for k, v in selection.items():
            selected_runs = list(filter(lambda r: getattr(r, k) == v["value"], selected_runs))

    return base_page(
        c.ModelForm(
            model=RunFilter,
            submit_url="/runs",
            initial=selection,
            method="GOTO",
            submit_on_change=True,
            display_mode="inline",
        ),
        c.Table(
            data=selected_runs,
            data_model=RunMetadata,
            columns=[
                DisplayLookup(field="date_completed", mode=DisplayMode.datetime),
                DisplayLookup(field="experiment"),
                DisplayLookup(field="graph_version"),
                DisplayLookup(field="run_id", on_click=GoToEvent(url="/run/{run_id}/")),
            ],
        ),
    )


def run_tabs(run_id) -> list[AnyComponent]:
    """Create Metadata and Artifacts tabs for individual Run pages"""
    return [
        c.LinkList(
            links=[
                c.Link(
                    components=[c.Text(text="Metadata")],
                    on_click=GoToEvent(url=f"/run/{run_id}/"),
                    active="startswith:/run/",
                ),
                c.Link(
                    components=[c.Text(text="Artifacts")],
                    on_click=GoToEvent(url=f"/artifacts/{run_id}"),
                    active="startswith:/artifacts/",
                ),
            ],
            mode="tabs",
            class_name="+ mb-4",
        )
    ]


@app.get("/api/run/{run_id}/", response_model=FastUI, response_model_exclude_none=True)
def run_metadata(run_id: str) -> list[AnyComponent]:
    """Individual Run > Metadata"""
    run = run_lookup()[run_id]

    return base_page(
        c.Heading(text=run.experiment, level=2),
        *run_tabs(run_id=run_id),
        c.Details(
            data=run,
            fields=[
                DisplayLookup(field="experiment"),
                DisplayLookup(field="run_id"),
                DisplayLookup(field="success"),
                DisplayLookup(field="graph_hash"),
                DisplayLookup(field="modules"),
            ],
        ),
        c.Image(
            src=f"/experiments/{run.experiment}/{run.run_id}/dag.png",
            width="100%",
            height="auto",
            loading="lazy",
            referrer_policy="no-referrer",
            class_name="border rounded",
        ),
        c.Details(
            data=run,
            fields=[
                DisplayLookup(field="config", mode=DisplayMode.json),
                DisplayLookup(field="inputs", mode=DisplayMode.json),
                DisplayLookup(field="overrides", mode=DisplayMode.json),
            ],
        ),
    )


@functools.cache
def create_table_model(**kwargs):
    """Cache the creation of a Pydantic model from a DataFrame row"""
    return model_from_values("Table", specs=kwargs)


def dataframe_to_table(df: pd.DataFrame, **kwargs) -> AnyComponent:
    """Populate a FastUI table with pagination from a pandas DataFrame"""
    df = df.reset_index()
    Table = create_table_model(**{str(k): v for k, v in df.iloc[0].to_dict().items()})

    page: int = 1 if kwargs.get("page") is None else kwargs.get("page", 1)
    page_size = min(20, df.shape[0])
    page_df = df.iloc[(page - 1) * page_size : page * page_size]

    # create a Pydantic objects for each row
    data = [
        Table.model_validate({str(k): v for k, v in row.items()})
        for row in page_df.to_dict(orient="index").values()
    ]

    return [
        c.Table(
            data=data,
            data_model=Table,
            columns=[DisplayLookup(field=str(col)) for col in df.columns],
        ),
        c.Pagination(page=page, page_size=20, total=df.shape[0]),
    ]


def artifact_components(materializer: NodeMaterializer, **kwargs) -> list[AnyComponent]:
    """Create a FastUI component for an artifact based on the materializer type

    Instead of mapping Python type -> component, the materializer/file type -> component
    has a much lower and manageable cardinality
    """
    artifact_path = materializer.path.replace(base_directory, "/experiments")

    if materializer.sink == "json":
        with open(materializer.path, "r") as f:
            data = json.load(f)
        components = [c.Json(value=data)]

    elif materializer.sink == "parquet":
        data = pd.read_parquet(materializer.path)
        components = dataframe_to_table(data, **kwargs)

    elif materializer.sink == "csv":
        data = pd.read_csv(materializer.path)
        components = dataframe_to_table(data, **kwargs)

    elif materializer.sink in ["plt", "plotly"]:
        try:
            components = [
                c.Image(
                    src=artifact_path,
                    width="100%",
                    height="auto",
                    loading="lazy",
                    referrer_policy="no-referrer",
                )
            ]
        # TODO refactor to each default else case
        except Exception:
            components = [
                c.Json(
                    value={
                        k: v
                        for k, v in dict(materializer).items()
                        if k in ["path", "sink", "data_saver"]
                    }
                )
            ]

    else:
        components = [
            c.Json(
                value={
                    k: v
                    for k, v in dict(materializer).items()
                    if k in ["path", "sink", "data_saver"]
                }
            )
        ]

    return components


def artifact_tabs(run: RunMetadata) -> list[AnyComponent]:
    """Create a tab for each artifact"""
    links = []
    for i, m in enumerate(run.materialized):
        artifact_name = "-".join(m.source_nodes)
        artifact_name, _, _ = artifact_name.partition("__")
        links.append(
            c.Link(
                components=[c.Text(text=artifact_name)],
                on_click=GoToEvent(
                    url=f"/artifacts/{run.run_id}",
                    query=dict(artifact_id=i),
                ),
                active=f"startswith:/artifacts/{run.run_id}?artifact_id={i}",
            )
        )

    return [
        c.LinkList(
            links=links,
            mode="tabs",
            class_name="+ mb-4",
        )
    ]


@app.get("/api/artifacts/{run_id}", response_model=FastUI, response_model_exclude_none=True)
def run_artifacts(
    run_id: str, artifact_id: int = 0, page: Union[int, None] = None
) -> list[AnyComponent]:
    """Individual Run > Artifact"""
    run = run_lookup()[run_id]

    return base_page(
        c.Heading(text=run.experiment, level=2),
        *run_tabs(run_id=run_id),
        *artifact_tabs(run=run),
        *artifact_components(materializer=run.materialized[artifact_id], page=page),
    )


@app.get("/api/")
def landing_page() -> RedirectResponse:
    """Landing page redirects to the Run overview page"""
    return RedirectResponse(url="/api/runs")


@app.get("{path:path}")
async def html_landing() -> HTMLResponse:
    """Simple HTML page which serves the React app, comes last as it matches all paths."""
    return HTMLResponse(prebuilt_html(title="Hamilton Experiment Manager"))
