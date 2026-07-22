"""_run_list_models skips non-dict / incomplete model rows."""
import ast
import importlib.util
import sys
import types
from pathlib import Path
from unittest.mock import MagicMock

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "src"

# Stub heavy deps before loading _tools
sys.path.insert(0, str(SRC))

# Provide minimal ModelSummary used by _tools
models_mod = types.ModuleType("wren_pydantic._models")


class ModelSummary:
    def __init__(self, name, column_count, description=None):
        self.name = name
        self.column_count = column_count
        self.description = description


models_mod.ModelSummary = ModelSummary
sys.modules["wren_pydantic._models"] = models_mod

# Other imports in _tools — stub at package boundary by executing only the function
# Extract function source with ast and exec in isolation is heavy; load module with stubs.

for name in [
    "wren",
    "wren.model",
    "wren.model.error",
    "wren.engine",
    "pydantic_ai",
    "pydantic_ai.exceptions",
    "wren_pydantic",
    "wren_pydantic._errors",
    "wren_pydantic._toolkit",
]:
    sys.modules.setdefault(name, types.ModuleType(name))

sys.modules["wren.model.error"].WrenError = type("WrenError", (Exception,), {})
sys.modules["wren_pydantic._errors"].should_propagate = lambda e: False
sys.modules["wren_pydantic._errors"].to_model_retry = lambda e: e

# _tools imports many symbols — read file and exec just _run_list_models after injecting names
src = (SRC / "wren_pydantic" / "_tools.py").read_text()
# Pull the function body by line markers
start = src.index("def _run_list_models")
# until next top-level def at same indent
rest = src[start:]
lines = rest.splitlines(True)
body = [lines[0]]
for line in lines[1:]:
    if line.startswith("def ") or line.startswith("async def ") or line.startswith("class "):
        break
    body.append(line)
code = "".join(body)
ns = {
    "ModelSummary": ModelSummary,
    "WrenError": sys.modules["wren.model.error"].WrenError,
    "should_propagate": sys.modules["wren_pydantic._errors"].should_propagate,
    "to_model_retry": sys.modules["wren_pydantic._errors"].to_model_retry,
    "list": list,
}
exec(code, ns)
_run_list_models = ns["_run_list_models"]


def test_skips_bad_models():
    toolkit = MagicMock()
    toolkit._mdl_source.load_manifest.return_value = {
        "models": [
            None,
            "x",
            {"columns": []},  # no name
            {"name": "ok", "columns": None, "properties": "nope"},
            {"name": "t", "columns": [{"n": 1}], "properties": {"description": "d"}},
        ]
    }
    out = _run_list_models(toolkit)
    assert [m.name for m in out] == ["ok", "t"]
    assert out[0].column_count == 0
    assert out[1].column_count == 1
    assert out[1].description == "d"
