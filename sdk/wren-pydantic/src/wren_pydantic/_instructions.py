"""Build a Wren-aware system prompt for Pydantic AI agents.

The workflow distilled here mirrors the Wren CLI's `wren-usage` skill —
recall → fetch context → write SQL → dry_plan if complex → execute → store —
adapted to the SDK's tool surface.

Defaults are deliberately strong ("recall by default", "store by default")
because empirical testing showed soft phrasing ("for non-trivial questions",
"when useful") was almost always interpreted by GPT-4o as "skip". The CLI
skill takes the same stance and bakes the strong defaults into its workflow.

The prompt is **derived from the actual tool list** so it stays in sync with
``toolkit.toolset(include_memory_write=...)``. If a caller hides
``wren_store_query``, the workflow drops the persistence step rather than
instructing the agent to call a tool that no longer exists.

Three markdown sections (any may be empty):
  1. Workflow rules — auto-adapted to the supplied tool list.
  2. Available tools — bullet list rendered from the same list.
  3. Project-specific instructions — content of ``<project>/instructions.md``
     when present; silently omitted when absent.
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from wren_pydantic._toolkit import WrenToolkit


_INTRO = (
    "You use Wren Engine as the semantic layer for data querying. SQL "
    "targets MDL model names (defined in `target/mdl.json`); the engine "
    "translates to the target database dialect."
)

# Workflow step blobs. Composed conditionally based on which tools are present.
_STEP_RECALL = """1. Recall similar past NL→SQL pairs:
   `wren_recall_queries(question="<user's question>", limit=3)`
   Use the results as few-shot examples. Empty results are fine — continue
   to the next step. Do NOT skip this step on the grounds that the question
   seems simple; past pairs may use better joins, filters, or column names
   than you would write from scratch."""

_STEP_FETCH = """2. Fetch schema and business context:
   `wren_fetch_context(question="<user's question>")`
   Optionally narrow scope with `model="<name>"` or
   `item_type="model" | "column" | "relationship" | "view"`."""

_STEP_LIST_MODELS_FALLBACK = """1. If you don't already know the available models, call `wren_list_models()`
   to enumerate them."""

_STEP_COMPOSE = (
    "{n}. Compose SQL targeting Wren model names — NEVER raw database tables."
)

_STEP_DRY_PLAN = """{n}. (Complex queries only) Verify with `wren_dry_plan(sql="...")` before
   executing. "Complex" = subqueries, multi-step CTEs, or JOINs not
   already defined as MDL relationships. Simple GROUP BY or
   model-defined JOINs can skip this step."""

_STEP_QUERY = """{n}. Execute: `wren_query(sql="...", limit=100)`. Raise the limit only when
   you genuinely need more rows."""

_STEP_STORE = """{n}. Persist the NL→SQL pair: `wren_store_query(nl="<user's original \
question>", sql="<the SQL you ran>", tags=[...])`.

   Store BY DEFAULT after a successful query. Skip ONLY when:
   - The query failed (`ok=false`).
   - The user said the result is wrong.
   - The SQL is exploratory (e.g. `SELECT * FROM x LIMIT 10` with no
     analytical clauses).
   - There is no natural-language question (e.g. the user pasted raw SQL).
   - The user explicitly said don't save.

   The `nl` value should be the user's original question, not a paraphrase."""


def _build_workflow_section(tool_names: set[str]) -> str:
    """Compose the workflow header from tool blobs based on which tools are
    actually available. Numbering is dynamic so steps stay sequential when
    optional ones are dropped."""
    has_recall = "wren_recall_queries" in tool_names
    has_fetch = "wren_fetch_context" in tool_names
    has_store = "wren_store_query" in tool_names
    has_dry_plan = "wren_dry_plan" in tool_names
    has_list_models = "wren_list_models" in tool_names

    steps: list[str] = []
    if has_recall:
        steps.append(_STEP_RECALL)
    if has_fetch:
        steps.append(_STEP_FETCH)
    elif has_list_models and not has_recall:
        steps.append(_STEP_LIST_MODELS_FALLBACK)

    next_n = len(steps) + 1
    steps.append(_STEP_COMPOSE.format(n=next_n))
    next_n += 1
    if has_dry_plan:
        steps.append(_STEP_DRY_PLAN.format(n=next_n))
        next_n += 1
    steps.append(_STEP_QUERY.format(n=next_n))
    next_n += 1
    if has_store:
        steps.append(_STEP_STORE.format(n=next_n))

    intro = "Run these steps in order:" if len(steps) > 2 else ""
    body = "\n\n".join(steps)
    if intro:
        body = f"{intro}\n\n{body}"
    return f"# Workflow for every data question\n\n{body}"


