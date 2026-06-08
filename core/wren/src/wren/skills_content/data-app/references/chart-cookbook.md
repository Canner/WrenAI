# Chart cookbook

Pick a `chart=` for `cube_panel` by the shape of the answer. Bias toward the
native chart types below — they're reliable and need no extra config. Reach for
a custom chart only when none fit (and then prefer a `raw_panel` + a Streamlit
chart you control).

| Want to show | dimensions / measures | `chart=` |
|---|---|---|
| A single headline number (KPI) | 1 measure, no dimension | `metric` |
| Trend over time | 1 time dimension + 1 measure | `line` |
| Cumulative / volume over time | 1 time dimension + 1 measure | `area` |
| Compare a measure across categories | 1 dimension + 1 measure | `bar` |
| Raw rows / multi-column breakdown | any | `table` |

Guidelines:

- **Time on the x-axis** → `line` (or `area` for volume). Use a `time_dimension`
  with a `granularity` (`day` / `week` / `month` / `quarter` / `year`), not a
  plain dimension, so the engine buckets correctly.
- **Categories** (region, status, product) → `bar`. Keep the category count
  modest; for high-cardinality dimensions prefer `table` or add a filter.
- **One number** → `metric`. Pair with a delta later if the user wants change vs
  a prior period.
- **"Just show me the data"** → `table`.

Interactive switching is free once a panel is cube-backed: bind the dimension or
the time granularity to a `st.selectbox` and the same chart re-queries. Let the
user flip dimensions rather than building one panel per dimension.

When the request can't be a cube query (window functions, joins across cubes,
row-level detail), use `raw_panel(sql=..., chart=..., x=..., y=...)`. It's static
(no widget-driven structural change) and dry-plan validated before it runs.
