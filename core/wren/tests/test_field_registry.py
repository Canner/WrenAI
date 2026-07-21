"""Tests for wren.model.field_registry."""

from __future__ import annotations

import pytest

from wren.model.field_registry import (
    DATASOURCE_MODELS,
    FieldDef,
    get_datasource_options,
    get_fields,
    get_selectable_datasources,
    get_variants,
)


def test_all_datasources_covered():
    """Every entry in DATASOURCE_MODELS maps to at least one model."""
    from wren.model.data_source import DataSource  # noqa: PLC0415

    ds_names = {e.value for e in DataSource}
    registry_names = set(DATASOURCE_MODELS.keys())
    # Every DataSource enum value should have an entry in the registry.
    # (connection_url is extra — not a DataSource enum value but valid.)
    missing = ds_names - registry_names
    assert not missing, f"Datasources missing from registry: {missing}"


def test_get_datasource_options_sorted():
    opts = get_datasource_options()
    assert opts == sorted(opts)


def test_selectable_datasources_excludes_non_datasource_entries():
    """Every selectable option must be a real DataSource.

    ``connection_url`` is a registry entry but not a DataSource enum value, so a
    profile saved with ``datasource: connection_url`` can never be resolved by a
    connector.
    """
    from wren.model.data_source import DataSource  # noqa: PLC0415

    ds_names = {e.value for e in DataSource}
    selectable = get_selectable_datasources()

    assert "connection_url" not in selectable
    assert not set(selectable) - ds_names


def test_selectable_datasources_keeps_every_real_datasource():
    """Reverse anchor: filtering must not drop any genuine DataSource."""
    from wren.model.data_source import DataSource  # noqa: PLC0415

    ds_names = {e.value for e in DataSource}
    selectable = set(get_selectable_datasources())

    assert not ds_names - selectable
    assert selectable == set(get_datasource_options()) - {"connection_url"}


def test_selectable_datasources_sorted():
    opts = get_selectable_datasources()
    assert opts == sorted(opts)
    assert "postgres" in opts
    assert "bigquery" in opts
    assert "duckdb" in opts


def test_get_fields_returns_field_defs():
    fields = get_fields("postgres")
    assert isinstance(fields, list)
    assert len(fields) > 0
    assert all(isinstance(f, FieldDef) for f in fields)


def test_get_fields_postgres_names():
    names = [f.name for f in get_fields("postgres")]
    assert "host" in names
    assert "port" in names
    assert "database" in names
    assert "user" in names
    assert "password" in names
    # dict-type fields should be excluded
    assert "kwargs" not in names


def test_auto_derive_label():
    """snake_case field names auto-derive to Title Case labels."""
    fields = {f.name: f for f in get_fields("bigquery", variant="dataset")}
    assert fields["project_id"].label == "Project Id"
    assert fields["dataset_id"].label == "Dataset Id"


def test_auto_derive_password():
    """SecretStr fields auto-derive to input_type='password'."""
    fields = {f.name: f for f in get_fields("postgres")}
    assert fields["password"].input_type == "password"
    assert fields["password"].sensitive is True
    # host is plain str — it auto-derives as text, not password
    assert fields["host"].input_type == "text"
    assert fields["host"].sensitive is False


def test_auto_derive_placeholder_from_examples():
    """First example value becomes the placeholder."""
    fields = {f.name: f for f in get_fields("postgres")}
    assert fields["host"].placeholder == "localhost"
    assert fields["port"].placeholder == "5432"
    assert fields["database"].placeholder == "postgres"


def test_ui_override_bigquery_credentials():
    """BigQuery credentials field overrides to file_base64 input type."""
    fields = {f.name: f for f in get_fields("bigquery", variant="dataset")}
    creds = fields["credentials"]
    assert creds.input_type == "file_base64"
    assert creds.accept == ".json"
    assert creds.hint is not None
    assert "service account" in creds.hint.lower()


def test_datasource_override_duckdb_url():
    """duckdb datasource-level override: url label = 'Directory Path'."""
    fields = {f.name: f for f in get_fields("duckdb")}
    assert fields["url"].label == "Directory Path"
    assert fields["url"].placeholder == "/data"
    assert fields["url"].hint is not None


def test_datasource_override_duckdb_format_hidden():
    """duckdb format field is hidden with default 'duckdb'."""
    fields = {f.name: f for f in get_fields("duckdb")}
    fmt = fields["format"]
    assert fmt.input_type == "hidden"
    assert fmt.default == "duckdb"


def test_datasource_override_local_file_url():
    """local_file datasource-level override: url label = 'Root Path'."""
    fields = {f.name: f for f in get_fields("local_file")}
    assert fields["url"].label == "Root Path"
    assert fields["url"].placeholder == "/data"


def test_variants_bigquery():
    variants = get_variants("bigquery")
    assert variants == ["dataset", "project"]


def test_variants_redshift():
    variants = get_variants("redshift")
    assert variants == ["redshift", "redshift_iam"]


def test_variants_databricks():
    variants = get_variants("databricks")
    assert variants == ["token", "service_principal"]


def test_variants_postgres():
    assert get_variants("postgres") is None


