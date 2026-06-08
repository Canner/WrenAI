"""Static extraction of cube panels from a generated app's source.

``wren genbi check`` needs to know which cube/measures/dimensions an app
references without executing it. We parse ``app.py`` with :mod:`ast` and read
the keyword arguments of every ``cube_panel(...)`` call. Dimensions bound to a
selectbox/radio widget (``dimensions=[dim]`` where ``dim = st.selectbox(..., [options])``)
are expanded to all of the widget's literal options, so the entire reachable
dimension set is validated — not just the default.
"""

from __future__ import annotations

import ast

from wren.genbi.check import PanelSpec

_WIDGET_FUNCS = {"selectbox", "radio", "select_slider"}


def extract_panel_specs(source: str) -> list[PanelSpec]:
    """Return a PanelSpec for every ``cube_panel(...)`` call in *source*.

    Best-effort and static: anything not resolvable to literals is skipped
    rather than guessed. Returns ``[]`` on a syntax error.
    """
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return []

    widget_options = _collect_widget_options(tree)

    specs: list[PanelSpec] = []
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Call) and _is_call_named(node, "cube_panel")):
            continue
        kwargs = {kw.arg: kw.value for kw in node.keywords if kw.arg}
        cube = _str_literal(kwargs.get("cube"))
        if cube is None:
            continue
        specs.append(
            PanelSpec(
                cube=cube,
                measures=_str_list(kwargs.get("measures")),
                dimensions=_str_list(kwargs.get("dimensions"), widget_options),
                time_dimensions=_time_dimension_names(kwargs.get("time_dimension")),
            )
        )
    return specs


def _collect_widget_options(tree: ast.AST) -> dict[str, list[str]]:
    """Map ``name -> [option literals]`` for ``name = st.selectbox(..., [opts])``."""
    options: dict[str, list[str]] = {}
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Assign) and len(node.targets) == 1):
            continue
        target = node.targets[0]
        if not isinstance(target, ast.Name):
            continue
        call = node.value
        if not (isinstance(call, ast.Call) and _is_widget_call(call)):
            continue
        opts = _widget_option_list(call)
        if opts:
            options[target.id] = opts
    return options


def _is_widget_call(call: ast.Call) -> bool:
    return isinstance(call.func, ast.Attribute) and call.func.attr in _WIDGET_FUNCS


def _widget_option_list(call: ast.Call) -> list[str]:
    """Options are the 2nd positional arg or the ``options=`` keyword."""
    node = None
    if len(call.args) >= 2:
        node = call.args[1]
    for kw in call.keywords:
        if kw.arg == "options":
            node = kw.value
    return _str_list(node)


def _is_call_named(call: ast.Call, name: str) -> bool:
    func = call.func
    if isinstance(func, ast.Name):
        return func.id == name
    if isinstance(func, ast.Attribute):
        return func.attr == name
    return False


def _str_literal(node: ast.AST | None) -> str | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return None


def _str_list(
    node: ast.AST | None, widget_options: dict[str, list[str]] | None = None
) -> list[str]:
    """Flatten a list node to string literals, expanding widget-bound names."""
    if not isinstance(node, (ast.List, ast.Tuple)):
        return []
    out: list[str] = []
    for elt in node.elts:
        lit = _str_literal(elt)
        if lit is not None:
            out.append(lit)
        elif (
            widget_options is not None
            and isinstance(elt, ast.Name)
            and elt.id in widget_options
        ):
            out.extend(widget_options[elt.id])
    return out


def _time_dimension_names(node: ast.AST | None) -> list[str]:
    """Extract the ``dimension`` value from a ``time_dimension={...}`` dict."""
    if not isinstance(node, ast.Dict):
        return []
    for key, value in zip(node.keys, node.values):
        if _str_literal(key) == "dimension":
            name = _str_literal(value)
            return [name] if name else []
    return []
