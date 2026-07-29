"""cube list must tolerate non-dict cubes and non-list measure arrays."""

from types import SimpleNamespace
from unittest.mock import patch

from typer.testing import CliRunner

from wren.cube_cli import cube_app


def test_list_cubes_skips_bad_rows(capsys):
    manifest = {
        "cubes": [
            "bad",
            {
                "name": "orders",
                "baseObject": "o",
                "measures": "nope",
                "dimensions": [{"name": "id"}],
                "timeDimensions": [None, {"name": "ts"}],
            },
        ]
    }
    with patch("wren.cube_cli._load_manifest_dict", return_value=manifest):
        runner = CliRunner()
        result = runner.invoke(cube_app, ["list"])
    assert result.exit_code == 0
    out = result.stdout
    assert "orders" in out
    assert "dimensions: id" in out
    assert "time dimensions: ts" in out
