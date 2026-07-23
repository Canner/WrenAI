"""_build_tools_section must tolerate non-str tool.description and bad names."""

from __future__ import annotations

import ast
from pathlib import Path
from types import SimpleNamespace


def _load_build_tools_section():
    path = Path(__file__).resolve().parents[2] / "src" / "wren_langchain" / "_prompt.py"
    tree = ast.parse(path.read_text())
    wanted = {"_tool_name", "_build_tools_section"}
    nodes = [
        n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in wanted
    ]
    mod = ast.Module(body=nodes, type_ignores=[])
    ast.fix_missing_locations(mod)
    ns: dict = {}
    exec(compile(mod, str(path), "exec"), ns)
    return ns["_build_tools_section"]


def test_build_tools_section_non_str_description():
    fn = _load_build_tools_section()
    tools = [
        SimpleNamespace(name="wren_query", description=None),
        SimpleNamespace(name="wren_store", description=42),
        SimpleNamespace(name="wren_ok", description="line1\nline2"),
    ]
    out = fn(tools)
    assert "- `wren_query`: " in out.splitlines()
    assert "`wren_store`: 42" in out
    assert "`wren_ok`: line1" in out
    assert "line2" not in out


def test_build_tools_section_name_fallbacks():
    fn = _load_build_tools_section()

    class NoName:
        description = "no name attr"
        __name__ = "dunder_name"

    tools = [
        SimpleNamespace(name=None, description="null name"),
        SimpleNamespace(name="", description="empty name"),
        SimpleNamespace(name=123, description="numeric name"),
        NoName(),
    ]
    out = fn(tools)
    # None / empty / non-str names with no __name__ fall back to "tool"
    assert "`tool`: null name" in out
    assert "`tool`: empty name" in out
    assert "`tool`: numeric name" in out
    # missing name attr falls back to __name__
    assert "`dunder_name`: no name attr" in out