def test_variants_duckdb():
    assert get_variants("duckdb") is None


def test_get_fields_bigquery_default_variant():
    """get_fields('bigquery') without variant defaults to first (dataset)."""
    fields_default = get_fields("bigquery")
    fields_dataset = get_fields("bigquery", variant="dataset")
    assert [f.name for f in fields_default] == [f.name for f in fields_dataset]
    names = [f.name for f in fields_default]
    assert "dataset_id" in names
    assert "billing_project_id" not in names


def test_get_fields_bigquery_project_variant():
    """get_fields('bigquery', variant='project') returns project-specific fields."""
    fields = {f.name: f for f in get_fields("bigquery", variant="project")}
    assert "billing_project_id" in fields
    assert "region" in fields
    assert "dataset_id" not in fields


def test_no_missing_overrides_sf_schema():
    """sf_schema has a label override (not the auto-derived 'Sf Schema')."""
    fields = {f.name: f for f in get_fields("snowflake")}
    assert fields["sf_schema"].label == "Schema"
    assert fields["sf_schema"].label != "Sf Schema"


def test_no_missing_overrides_trino_schema():
    """trino_schema has a label override (not the auto-derived 'Trino Schema')."""
    fields = {f.name: f for f in get_fields("trino")}
    assert fields["trino_schema"].label == "Schema"
    assert fields["trino_schema"].label != "Trino Schema"


def test_snowflake_sf_schema_alias():
    """sf_schema has alias 'schema' from Pydantic model."""
    fields = {f.name: f for f in get_fields("snowflake")}
    assert fields["sf_schema"].alias == "schema"


def test_hidden_discriminator_fields():
    """Literal discriminator fields (bigquery_type, etc.) are hidden."""
    bq_fields = {f.name: f for f in get_fields("bigquery", variant="dataset")}
    assert bq_fields["bigquery_type"].input_type == "hidden"
    assert bq_fields["bigquery_type"].default == "dataset"

    db_fields = {f.name: f for f in get_fields("databricks", variant="token")}
    assert db_fields["databricks_type"].input_type == "hidden"
    assert db_fields["databricks_type"].default == "token"


def test_databricks_catalog_field_is_optional():
    """Databricks catalog should be available without making old configs invalid."""
    token_fields = {f.name: f for f in get_fields("databricks", variant="token")}
    assert token_fields["catalog"].required is False
    assert token_fields["catalog"].label == "Catalog"

    sp_fields = {
        f.name: f for f in get_fields("databricks", variant="service_principal")
    }
    assert sp_fields["catalog"].required is False
    assert sp_fields["catalog"].label == "Catalog"


def test_fields_match_mcp_web_ui_postgres():
    """Regression: generated postgres fields cover all fields in old DATASOURCE_FIELDS."""
    expected_names = {"host", "port", "database", "user", "password"}
    names = {f.name for f in get_fields("postgres")}
    assert expected_names <= names


def test_fields_match_mcp_web_ui_snowflake():
    """Regression: generated snowflake fields cover all fields in old DATASOURCE_FIELDS."""
    expected_names = {"user", "password", "account", "database", "sf_schema", "warehouse"}
    names = {f.name for f in get_fields("snowflake")}
    assert expected_names <= names


def test_fields_match_mcp_web_ui_bigquery():
    """Regression: generated bigquery fields cover all fields in old DATASOURCE_FIELDS."""
    expected_names = {"project_id", "dataset_id", "credentials"}
    names = {f.name for f in get_fields("bigquery", variant="dataset")}
    assert expected_names <= names


def test_unknown_datasource_raises():
    with pytest.raises(ValueError, match="Unknown datasource"):
        get_fields("not_a_real_datasource")


def test_required_fields():
    """Required fields have required=True, optional have required=False."""
    fields = {f.name: f for f in get_fields("postgres")}
    assert fields["host"].required is True
    assert fields["port"].required is True
    # password is optional (has default=None)
    assert fields["password"].required is False


def test_dict_fields_excluded():
    """Fields with dict annotation are excluded from get_fields()."""
    for ds in ["postgres", "mysql", "clickhouse", "trino", "mssql", "snowflake"]:
        names = [f.name for f in get_fields(ds)]
        assert "kwargs" not in names, f"kwargs should be excluded for {ds}"


def test_field_def_is_frozen():
    """FieldDef dataclass is immutable (frozen=True)."""
    fields = get_fields("postgres")
    f = fields[0]
    with pytest.raises(Exception):
        f.name = "should_fail"  # type: ignore[misc]


def test_get_fields_all_datasources():
    """get_fields() succeeds for every registered datasource."""
    for ds in get_datasource_options():
        fields = get_fields(ds)
        assert isinstance(fields, list), f"Expected list for {ds}"
        assert len(fields) >= 1, f"Expected at least one field for {ds}"


def test_get_fields_all_variants():
    """get_fields() succeeds for all variants of multi-variant datasources."""
    for ds in get_datasource_options():
        variants = get_variants(ds)
        if variants:
            for v in variants:
                fields = get_fields(ds, variant=v)
                assert len(fields) >= 1, f"Expected fields for {ds}/{v}"
