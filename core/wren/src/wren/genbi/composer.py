"""Compose the `wren genbi build` instruction.

The CLI never builds the app — it hands the agent an authoritative,
project-hydrated build instruction (static template + live project facts +
the user's prompt, verbatim). Mirrors ``_build_base_instructions()`` /
``wren context instructions``: plain markdown on stdout.
"""

from __future__ import annotations

from pathlib import Path

# Version of the wren-core-wasm npm package this instruction targets.
# Keep in sync with core/wren-core-wasm/package.json.
WREN_CORE_WASM_VERSION = "0.4.1"

DATA_MODES = ("snapshot", "live")

_LIVE_GUIDANCE = """\
**Live mode** — the deployed app connects back to the user's own
warehouse/API at query time:

1. Write a connection config (endpoint URL only) into the app so it knows
   where to reach the data.
2. HARD RULE: warehouse credentials MUST NEVER be inlined into the app.
   The app is a public static site — anyone who opens the URL can read
   every file. Use a proxy/API with its own auth, or browser-side auth.
   `wren genbi verify` scans for inlined credentials as best-effort
   defense-in-depth — it catches common patterns but is NOT a guarantee;
   the HARD RULE above is what actually keeps secrets out.
3. The endpoint the app queries must allow the deployed origin via CORS —
   surface this requirement to the user; it is configured on their side.
"""

_SNAPSHOT_GUIDANCE = """\
**Snapshot mode** — fully serverless; data ships with the app:

1. Export the project's data (e.g. the dlt pipeline's DuckDB output) to
   parquet (or a .duckdb file) and place it inside the target folder as a
   static asset (e.g. `data/*.parquet`).
2. Point the engine profile's `source` at those static assets so the browser
   queries them client-side via wren-core-wasm. No backend is involved.
"""


def _data_mode_guidance(data_mode: str) -> str:
    if data_mode == "snapshot":
        return _SNAPSHOT_GUIDANCE
    if data_mode == "live":
        return _LIVE_GUIDANCE
    raise ValueError(f"unknown data-mode {data_mode!r}; expected one of {DATA_MODES}")


def _format_model_inventory(models: list[dict]) -> str:
    """One markdown bullet per model with its column names."""
    if not models:
        return "- (no models found — run `wren context build` first)"
    lines = []
    for model in models:
        cols = ", ".join(c.get("name", "?") for c in model.get("columns", []))
        lines.append(f"- **{model.get('name', '?')}**: {cols}")
    return "\n".join(lines)


def compose_build_instruction(
    *,
    app_name: str,
    data_mode: str,
    user_prompt: str,
    mdl_path: Path,
    app_dir: Path,
    models: list[dict],
    data_source: str,
) -> str:
    """Return the full build instruction for the agent. Pure — no IO."""
    return f"""\
# GenBI App Build Instruction

You are building a self-contained, static GenBI web app powered by
`wren-core-wasm`. The app runs the Wren engine in the browser and answers the
user's request below using this project's context layer.

## Wiring wren-core-wasm (pinned: {WREN_CORE_WASM_VERSION})

Load the engine from a shared CDN — do NOT bundle the ~68MB wasm binary into
the app folder:

```html
<script type="module">
  import {{ WrenEngine }} from
    "https://unpkg.com/@wrenai/wren-core-wasm@{WREN_CORE_WASM_VERSION}/dist/index.js";
  const engine = await WrenEngine.init();
  await engine.loadMDL(mdl, profile);   // profile: {{ source: "<url-prefix-or-empty>" }}
  const result = await engine.query(sql);
</script>
```

## Project context

- Compiled MDL: {mdl_path}
- Target folder: {app_dir} (write the app here; do not write outside it)
- Data source: {data_source}
- Data mode: {data_mode}

### Available models

{_format_model_inventory(models)}

## Data handling ({data_mode})

{_data_mode_guidance(data_mode)}

## Acceptance criteria

- The app loads its MDL and runs at least one query successfully.
- The app contains an `index.html` entry point under the target folder.
- The app answers the user request below.

## Final steps (run these after the app is written)

1. `wren genbi register {app_name} --data-mode {data_mode}`
2. `wren genbi verify {app_name}`

## User request

{user_prompt}
"""
