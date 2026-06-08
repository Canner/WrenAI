---
name: data-app
description: "Build an interactive data app (dashboard) from natural language using the wren CLI + Streamlit, hosted locally, and hand the user a http://localhost:<port> URL. Use when: the user asks to build a dashboard, data app, BI app, or report UI; says 'make me a dashboard', 'build a data app', 'visualize this', 'a chart I can filter', 'let me switch dimensions / change the date range'; or wants an interactive, shareable view over data already modeled in a Wren project. Runs only where the agent is on the user's own machine (Claude Code / IDE) so localhost is reachable."
license: Apache-2.0
metadata:
  author: wrenai
---

# Wren GenBI — Build a Data App (Agent Workflow Guide)

> Served by the `wren` CLI (`wren skills get data-app`), so it always matches your
> installed wren-engine version. Pull the reference docs with
> `wren skills get data-app --full`.

You turn a natural-language request into a **running Streamlit data app on the
user's machine** and hand back a clickable `http://localhost:<port>` URL. The
data path goes through the Wren semantic layer, so every query stays governed.

## Preflight

1. Confirm the `genbi` extra is installed: `wren genbi --help`. If it errors,
   tell the user to `pip install "wrenai[genbi]"`.
2. Confirm a **built** Wren project exists: `wren context show` (needs
   `target/mdl.json`). If not, route to the `generate-mdl` skill first.
3. This feature only works when **you are running on the user's own machine**
   (Claude Code / IDE). In a cloud sandbox, `localhost` is not reachable by the
   user — say so instead of pretending.

## Step 1 — Decide the panel type (the key decision)

For each chart the user wants, decide whether it is **cube-expressible**:
a query of *measures + dimensions + filters over a single cube*.

- **Cube-expressible** (e.g. "revenue by region", "orders per month", "count by
  status") → use `cube_panel`. This is the default and the only path that stays
  governed and supports interactive dimension/filter switching.
- **Not cube-expressible** (window functions, cross-cube joins, row-level
  detail) → use `raw_panel` (static, dry-plan validated).

Interactive dashboards need a **cube**. Check `wren cube list`:
- If the needed cube is missing, route to the `enrich-context` skill to define
  it (e.g. an ARR / revenue cube), then `wren context build`, then come back.
- `wren genbi create <name> --cube <cube>` validates the cube exists and refuses
  with guidance if it doesn't.

Gather real names so you don't hallucinate columns: `wren cube describe <cube>`
(measures, dimensions, timeDimensions) and `wren context show`.

## Step 2 — Create and serve a stub first (hand back a URL fast)

```
wren genbi create <name> --cube <cube> -d "<one-line description>"
wren genbi serve <name> --json     # → {"url": "http://localhost:8512", ...}
```

`serve` picks a free port, launches Streamlit headless and detached, polls the
health endpoint, and prints the URL. **Immediately tell the user the URL** — the
skeleton is already live; you'll fill it in next.

## Step 3 — Write the panels in app.py

Edit `apps/<name>/app.py`. Write **freeform Streamlit layout**, but route every
chart's data through the helpers — never hand-build SQL or interpolate widget
values into SQL strings.

```python
import streamlit as st
from wren.genbi.panel import cube_panel, raw_panel

st.title("Revenue")

# Interactive, cube-backed: bind a widget to the spec, not to SQL text.
dim = st.selectbox("Group by", ["region", "category"])
start, end = st.date_input("Date range", [])
cube_panel(
    cube="sales",
    measures=["revenue"],
    dimensions=[dim],
    time_dimension={"dimension": "order_date", "granularity": "month"},
    chart="bar",            # bar | line | area | metric | table
    title="Revenue",
)

# Escape hatch for a complex, static query a cube can't express:
raw_panel(sql="SELECT month, revenue, AVG(revenue) OVER (...) FROM ...",
          chart="line", x="month", y="revenue")
```

Saving the file **hot-reloads in place** (`runOnSave`) — the URL/port stay the
same, so the user's open tab just updates. Never run `streamlit` yourself and
never restart the server to apply edits; always go through `wren genbi`.

See `wren skills get data-app --full` for the SDK recipe and a chart cookbook.

## Step 4 — Verify (don't guess)

```
wren genbi check <name>      # declared cubes/dimensions still match the MDL?
wren genbi status <name> --json   # running? url? last error?
wren genbi logs <name> -n 50      # read a traceback, fix, save (hot-reloads)
```

`check` statically reads the `cube_panel(...)` calls in `app.py` — there is no
sidecar to maintain. `serve` runs it automatically and refuses to start a drifted
app, naming exactly what's missing.

## Step 5 — Iterate by natural language

Further requests ("make it a line chart", "add a status filter", "switch to
weekly") are just edits to `app.py` → hot-reload → same URL updates. For a second
dashboard, `create` + `serve` another app; both coexist on different ports.
`wren genbi list` shows everything; `wren genbi stop <name>` (or `--all`) tears
them down. Apps persist on disk under `apps/<name>/` (committable); after a
reboot, `wren genbi list` then `serve <name>` brings one back.

## Guardrails

- Never put DB credentials in the app or `.streamlit/secrets.toml`; the app
  inherits the project's profile/`.env` automatically.
- Keep the data path in `cube_panel` / `raw_panel`. Raw `engine.query` with
  string-formatted user input is forbidden (injection + ungoverned).
- One app = one page under `apps/<name>/`. Multi-page apps are out of scope.
