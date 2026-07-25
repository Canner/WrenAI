from pathlib import Path

import yaml

from wren.genbi.index import get_app, load_index, save_index


def test_get_app_skips_non_dict_entry(tmp_path: Path):
    idx = {"schema_version": 1, "apps": {"bad": "not-a-map", "good": {"source": "apps/good"}}}
    save_index(tmp_path, idx)
    assert get_app(tmp_path, "bad") is None
    assert get_app(tmp_path, "good") == {"source": "apps/good"}
    assert get_app(tmp_path, "missing") is None
