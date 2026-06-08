"""The cube-spec data path shipped to generated apps as ``cube_panel``.

Generated ``app.py`` files write freeform Streamlit layout, but every cube
panel's *data* goes through here: widget values mutate a cube query spec, the
spec is transpiled to governed SQL via ``cube_query_to_sql`` (closed vocabulary,
no string interpolation), executed through ``WrenEngine``, cached, and rendered
with a "last updated" stamp and a refresh control.

The spec-building and transpile functions are pure and import-safe without
Streamlit; ``cube_panel`` imports Streamlit and the engine lazily.
"""

from __future__ import annotations

import json
from typing import Any


def build_cube_query(
    *,
    cube: str,
    measures: list[str],
    dimensions: list[str] | None = None,
    time_dimension: dict[str, Any] | None = None,
    filters: list[dict[str, Any]] | None = None,
    limit: int | None = None,
    offset: int | None = None,
) -> dict[str, Any]:
    """Assemble a cube query dict, omitting empty optional keys."""
    q: dict[str, Any] = {"cube": cube, "measures": list(measures)}
    if dimensions:
        q["dimensions"] = list(dimensions)
    if time_dimension:
        q["timeDimensions"] = [time_dimension]
    if filters:
        q["filters"] = list(filters)
    if limit is not None:
        q["limit"] = limit
    if offset is not None:
        q["offset"] = offset
    return q


def spec_to_sql(query: dict[str, Any], manifest_json: str) -> str:
    """Transpile a cube query dict to governed SQL via the wren-core binding.

    Raises if the query references measures/dimensions not defined on the cube —
    the governance boundary that makes the reachable query space closed.
    """
    from wren_core import cube_query_to_sql  # noqa: PLC0415

    return cube_query_to_sql(json.dumps(query), manifest_json)


def validate_raw_sql(engine, sql: str) -> None:
    """Validate a raw-SQL escape-hatch panel at build time.

    Raw panels are for queries a cube can't express (window functions, cross-cube
    joins, row-level detail). They still go through the semantic layer: this
    dry-plans the SQL (I/O-free) so a broken or ungoverned query is rejected
    before it reaches a running app. Raises on invalid SQL.
    """
    engine.dry_plan(sql)


def cube_panel(
    *,
    cube: str,
    measures: list[str],
    dimensions: list[str] | None = None,
    time_dimension: dict[str, Any] | None = None,
    filters: list[dict[str, Any]] | None = None,
    chart: str = "bar",
    title: str | None = None,
    ttl: int = 600,
    limit: int | None = None,
) -> None:
    """Render one cube-backed panel: governed query → cache → chart + freshness.

    Intended for use inside a generated Streamlit ``app.py``.
    """
    import datetime as _dt  # noqa: PLC0415

    import streamlit as st  # noqa: PLC0415

    from wren.genbi.app_runtime import get_engine, get_manifest_json  # noqa: PLC0415

    manifest_json = get_manifest_json()
    engine = get_engine()

    if title:
        st.subheader(title)

    query = build_cube_query(
        cube=cube,
        measures=measures,
        dimensions=dimensions,
        time_dimension=time_dimension,
        filters=filters,
        limit=limit,
    )

    @st.cache_data(ttl=ttl, show_spinner=False)
    def _run(query_json: str) -> tuple[Any, str]:
        sql = spec_to_sql(json.loads(query_json), manifest_json)
        df = engine.query(sql).to_pandas()
        return df, _dt.datetime.now().isoformat(timespec="seconds")

    query_json = json.dumps(query, sort_keys=True)
    cols = st.columns([4, 1])
    with cols[1]:
        if st.button("Refresh", key=f"refresh-{query_json}"):
            _run.clear()

    try:
        df, fetched_at = _run(query_json)
    except Exception as exc:  # surface, don't swallow — the agent reads this
        st.error(f"Query failed: {exc}")
        return

    _render_chart(st, df, chart, dimensions, measures)
    st.caption(f"Last updated {fetched_at}")


def _render_chart(st, df, chart, dimensions, measures) -> None:
    """Render *df* with a native Streamlit chart picked by *chart*."""
    x = dimensions[0] if dimensions else None
    y = measures[0] if measures else None
    if chart == "line":
        st.line_chart(df, x=x, y=y)
    elif chart == "area":
        st.area_chart(df, x=x, y=y)
    elif chart == "metric" and y is not None and not df.empty:
        st.metric(label=y, value=df[y].iloc[0])
    elif chart == "table":
        st.dataframe(df, use_container_width=True)
    else:  # default: bar
        st.bar_chart(df, x=x, y=y)


def raw_panel(
    *,
    sql: str,
    chart: str = "table",
    x: str | None = None,
    y: str | None = None,
    title: str | None = None,
    ttl: int = 600,
) -> None:
    """Escape-hatch panel for queries a cube can't express.

    The SQL still runs through ``WrenEngine`` (so MDL governance applies) and is
    dry-planned once up front. Unlike :func:`cube_panel`, a raw panel is static:
    it has no widget-driven structural variation.
    """
    import datetime as _dt  # noqa: PLC0415

    import streamlit as st  # noqa: PLC0415

    from wren.genbi.app_runtime import get_engine  # noqa: PLC0415

    engine = get_engine()
    if title:
        st.subheader(title)

    @st.cache_data(ttl=ttl, show_spinner=False)
    def _run(sql_text: str) -> tuple[Any, str]:
        validate_raw_sql(engine, sql_text)
        df = engine.query(sql_text).to_pandas()
        return df, _dt.datetime.now().isoformat(timespec="seconds")

    try:
        df, fetched_at = _run(sql)
    except Exception as exc:
        st.error(f"Query failed: {exc}")
        return

    _render_chart(st, df, chart, [x] if x else None, [y] if y else None)
    st.caption(f"Last updated {fetched_at}")