def _error_recovery_section(*, has_fetch_context: bool, has_list_models: bool) -> str:
    if has_fetch_context:
        find_name_hint = (
            'use `wren_fetch_context(question="<bad name>", '
            'item_type="model")` (or `item_type="column"`) to find the '
            "correct one."
        )
    elif has_list_models:
        find_name_hint = (
            "use `wren_list_models()` to enumerate models and inspect their columns."
        )
    else:
        find_name_hint = "consult the project's MDL files directly."
    return f"""# Error recovery

If a tool returns `ok=false`, inspect `error.phase` and `error.message`:

- `SQL_PARSING` → SQL syntax error. Read the message, fix, and retry.
- `METADATA_FETCHING` / `MDL_EXTRACTION` → wrong model or column name;
  {find_name_hint}
- `SQL_EXECUTION` → database-side error. `error.metadata.dialect_sql` shows
  the translated SQL — diagnose against the message (type mismatch, missing
  function, permission, timeout). Add explicit `CAST` or simplify the query
  if needed.

Don't silently abandon. Either fix and retry, or report the failure to the
user along with what you tried."""


def _things_to_avoid_section(tool_names: set[str]) -> str:
    bullets = []
    if "wren_fetch_context" in tool_names:
        bullets.append(
            "- Don't guess model or column names — call `wren_fetch_context` first."
        )
    elif "wren_list_models" in tool_names:
        bullets.append(
            "- Don't guess model or column names — call `wren_list_models()` "
            "first when in doubt."
        )
    if "wren_recall_queries" in tool_names:
        bullets.append(
            '- Don\'t skip `wren_recall_queries` on questions that seem "simple" — '
            "past pairs are often the most accurate template."
        )
    if "wren_store_query" in tool_names:
        bullets.append(
            "- Don't store failed queries, queries the user said are wrong, "
            "or exploratory queries."
        )
        bullets.append("- Don't store SQL that has no clear natural-language question.")
    bullets.append(
        "- Don't write SQL against raw database tables — always use MDL model names."
    )
    return "# Things to avoid\n\n" + "\n".join(bullets)


def build_instructions(toolkit: WrenToolkit, *, toolset: object | None = None) -> str:
    """Render the instructions prompt.

    ``toolset`` is the Pydantic AI ``FunctionToolset`` actually given to
    the agent. When ``None``, the toolkit's default ``toolset()`` output
    is used. Pass the same toolset you give to ``Agent(toolsets=...)`` so
    the instructions stay in sync — e.g., when
    ``include_memory_write=False`` drops ``wren_store_query``, the
    workflow's persistence step drops too.
    """
    if toolset is None:
        toolset = toolkit.toolset()
    tool_list = _extract_tool_list(toolset)
    tool_names = {t.name for t in tool_list}

    sections: list[str] = [_INTRO]
    sections.append(_build_workflow_section(tool_names))
    sections.append(
        _error_recovery_section(
            has_fetch_context="wren_fetch_context" in tool_names,
            has_list_models="wren_list_models" in tool_names,
        )
    )
    sections.append(_things_to_avoid_section(tool_names))

    tools_section = _build_tools_section(tool_list)
    if tools_section:
        sections.append(tools_section)

    instructions_section = _build_instructions_section(toolkit._project_path)
    if instructions_section:
        sections.append(instructions_section)

    return "\n\n".join(sections)


def _extract_tool_list(toolset: object) -> list:
    """Pull the registered tools from a Pydantic AI FunctionToolset as a list.

    Pydantic AI stores tools in ``toolset.tools`` (dict) or ``._tools``;
    both forms are tolerated.
    """
    tools_attr = getattr(toolset, "tools", None)
    if tools_attr is None:
        tools_attr = getattr(toolset, "_tools", None)
    if tools_attr is None:
        return []
    if isinstance(tools_attr, dict):
        return list(tools_attr.values())
    return list(tools_attr)


def _build_tools_section(tool_list: list) -> str:
    if not tool_list:
        return ""
    lines = ["## Available tools"]
    for tool in tool_list:
        description = (tool.description or "").strip().split("\n")[0]
        lines.append(f"- `{tool.name}`: {description}")
    return "\n".join(lines)


def _build_instructions_section(project_path: Path) -> str:
    instructions_file = project_path / "instructions.md"
    if not instructions_file.exists():
        return ""
    body = instructions_file.read_text().strip()
    if not body:
        return ""
    return f"## Project-specific instructions\n\n{body}"
