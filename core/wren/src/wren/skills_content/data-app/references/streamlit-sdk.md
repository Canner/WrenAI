# Streamlit + Wren SDK recipe

How a generated `app.py` reaches data. You normally don't write this plumbing —
`cube_panel` / `raw_panel` do it — but this is what happens underneath.

## The governed data path

```
cube spec (dict)
  → cube_query_to_sql(spec_json, manifest_json)   # closed vocabulary, no string interpolation
  → WrenEngine.query(sql).to_pandas()             # strict_mode / denied_functions apply
  → pandas DataFrame → st chart
```

`cube_panel` resolves the engine and manifest once per session:

- `wren.genbi.app_runtime.get_manifest_json()` reads `<project>/target/mdl.json`.
- `wren.genbi.app_runtime.get_engine()` builds a `WrenEngine` from the active /
  project-pinned profile, cached with `st.cache_resource`.

Because `wren genbi serve` launches Streamlit with the **project root as CWD**,
the app discovers the project's `.env` and the profile's `${VAR}` secrets expand
at connection time. Secrets never live in the app directory.

## Caching & freshness

`cube_panel` wraps each query in `st.cache_data(ttl=...)`, shows a "Last updated"
timestamp, and offers a Refresh button that clears that panel's cache. Tune with
`cube_panel(..., ttl=<seconds>)`. Don't add your own uncached `engine.query`
calls in a rerun-heavy app — every widget interaction reruns the whole script.

## Widgets drive the spec, not the SQL

Interactive controls must change **spec fields** (`dimensions`, `filters`,
`timeDimensions`), which can only contain names defined on the cube:

```python
dim = st.selectbox("Group by", ["region", "category"])   # closed list you chose
cube_panel(cube="sales", measures=["revenue"], dimensions=[dim])
```

`wren genbi check` statically reads these calls. A selectbox-bound dimension is
expanded to all its options, so every reachable dimension is validated against
the MDL — keep the options list a literal so the check can see it.

## Filters and time

```python
cube_panel(
    cube="sales",
    measures=["order_count"],
    dimensions=["status"],
    filters=[{"dimension": "status", "operator": "eq", "value": "completed"}],
    time_dimension={"dimension": "order_date", "granularity": "month",
                    "dateRange": ["2026-01-01", "2026-03-31"]},
)
```

Filter operators mirror `wren cube` (`eq`, `in`, `not_in`, `gt`, `lt`,
`is_null`, …). The engine is responsible for safely binding filter values.
