"""_build_tools_section must tolerate non-str tool.description."""

from __future__ import annotations

import ast
from pathlib import Path
from types import SimpleNamespace


def _load_build_tools_section():
    path = (
        Path(__file__).resolve().parents[2]
        / "src"
        / "wren_pydantic"
        / "_instructions.py"
    )
    tree = ast.parse(path.read_text())
    fn_node = next(
        n
        for n in tree.body
        if isinstance(n, ast.FunctionDef) and n.name == "_build_tools_section"
    )
    mod = ast.Module(body=[fn_node], type_ignores=[])
    ast.fix_missing_locations(mod)
    ns: dict = {}
    exec(compile(mod, str(path), "exec"), ns)
    return ns["_build_tools_section"]


def test_build_tools_section_non_str_description():
    fn = _load_build_tools_section()
    tools = [
        SimpleNamespace(name="wren_query", description=None),
        SimpleNamespace(name="wren_store", description=42),
    ]
    out = fn(tools)
    assert "`wren_query`:" in out
    assert "`wren_store`: 42" in out
