import importlib.util
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[2]
_PATH = _ROOT / "src" / "wren_langchain" / "_format.py"
_spec = importlib.util.spec_from_file_location("_fmt", _PATH)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)


def test_skips_non_dict_and_bad_nested():
    out = _mod.format_list_models_content(
        {
            "models": [
                None,
                "x",
                {
                    "name": "ok",
                    "columns": None,
                    "properties": "bad",
                    "description": "d",
                },
                {
                    "name": "wide",
                    "columns": [1, 2],
                    "properties": {"description": "y" * 100},
                },
            ]
        }
    )
    assert "| ok |" in out
    assert "| wide |" in out
    assert "None" not in out.split("\n")[2]
    assert "..." in out
