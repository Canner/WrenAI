from src.pipelines.indexing.project_meta import build_schema_manifest, chunk


def test_project_meta_schema_manifest_uses_deployed_mdl_identifiers():
    mdl = {
        "dataSource": "postgres",
        "models": [
            {
                "name": "PrimaryEntity",
                "columns": [
                    {"name": "VisibleField"},
                    {"name": "HiddenField", "isHidden": True},
                    {"name": "LinkedField", "relationship": "RelatedEntity"},
                ],
            }
        ],
        "views": [
            {
                "name": "SavedView",
                "properties": {
                    "columns": [
                        {"name": "ViewField"},
                    ],
                },
            }
        ],
        "metrics": [
            {
                "name": "MetricEntity",
                "dimension": [{"name": "DimensionField"}],
                "measure": [{"name": "MeasureField"}],
            }
        ],
    }

    assert build_schema_manifest(mdl) == {
        "PrimaryEntity": ["VisibleField"],
        "SavedView": ["ViewField"],
        "MetricEntity": ["DimensionField", "MeasureField"],
    }


def test_project_meta_chunk_stores_schema_manifest_with_project_scope():
    result = chunk(
        mdl={
            "dataSource": "duckdb",
            "models": [{"name": "Entity", "columns": [{"name": "Field"}]}],
        },
        project_id="project-a",
    )

    document = result["documents"][0]

    assert document.meta["data_source"] == "local_file"
    assert document.meta["project_id"] == "project-a"
    assert document.meta["schema_manifest"] == {"Entity": ["Field"]}
