"""Unit tests for the OpenMetadata importer, replaying recorded API responses.

The fixtures under ``tests/fixtures/openmetadata`` were recorded from an
OpenMetadata 2.0.5 docker quickstart that ingested a sample Postgres
database (service ``shop_pg``, database ``shop``). See the fixture README.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml
from typer.testing import CliRunner

from wren import openmetadata
from wren.cli import app
from wren.openmetadata import (
    OpenMetadataClient,
    OpenMetadataError,
    OpenMetadataSelection,
    build_fqn,
    convert_openmetadata_tables,
    import_openmetadata_project,
    is_tested_server_version,
    map_service_type_to_wren,
    split_fqn,
)

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "openmetadata"
SERVICE = "shop_pg"
DATABASE = "shop"

runner = CliRunner()


def _load(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text())


class _Response:
    def __init__(self, payload: dict | None, status_code: int = 200) -> None:
        self._payload = payload
        self.status_code = status_code
        self.text = json.dumps(payload)

    def json(self) -> dict:
        return self._payload


class RecordedSession:
    """Serves recorded OpenMetadata responses keyed by API path and cursor."""

    def __init__(self, status_code: int = 200) -> None:
        self.calls: list[tuple[str, dict]] = []
        self.status_code = status_code

    def get(self, url: str, *, headers=None, params=None, timeout=None):
        self.calls.append((url, dict(params or {})))
        assert headers == {"Authorization": "Bearer test-token"}
        if self.status_code != 200:
            return _Response({"message": "nope"}, self.status_code)
        path = url.split("/api/v1", 1)[1]
        if path == "/system/version":
            return _Response(_load("system_version.json"))
        if path == f"/services/databaseServices/name/{SERVICE}":
            return _Response(_load("database_service.json"))
        if path == "/tables":
            page = "tables_page_2.json" if params.get("after") else "tables_page_1.json"
            return _Response(_load(page))
        return _Response({"message": f"unrecorded path {path}"}, 404)


def _all_tables() -> list[dict]:
    return _load("tables_page_1.json")["data"] + _load("tables_page_2.json")["data"]


def _import(schema: str | None = "shop", tables: tuple[str, ...] = ()):
    client = OpenMetadataClient(
        "http://om.test:8585", "test-token", session=RecordedSession()
    )
    selection = OpenMetadataSelection(
        service=SERVICE, database=DATABASE, schema=schema, tables=tables
    )
    return import_openmetadata_project(client, selection)


def _model(imported, name: str) -> dict:
    return next(model for model in imported.models if model["name"] == name)


def _column(model: dict, name: str) -> dict:
    return next(column for column in model["columns"] if column["name"] == name)


def _patch_client(monkeypatch, session: RecordedSession | None = None) -> None:
    session = session or RecordedSession()
    real_init = OpenMetadataClient.__init__

    def _init(self, host, token, **kwargs):
        real_init(self, host, token, session=session)

    monkeypatch.setattr(openmetadata.OpenMetadataClient, "__init__", _init)


def _cli_args(output_dir: Path, *extra: str) -> list[str]:
    return [
        "context",
        "import",
        "openmetadata",
        "--host",
        "http://om.test:8585",
        "--token",
        "test-token",
        "--service",
        SERVICE,
        "--database",
        DATABASE,
        "--schema",
        "shop",
        "--path",
        str(output_dir),
        *extra,
    ]


@pytest.fixture(autouse=True)
def _isolated_env(tmp_path, monkeypatch):
    import wren.profile as profile_mod  # noqa: PLC0415

    monkeypatch.delenv("OPENMETADATA_HOST", raising=False)
    monkeypatch.delenv("OPENMETADATA_TOKEN", raising=False)
    home_dir = tmp_path / "wren_home"
    home_dir.mkdir()
    monkeypatch.setattr(profile_mod, "_WREN_HOME", home_dir)
    monkeypatch.setattr(profile_mod, "_PROFILES_FILE", home_dir / "profiles.yml")


# ── FQN and mapping helpers ───────────────────────────────────────────────


@pytest.mark.unit
class TestHelpers:
    def test_split_fqn_plain(self):
        assert split_fqn("svc.db.sch.tbl") == ["svc", "db", "sch", "tbl"]

    def test_split_fqn_quoted_part(self):
        assert split_fqn('svc.db."my.schema".tbl') == ["svc", "db", "my.schema", "tbl"]

    def test_build_fqn_round_trip(self):
        fqn = build_fqn("svc", "db", "my.schema", "tbl")
        assert fqn == 'svc.db."my.schema".tbl'
        assert split_fqn(fqn) == ["svc", "db", "my.schema", "tbl"]

    def test_map_service_type(self):
        assert map_service_type_to_wren("Postgres") == "postgres"
        assert map_service_type_to_wren("MariaDB") == "mysql"
        assert map_service_type_to_wren("Mssql") == "mssql"

    def test_map_unknown_service_type_points_at_override(self):
        with pytest.raises(OpenMetadataError, match="--data-source"):
            map_service_type_to_wren("Glue")

    def test_tested_server_version(self):
        assert is_tested_server_version("2.0.5")
        assert not is_tested_server_version("1.13.6")
        assert not is_tested_server_version("2.10.0")
        assert not is_tested_server_version(None)


# ── Client ────────────────────────────────────────────────────────────────


@pytest.mark.unit
class TestClient:
    def test_list_tables_follows_paging_cursor(self):
        session = RecordedSession()
        client = OpenMetadataClient("om.test:8585", "test-token", session=session)
        tables = client.list_tables(
            OpenMetadataSelection(service=SERVICE, database=DATABASE, schema="shop")
        )
        table_calls = [
            params for url, params in session.calls if url.endswith("/tables")
        ]
        assert len(table_calls) == 2
        assert table_calls[0]["databaseSchema"] == "shop_pg.shop.shop"
        assert "after" not in table_calls[0]
        assert table_calls[1]["after"]
        assert len(tables) == len(_all_tables())

    def test_repeated_paging_cursor_stops(self):
        class LoopingSession(RecordedSession):
            def get(self, url, *, headers=None, params=None, timeout=None):
                return _Response({"data": [], "paging": {"after": "same"}})

        client = OpenMetadataClient("om.test", "test-token", session=LoopingSession())
        with pytest.raises(OpenMetadataError, match="same paging cursor"):
            client.list_tables(OpenMetadataSelection(service=SERVICE))

    def test_host_normalisation(self):
        session = RecordedSession()
        OpenMetadataClient(
            "http://om.test:8585/api/", "test-token", session=session
        ).server_version()
        assert session.calls[0][0] == "http://om.test:8585/api/v1/system/version"

    def test_database_only_selection_filters_by_database(self):
        session = RecordedSession()
        client = OpenMetadataClient("om.test", "test-token", session=session)
        client.list_tables(OpenMetadataSelection(service=SERVICE, database=DATABASE))
        assert session.calls[0][1]["database"] == "shop_pg.shop"

    def test_rejected_token_is_actionable(self):
        client = OpenMetadataClient(
            "om.test", "test-token", session=RecordedSession(status_code=401)
        )
        with pytest.raises(OpenMetadataError, match="rejected the token"):
            client.server_version()


# ── Conversion ────────────────────────────────────────────────────────────


@pytest.mark.unit
class TestConversion:
    def test_models_from_selected_schema_only(self):
        imported = _import()
        assert imported.datasource == "postgres"
        assert imported.server_version.startswith("2.0.")
        assert {model["name"] for model in imported.models} == {
            "customer_profiles",
            "customers",
            "order_lines",
            "orders",
            "page_views",
            "products",
            "returns",
            "shipments",
        }

    def test_table_reference_and_types(self):
        orders = _model(_import(), "orders")
        assert orders["table_reference"] == {
            "catalog": "shop",
            "schema": "shop",
            "table": "orders",
        }
        assert orders["primary_key"] == "order_id"
        assert _column(orders, "status")["type"] == "VARCHAR(20)"
        assert _column(orders, "total_amount")["type"] == "DECIMAL(12, 2)"
        assert _column(orders, "customer_id")["not_null"] is True
        assert _column(orders, "total_amount")["not_null"] is False

    def test_composite_primary_key(self):
        order_lines = _model(_import(), "order_lines")
        assert sorted(order_lines["primary_key"]) == ["line_no", "order_id"]

    def test_curated_descriptions_tags_and_owners(self):
        customers = _model(_import(), "customers")
        props = customers["properties"]
        assert props["description"] == "Customers who have placed at least one order."
        assert props["om_tags"] == ["Tier.Tier1"]
        assert props["om_owners"] == ["admin"]
        email = _column(customers, "email")
        assert email["properties"]["description"] == "Primary contact email."
        assert email["properties"]["om_tags"] == ["PII.Sensitive"]

    def test_fully_qualified_names_recorded(self):
        orders = _model(_import(), "orders")
        assert orders["properties"]["om_fqn"] == "shop_pg.shop.shop.orders"
        assert (
            _column(orders, "order_id")["properties"]["om_fqn"]
            == "shop_pg.shop.shop.orders.order_id"
        )

    def test_relationships_come_from_foreign_keys(self):
        imported = _import()
        by_name = {rel["name"]: rel for rel in imported.relationships}
        assert set(by_name) == {
            "customer_profiles_to_customers",
            "order_lines_to_orders",
            "order_lines_to_products",
            "orders_to_customers",
            "returns_to_order_lines",
            "shipments_to_order_lines",
        }
        assert by_name["orders_to_customers"] == {
            "name": "orders_to_customers",
            "models": ["orders", "customers"],
            "join_type": "MANY_TO_ONE",
            "condition": "orders.customer_id = customers.customer_id",
            "properties": {"source": "openmetadata_foreign_key"},
        }
        assert by_name["shipments_to_order_lines"]["condition"] == (
            "shipments.line_no = order_lines.line_no"
            " AND shipments.order_id = order_lines.order_id"
        )

    def test_composite_foreign_key_pairs_columns_by_position(self):
        # FK (a_ord, b_line) REFERENCES order_lines(order_id, line_no): the
        # names do not line up, so pairing must follow constraint position.
        rel = next(
            r for r in _import().relationships if r["name"] == "returns_to_order_lines"
        )
        assert rel["condition"] == (
            "returns.a_ord = order_lines.order_id AND returns.b_line = order_lines.line_no"
        )

    def test_join_type_derived_from_key_uniqueness(self):
        imported = _import()
        by_name = {rel["name"]: rel for rel in imported.relationships}
        # OpenMetadata 2.0.5 reports MANY_TO_MANY for composite foreign keys.
        raw = next(
            c
            for t in _all_tables()
            if t["name"] == "shipments"
            for c in t["tableConstraints"]
            if c["constraintType"] == "FOREIGN_KEY"
        )
        assert raw["relationshipType"] == "MANY_TO_MANY"
        assert by_name["shipments_to_order_lines"]["join_type"] == "MANY_TO_ONE"
        assert by_name["returns_to_order_lines"]["join_type"] == "MANY_TO_ONE"
        # The foreign key is also the primary key, so each side has one row.
        assert by_name["customer_profiles_to_customers"]["join_type"] == "ONE_TO_ONE"

    def test_tables_without_foreign_keys_get_no_relationships(self):
        imported = _import()
        involved = {name for rel in imported.relationships for name in rel["models"]}
        assert "page_views" not in involved

    def test_foreign_key_to_unimported_table_is_reported(self):
        imported = _import()
        assert [
            (s.table, s.columns, s.reason) for s in imported.skipped_relationships
        ] == [
            (
                "shop_pg.shop.shop.customers",
                ("region_code",),
                "referenced table is not imported",
            )
        ]

    def test_whole_database_resolves_cross_schema_foreign_key(self):
        imported = _import(schema=None)
        assert "regions" in {model["name"] for model in imported.models}
        assert "customers_to_regions" in {rel["name"] for rel in imported.relationships}
        assert imported.skipped_relationships == []

    def test_table_allow_list(self):
        imported = _import(tables=("orders", "customers"))
        assert {model["name"] for model in imported.models} == {"customers", "orders"}
        assert [rel["name"] for rel in imported.relationships] == [
            "orders_to_customers"
        ]

    def test_lineage_is_never_turned_into_relationships(self):
        tables = _all_tables()
        for table in tables:
            table.pop("tableConstraints", None)
            table["upstreamLineage"] = [{"fromEntity": "shop_pg.shop.shop.orders"}]
        imported = convert_openmetadata_tables(
            tables,
            selection=OpenMetadataSelection(service=SERVICE, database=DATABASE),
            service_type="Postgres",
        )
        assert imported.relationships == []

    def test_unusable_tables_are_skipped_and_reported(self):
        tables = _all_tables()
        orders = next(t for t in tables if t["name"] == "orders")
        tables.append(
            {**orders, "name": "a/b", "fullyQualifiedName": "shop_pg.shop.shop.a/b"}
        )
        tables.append(
            {
                **orders,
                "name": "empty",
                "fullyQualifiedName": "shop_pg.shop.shop.empty",
                "columns": [],
            }
        )
        tables.append({**orders, "fullyQualifiedName": "shop_pg.shop.orders"})
        imported = convert_openmetadata_tables(
            tables,
            selection=OpenMetadataSelection(service=SERVICE, database=DATABASE),
            service_type="Postgres",
        )
        names = {model["name"] for model in imported.models}
        assert "a/b" not in names and "empty" not in names
        model_paths = [
            f.relative_path
            for f in imported.files
            if f.relative_path.startswith("models/")
        ]
        assert all(len(Path(path).parts) == 3 for path in model_paths)
        assert {(s.table, s.reason.split(" ")[0]) for s in imported.skipped_tables} == {
            ("shop_pg.shop.shop.a/b", "table"),
            ("shop_pg.shop.shop.empty", "no"),
            ("shop_pg.shop.orders", "not"),
        }

    def test_foreign_key_into_quoted_schema(self):
        customers = {
            "name": "customers",
            "fullyQualifiedName": 'svc.db."sales.v2".customers',
            "columns": [
                {
                    "name": "id",
                    "dataTypeDisplay": "integer",
                    "constraint": "PRIMARY_KEY",
                }
            ],
        }
        orders = {
            "name": "orders",
            "fullyQualifiedName": 'svc.db."sales.v2".orders',
            "columns": [
                {
                    "name": "id",
                    "dataTypeDisplay": "integer",
                    "constraint": "PRIMARY_KEY",
                },
                {"name": "customer_id", "dataTypeDisplay": "integer"},
            ],
            "tableConstraints": [
                {
                    "constraintType": "FOREIGN_KEY",
                    "columns": ["customer_id"],
                    "referredColumns": ['svc.db."sales.v2".customers.id'],
                }
            ],
        }
        imported = convert_openmetadata_tables(
            [customers, orders],
            selection=OpenMetadataSelection(
                service="svc", database="db", schema="sales.v2"
            ),
            service_type="Postgres",
        )
        assert _model(imported, "orders")["table_reference"]["schema"] == "sales.v2"
        assert [rel["condition"] for rel in imported.relationships] == [
            "orders.customer_id = customers.id"
        ]

    def test_empty_selection_fails(self):
        with pytest.raises(OpenMetadataError, match="No tables matched"):
            _import(tables=("does_not_exist",))

    def test_datasource_override(self):
        imported = convert_openmetadata_tables(
            _all_tables(),
            selection=OpenMetadataSelection(service=SERVICE, database=DATABASE),
            service_type="Glue",
            datasource="trino",
        )
        assert imported.datasource == "trino"


# ── CLI ───────────────────────────────────────────────────────────────────


@pytest.mark.unit
class TestCli:
    def test_unconfigured_fails_with_actionable_message(self, tmp_path):
        result = runner.invoke(
            app, ["context", "import", "openmetadata", "--path", str(tmp_path / "p")]
        )
        assert result.exit_code == 1
        assert "OpenMetadata is not configured" in result.output
        assert "OPENMETADATA_HOST" in result.output
        assert not (tmp_path / "p").exists()

    def test_reads_configuration_from_environment(self, tmp_path, monkeypatch):
        _patch_client(monkeypatch)
        monkeypatch.setenv("OPENMETADATA_HOST", "http://om.test:8585")
        monkeypatch.setenv("OPENMETADATA_TOKEN", "test-token")
        result = runner.invoke(
            app,
            [
                "context",
                "import",
                "openmetadata",
                "--service",
                SERVICE,
                "--database",
                DATABASE,
                "--path",
                str(tmp_path / "p"),
                "--dry-run",
            ],
        )
        assert result.exit_code == 0, result.output

    def test_dry_run_lists_files_without_writing(self, tmp_path, monkeypatch):
        _patch_client(monkeypatch)
        output_dir = tmp_path / "project"
        result = runner.invoke(app, _cli_args(output_dir, "--dry-run"))
        assert result.exit_code == 0, result.output
        assert "Dry run" in result.output
        assert "models/orders/metadata.yml" in result.output
        assert "relationships.yml" in result.output
        assert not output_dir.exists()

    def test_import_validates_and_builds(self, tmp_path, monkeypatch):
        _patch_client(monkeypatch)
        output_dir = tmp_path / "project"
        result = runner.invoke(app, _cli_args(output_dir))
        assert result.exit_code == 0, result.output
        assert "8 models, 6 relationships" in result.output
        assert "skipped foreign key shop_pg.shop.shop.customers" in result.output
        assert "wren context validate" in result.output

        config = yaml.safe_load((output_dir / "wren_project.yml").read_text())
        assert config["data_source"] == "postgres"
        assert config["openmetadata"]["service"] == SERVICE

        validate = runner.invoke(
            app, ["context", "validate", "--path", str(output_dir)]
        )
        assert validate.exit_code == 0, validate.output
        build = runner.invoke(app, ["context", "build", "--path", str(output_dir)])
        assert build.exit_code == 0, build.output
        mdl = json.loads((output_dir / "target" / "mdl.json").read_text())
        assert len(mdl["models"]) == 8
        assert len(mdl["relationships"]) == 6

    def test_reimport_keeps_user_edits_and_lists_collisions(
        self, tmp_path, monkeypatch
    ):
        _patch_client(monkeypatch)
        output_dir = tmp_path / "project"
        assert runner.invoke(app, _cli_args(output_dir)).exit_code == 0

        orders_path = output_dir / "models" / "orders" / "metadata.yml"
        orders = yaml.safe_load(orders_path.read_text())
        orders["properties"]["description"] = "Edited by a human."
        orders_path.write_text(yaml.safe_dump(orders, sort_keys=False))

        rel_path = output_dir / "relationships.yml"
        rels = yaml.safe_load(rel_path.read_text())
        rels["relationships"][0]["condition"] = "edited = edited"
        edited_name = rels["relationships"][0]["name"]
        rel_path.write_text(yaml.safe_dump(rels, sort_keys=False))

        (output_dir / "models" / "page_views" / "metadata.yml").unlink()
        before = {p: p.read_bytes() for p in output_dir.rglob("*") if p.is_file()}

        result = runner.invoke(app, _cli_args(output_dir))
        assert result.exit_code == 0, result.output
        assert "Collisions" in result.output
        assert "model 'orders' exists" in result.output
        assert f"relationship '{edited_name}' differs" in result.output
        assert "edited = edited" in result.output
        assert "--force" in result.output

        for path, content in before.items():
            assert path.read_bytes() == content, f"{path} was modified"
        assert (output_dir / "models" / "page_views" / "metadata.yml").exists()

    def test_reimport_with_nothing_new_exits_nonzero(self, tmp_path, monkeypatch):
        _patch_client(monkeypatch)
        output_dir = tmp_path / "project"
        assert runner.invoke(app, _cli_args(output_dir)).exit_code == 0
        result = runner.invoke(app, _cli_args(output_dir))
        assert result.exit_code == 1
        assert "Nothing new to write" in result.output

    def test_force_regenerates_from_openmetadata(self, tmp_path, monkeypatch):
        _patch_client(monkeypatch)
        output_dir = tmp_path / "project"
        assert runner.invoke(app, _cli_args(output_dir)).exit_code == 0

        orders_path = output_dir / "models" / "orders" / "metadata.yml"
        orders = yaml.safe_load(orders_path.read_text())
        orders["properties"]["description"] = "Edited by a human."
        orders_path.write_text(yaml.safe_dump(orders, sort_keys=False))
        (output_dir / "models" / "stale_model").mkdir()
        (output_dir / "models" / "stale_model" / "metadata.yml").write_text("x: 1\n")

        result = runner.invoke(app, _cli_args(output_dir, "--force"))
        assert result.exit_code == 0, result.output
        assert "Collisions" not in result.output
        regenerated = yaml.safe_load(orders_path.read_text())
        assert regenerated["properties"]["om_fqn"] == "shop_pg.shop.shop.orders"
        assert regenerated["properties"].get("description") != "Edited by a human."
        assert not (output_dir / "models" / "stale_model").exists()

    def test_dbt_import_still_rejects_unknown_source(self, tmp_path):
        result = runner.invoke(app, ["context", "import", "looker"])
        assert result.exit_code == 1
        assert "dbt, openmetadata" in result.output
