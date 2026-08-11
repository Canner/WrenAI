"""genbi list must tolerate non-dict apps.yml entries and non-dict deploy blocks."""

from pathlib import Path

from typer.testing import CliRunner

from wren.genbi.cli import genbi_app
from wren.genbi.index import save_index


def test_list_reports_non_dict_entry(tmp_path: Path) -> None:
    (tmp_path / "wren_project.yml").write_text("name: t\n")
    save_index(
        tmp_path,
        {
            "schema_version": 1,
            "apps": {
                "good": {"data_mode": "snapshot", "status": "ready"},
                "bad": "not-a-mapping",
            },
        },
    )
    result = CliRunner().invoke(genbi_app, ["list", "--path", str(tmp_path)])
    assert result.exit_code == 0
    assert "good" in result.stdout
    assert "invalid entry" in result.stderr
    assert "invalid entry" not in result.stdout


def test_list_tolerates_non_dict_deploy_block(tmp_path: Path) -> None:
    (tmp_path / "wren_project.yml").write_text("name: t\n")
    save_index(
        tmp_path,
        {
            "schema_version": 1,
            "apps": {
                "good": {
                    "source": "apps/good",
                    "status": "deployed",
                    "deploy": "https://x",
                }
            },
        },
    )
    result = CliRunner().invoke(genbi_app, ["list", "--path", str(tmp_path)])
    assert result.exit_code == 0, result.exception
    assert "good" in result.stdout
    assert "https://x" not in result.stdout

