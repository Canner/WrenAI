"""`wren serve mcp` plus one MCP Apps tool, `show_html`.

The agent writes the visual (HTML, SVG, JavaScript) and Wren supplies the
rows: the tool runs the SQL through the semantic layer and the `ui://` frame
injects the result as `window.wren` before the agent's HTML runs. No chart
library is bundled; how the chart looks is up to the agent.

Run with the same arguments as `wren serve mcp`:

    uv run --no-project --with "wrenai[mcp]==0.18.0" python server/wren_apps.py --project <dir>
"""

from __future__ import annotations

import datetime as dt
import decimal
import sys
from pathlib import Path

import wren.mcp_server as wren_mcp
from mcp.types import CallToolResult, TextContent

VIEW_URI = "ui://wren/view.html"
VIEW_HTML = Path(__file__).with_name("view.html")
MAX_ROWS = 5000


def _plain(v):
    if isinstance(v, (dt.date, dt.datetime, dt.time)):
        return v.isoformat()
    if isinstance(v, decimal.Decimal):
        return float(v)
    return v


def _add_apps(mcp, ctx) -> None:
    @mcp.tool(
        title="Show a Wren query as HTML",
        meta={"ui": {"resourceUri": VIEW_URI}},
    )
    def show_html(
        sql: str, html: str, title: str | None = None, limit: int = 500
    ) -> CallToolResult:
        """Run SQL through the Wren semantic layer and show the rows with HTML you write.

        Use it when a chart or a visual table helps the user more than text.
        Write a self-contained HTML fragment (inline <style>, <svg>, <script>);
        external scripts, styles and network requests are blocked, so draw with
        SVG, canvas or plain DOM. Do not embed numbers: read the rows at run
        time from `window.wren`, which holds `columns` (names), `rows` (objects
        keyed by column) and `theme` ("light" or "dark"). Use colors that read
        in both themes. `limit` caps the rows (default 500, max 5000).

        For interaction, `window.wren` also has two async functions:
        `wren.ask(text)` sends `text` to the chat as the user's next question
        (for example on a click), and `wren.query(sql, limit)` runs SQL through
        Wren and resolves to `{columns, rows}` without involving the model (for
        filters and drill-downs). Each rejects if the host does not support it;
        `wren.host.capabilities` lists what the host supports.
        """
        limit = max(1, min(int(limit), MAX_ROWS))
        table = ctx.engine.query(sql, limit)
        rows = [{k: _plain(v) for k, v in r.items()} for r in table.to_pylist()]
        out = {"html": html, "columns": table.column_names, "rows": rows}
        if title:
            out["title"] = title
        summary = (
            f"Showed the view to the user ({len(rows)} rows; columns: "
            f"{', '.join(table.column_names)}). First rows: {rows[:8]}."
        )
        return CallToolResult(
            content=[TextContent(type="text", text=summary)], structuredContent=out
        )

    @mcp.resource(
        VIEW_URI,
        name="Wren view",
        mime_type="text/html;profile=mcp-app",
        meta={"ui": {"prefersBorder": True}},
    )
    def view() -> str:
        return VIEW_HTML.read_text()


_build_server = wren_mcp.build_server


def build_server(ctx):
    mcp = _build_server(ctx)
    _add_apps(mcp, ctx)
    return mcp


def main() -> None:
    # `wren serve mcp` builds the server through wren.mcp_server.build_server;
    # wrapping it keeps every CLI option (profiles, secrets, --no-connect).
    wren_mcp.build_server = build_server
    from wren.cli import app

    app(["serve", "mcp", "--quiet", *sys.argv[1:]], prog_name="wren")


if __name__ == "__main__":
    main()
