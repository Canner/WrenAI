"""The shared context adapter: loader resolution and validation, the run-time reader."""

import json
import stat
import sys
import textwrap
from dataclasses import replace
from pathlib import Path

import pytest
import yaml

from wren import context_adapter as adapter
from wren.context import build_json
from wren.context_adapter import (
    ContextChanged,
    ContextInconsistent,
    ContextLoaderFailed,
    ContextLoaderIncompatible,
    ContextLoaderUnavailable,
    ContextNotBuilt,
    ContextReader,
    ContextUnparseable,
    DeniedColumnsInvalid,
    SemanticsInvalid,
    Snapshot,
    ViewColumnsInvalid,
    load_snapshot,
    project_digest,
    resolve_loader,
    strip_denied_declaration,
)
from wren.declared_defaults import ColumnRef, ExcludeRows, SaleStatuses

# --- helpers ------------------------------------------------------------------------------------


def executable(path: Path, text: str) -> Path:
    path.write_text(text)
    path.chmod(path.stat().st_mode | stat.S_IXUSR)
    return path


def fake_loader(tmp_path: Path, prepared=None, catalog=None, exit_code=0, stderr=""):
    """A stand-in loader that writes the given documents (or none) and exits with ``exit_code``."""
    script = textwrap.dedent(
        f"""\
        #!{sys.executable}
        import json, sys
        args = sys.argv[1:]
        prepared, catalog = json.loads({json.dumps(json.dumps(prepared))}), json.loads({json.dumps(json.dumps(catalog))})
        if prepared is not None:
            open(args[args.index("-o") + 1], "w").write(json.dumps(prepared))
        if catalog is not None:
            open(args[args.index("--catalog-out") + 1], "w").write(json.dumps(catalog))
        sys.stderr.write({stderr!r})
        sys.exit({exit_code})
        """
    )
    return executable(tmp_path / "fake-loader", script)


def project_dir(tmp_path: Path) -> Path:
    root = tmp_path / "project"
    (root / "models/orders").mkdir(parents=True)
    (root / "wren_project.yml").write_text("name: demo\n")
    (root / "models/orders/metadata.yml").write_text("name: orders\n")
    return root


GOOD_PREPARED = {"context_version": 2, "parseable": True}


def good_catalog(root: Path, **extra):
    return {"catalog_version": 1, "digest": project_digest(root), "models": [], **extra}


def model(name, description=None, columns=("id",), **extra):
    return {
        "name": name,
        **({"description": description} if description else {}),
        "primary_key": ["id"],
        "columns": [{"name": c, "type": "VARCHAR"} for c in columns],
        **extra,
    }


def snapshot(catalog=None, denied=(), declarations=()):
    return Snapshot(
        root=Path("."),
        prepared={"context_version": 2, "parseable": True},
        catalog={"catalog_version": 1, **(catalog or {})},
        digest="0" * 64,
        loader_identity="sha256:test",
        denied=frozenset(denied),
        declarations=tuple(declarations),
    )


def reader(catalog, budget=4096, denied=(), declarations=()):
    snap = snapshot(catalog, denied, declarations)
    return ContextReader(snap, snap.denied, budget)


EXCLUDE_TEST = ExcludeRows(
    id="exclude-test-orders",
    column=ColumnRef("orders", "is_test"),
    exclude=True,
    anchor="orders",
    covered=frozenset({"orders"}),
    aggregated_only=False,
    addresses_column=False,
    filtered_by=(),
)


# --- resolving the loader ----------------------------------------------------------------------


def test_env_names_the_loader_and_a_bad_value_does_not_fall_through(tmp_path):
    good = executable(tmp_path / "loader", "#!/bin/sh\n")
    assert resolve_loader({adapter.LOADER_ENV: str(good)}) == good.resolve()
    with pytest.raises(ContextLoaderUnavailable):
        resolve_loader({adapter.LOADER_ENV: str(tmp_path / "missing")})
    plain = tmp_path / "not-executable"
    plain.write_text("x")
    with pytest.raises(ContextLoaderUnavailable):
        resolve_loader({adapter.LOADER_ENV: str(plain)})


def test_the_in_repo_cargo_build_is_found_release_first_and_env_wins(
    tmp_path, monkeypatch
):
    crate = tmp_path / "core/wren-context-loader"
    (crate / "target/debug").mkdir(parents=True)
    (crate / "target/release").mkdir(parents=True)
    (crate / "Cargo.toml").write_text("[package]\n")
    package = tmp_path / "core/wren/src/wren"
    package.mkdir(parents=True)
    monkeypatch.setattr(adapter, "__file__", str(package / "context_adapter.py"))
    with pytest.raises(ContextLoaderUnavailable):
        resolve_loader({})
    debug = executable(crate / "target/debug/wren-context-loader", "#!/bin/sh\n")
    assert resolve_loader({}) == debug
    release = executable(crate / "target/release/wren-context-loader", "#!/bin/sh\n")
    assert resolve_loader({}) == release
    other = executable(tmp_path / "other", "#!/bin/sh\n")
    assert resolve_loader({adapter.LOADER_ENV: str(other)}) == other.resolve()


def test_no_loader_anywhere_is_unavailable_never_a_metadata_copy(tmp_path, monkeypatch):
    monkeypatch.setattr(adapter, "__file__", str(tmp_path / "a/b/context_adapter.py"))
    with pytest.raises(ContextLoaderUnavailable, match="context_loader_unavailable"):
        resolve_loader({})


# --- validating what the loader answers ------------------------------------------------------


def test_exit_zero_is_not_success_when_the_project_is_unparseable(tmp_path):
    root = project_dir(tmp_path)
    loader = fake_loader(
        tmp_path,
        prepared={
            "context_version": 2,
            "parseable": False,
            "parse_error": "bad models",
        },
        catalog=good_catalog(root),
    )
    with pytest.raises(
        ContextUnparseable, match="context_unparseable: bad models"
    ) as raised:
        load_snapshot(root, loader)
    assert raised.value.parse_error == "bad models"


def test_a_loader_without_a_digest_is_incompatible(tmp_path):
    root = project_dir(tmp_path)
    catalog = good_catalog(root)
    del catalog["digest"]
    loader = fake_loader(tmp_path, GOOD_PREPARED, catalog)
    with pytest.raises(ContextLoaderIncompatible, match="digest"):
        load_snapshot(root, loader)


@pytest.mark.parametrize(
    ("prepared", "catalog_update"),
    [
        ({"context_version": 1, "parseable": True}, {}),
        ({"context_version": 3, "parseable": True}, {}),
        (GOOD_PREPARED, {"catalog_version": 2}),
        (GOOD_PREPARED, {"digest": "not-hex"}),
        (GOOD_PREPARED, {"digest": "0" * 64}),
    ],
)
def test_unknown_versions_and_a_digest_that_does_not_match_are_incompatible(
    tmp_path, prepared, catalog_update
):
    root = project_dir(tmp_path)
    loader = fake_loader(tmp_path, prepared, {**good_catalog(root), **catalog_update})
    with pytest.raises(ContextLoaderIncompatible):
        load_snapshot(root, loader)


def test_a_nonzero_exit_is_a_failure_even_with_good_documents(tmp_path):
    root = project_dir(tmp_path)
    loader = fake_loader(
        tmp_path, GOOD_PREPARED, good_catalog(root), 3, "boom\nlast line"
    )
    with pytest.raises(ContextLoaderFailed, match="exit 3: last line"):
        load_snapshot(root, loader)


def test_missing_or_garbled_output_is_incompatible(tmp_path):
    root = project_dir(tmp_path)
    with pytest.raises(ContextLoaderIncompatible):
        load_snapshot(root, fake_loader(tmp_path, None, None))
    garbled = executable(
        tmp_path / "garbled",
        '#!/bin/sh\nwhile [ $# -gt 0 ]; do case $1 in -o|--catalog-out) printf \'{"cut\' > "$2"; shift;; esac; shift; done\n',
    )
    with pytest.raises(ContextLoaderIncompatible):
        load_snapshot(root, garbled)


def test_an_unrunnable_loader_is_unavailable(tmp_path):
    root = project_dir(tmp_path)
    broken = executable(tmp_path / "broken", "#!/nonexistent/interpreter\n")
    with pytest.raises(ContextLoaderUnavailable):
        load_snapshot(root, broken)


def test_an_invalid_denylist_refuses_to_start(tmp_path):
    root = project_dir(tmp_path)
    catalog = good_catalog(
        root,
        denied_columns_invalid=True,
        diagnostics=[
            {
                "kind": "denied_columns_invalid",
                "path": "knowledge/rules/pii.md",
                "entry": "customers.nope",
            }
        ],
    )
    loader = fake_loader(tmp_path, GOOD_PREPARED, catalog)
    with pytest.raises(
        DeniedColumnsInvalid, match="knowledge/rules/pii.md: customers.nope"
    ):
        load_snapshot(root, loader)


def test_an_unreadable_semantics_declaration_refuses_to_start(tmp_path):
    root = project_dir(tmp_path)
    catalog = good_catalog(
        root,
        semantics_invalid=True,
        diagnostics=[
            {
                "kind": "semantics_invalid",
                "path": "knowledge/rules/notes.md",
                "entry": "semantics[1]: unknown field",
            }
        ],
    )
    loader = fake_loader(tmp_path, GOOD_PREPARED, catalog)
    with pytest.raises(
        SemanticsInvalid, match="knowledge/rules/notes.md: semantics.1.: unknown field"
    ):
        load_snapshot(root, loader)


def test_a_semantics_flag_without_a_diagnostic_still_refuses(tmp_path):
    root = project_dir(tmp_path)
    loader = fake_loader(
        tmp_path, GOOD_PREPARED, good_catalog(root, semantics_invalid=True)
    )
    with pytest.raises(SemanticsInvalid, match="unreadable semantics"):
        load_snapshot(root, loader)


# --- the real loader against a real project -----------------------------------------------------


@pytest.fixture
def required_loader():
    import os  # noqa: PLC0415

    try:
        return resolve_loader()
    except ContextLoaderUnavailable:
        if os.environ.get("WREN_REQUIRE_CONTEXT_LOADER") == "1":
            raise
        pytest.skip("build core/wren-context-loader or set WREN_CONTEXT_LOADER_BIN")


@pytest.fixture
def real_project(tmp_path, required_loader):
    import importlib.util  # noqa: PLC0415

    try:
        resolve_loader()
    except ContextLoaderUnavailable:
        pytest.skip("build core/wren-context-loader or set WREN_CONTEXT_LOADER_BIN")
    examples = Path(__file__).resolve().parents[4] / "examples/serve-agent"
    spec = importlib.util.spec_from_file_location(
        "setup_for_adapter", examples / "setup.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.prepare(tmp_path / "fixture")
    return tmp_path / "fixture/project"


def test_the_real_loader_snapshot_matches_the_python_digest(real_project):
    snap = load_snapshot(real_project)
    assert snap.digest == project_digest(real_project)
    assert snap.loader_identity.startswith("sha256:")
    assert snap.denied == {("customers", "email")}
    assert [d.id for d in snap.declarations] == [
        "exclude-test-orders",
        "convert-invoices-to-usd",
        "count-paid-and-shipped",
    ]
    assert [m["name"] for m in snap.catalog["models"]] == [
        "customers",
        "fx_rates",
        "invoices",
        "orders",
    ]


def test_the_digest_follows_project_sources_and_ignores_the_build(real_project):
    base = project_digest(real_project)
    (real_project / "target/mdl.json").write_text("{}")
    (real_project / "service.yml").write_text("changed")
    (real_project / "knowledge/rules/.DS_Store").write_bytes(b"junk")
    assert project_digest(real_project) == base
    rules = real_project / "knowledge/rules/conventions.md"
    rules.write_text(rules.read_text() + "\n")
    assert project_digest(real_project) != base


def test_a_project_with_no_wren_project_file_is_unparseable_not_a_crash(tmp_path):
    try:
        resolve_loader()
    except ContextLoaderUnavailable:
        pytest.skip("no loader binary")
    (tmp_path / "empty").mkdir()
    with pytest.raises(ContextUnparseable, match="wren_project.yml"):
        load_snapshot(tmp_path / "empty")


def test_a_stale_build_is_inconsistent_and_a_missing_build_is_reported(real_project):
    manifest = real_project / "target/mdl.json"
    built = json.loads(manifest.read_text())
    built["models"][0]["columns"].pop()
    manifest.write_text(json.dumps(built))
    with pytest.raises(ContextInconsistent, match="wren context build"):
        load_snapshot(real_project)
    manifest.unlink()
    with pytest.raises(ContextNotBuilt):
        load_snapshot(real_project)


@pytest.mark.parametrize(
    "front_matter",
    [
        "denied_columns: [customers.nope]",
        "denied_columns: [Customers.Email]",
        "denied_columns: customers.email.extra",
        "denied_columns: [customers.email\ndefaults: []",
    ],
)
def test_a_malformed_denylist_in_a_real_project_refuses_to_start(
    real_project, front_matter
):
    (real_project / "knowledge/rules/conventions.md").write_text(
        f"---\n{front_matter}\n---\nbody\n"
    )
    with pytest.raises(DeniedColumnsInvalid):
        load_snapshot(real_project)


def test_invalid_declared_defaults_refuse_to_start(real_project):
    (real_project / "knowledge/rules/conventions.md").write_text(
        "---\ndefaults:\n  - {id: x, kind: exclude_rows, column: orders.nope, exclude: true, covers: {reaching: orders, via: many_to_one}}\n---\nbody\n"
    )
    with pytest.raises(adapter.DeclaredDefaultsInvalid):
        load_snapshot(real_project)


def test_a_change_between_the_two_digests_is_reported(real_project, monkeypatch):
    calls = {"n": 0}
    real = adapter.project_digest

    def moving(root):
        calls["n"] += 1
        return real(root) if calls["n"] == 1 else "f" * 64

    monkeypatch.setattr(adapter, "project_digest", moving)
    with pytest.raises(ContextChanged):
        load_snapshot(real_project)


# --- the reader: list, select, read ------------------------------------------------------------


def three_models(**kwargs):
    return reader(
        {
            "models": [
                model("customers", "Customers and their region.", ("id", "region")),
                model("orders", "One row per order.", ("id", "is_test", "amount")),
                model("fx_rates", None, ("day", "rate")),
            ],
            "views": [
                {
                    "name": "revenue",
                    "description": "Revenue per order.",
                    "guarantees": ["a", "b"],
                }
            ],
            "cubes": [
                {
                    "name": "kpi",
                    "base_object": "orders",
                    "measures": [],
                    "dimensions": [],
                    "time_dimensions": [],
                }
            ],
        },
        declarations=(EXCLUDE_TEST,),
        **kwargs,
    )


def test_list_is_one_line_per_item_with_defaults_and_fits_the_budget():
    r = three_models(budget=4096)
    page = r.list()
    assert page["page"] == 1 and page["pages"] == 1
    lines = page["text"].splitlines()
    assert lines[0] == "context index (page 1/1): 3 models, 1 cubes, 1 views"
    assert "model customers: Customers and their region." in lines
    assert "model orders: One row per order. [defaults: exclude-test-orders]" in lines
    assert "model fx_rates: (no description)" in lines
    assert "view revenue: Revenue per order. [guarantees: a,b]" in lines
    assert "cube kpi: (no description)" in lines
    assert r.first_page_bytes() == len(page["text"].encode()) <= 4096


def test_the_rules_summary_rides_on_the_first_page_without_prose():
    r = reader(
        {
            "models": [model("orders", "One row per order.", ("id", "is_test"))],
            "knowledge_rules": [
                {
                    "path": "knowledge/rules/a.md",
                    "content": "---\ndenied_columns: [orders.secret]\ndefaults:\n  - {id: exclude-test-orders, kind: exclude_rows, column: orders.is_test, exclude: true, covers: {reaching: orders, via: many_to_one}}\n---\nSECRET PROSE\n",
                }
            ],
        },
        declarations=(EXCLUDE_TEST,),
    )
    text = r.list()["text"]
    assert (
        "rule knowledge/rules/a.md: defaults: exclude-test-orders; columns: orders.is_test"
        in text
    )
    assert "SECRET PROSE" not in text


def test_a_large_project_is_paged_not_truncated_or_refused():
    models = [
        model(
            f"model_{i:02d}", f"Business description number {i} for the demo catalog."
        )
        for i in range(45)
    ]
    r = reader({"models": models}, budget=1024)
    assert r.pages > 1 and r.model_count == 45
    seen = []
    for number in range(1, r.pages + 1):
        text = r.list(number)["text"]
        assert len(text.encode()) <= 1024, number
        seen += [
            line.split(":")[0].split()[1]
            for line in text.splitlines()
            if line.startswith("model ")
        ]
        if number < r.pages:
            assert f"call list_context with page={number + 1}" in text
    assert seen == [m["name"] for m in models]
    assert all(
        f"Business description number {i} for the demo catalog."
        in "".join(r.list(n)["text"] for n in range(1, r.pages + 1))
        for i in range(45)
    )
    assert r.list(r.pages + 1) == {"error": "page_out_of_range", "pages": r.pages}
    assert r.list(0)["error"] == "page_out_of_range"
    assert r.list("1")["error"] == "page_out_of_range"


def test_one_oversized_line_is_clipped_to_the_budget_but_never_dropped():
    r = reader({"models": [model("big", "x" * 5000), model("small", "ok")]}, budget=600)
    texts = [r.list(n)["text"] for n in range(1, r.pages + 1)]
    assert all(len(t.encode()) <= 600 for t in texts)
    joined = "\n".join(texts)
    assert "model big: " in joined and "model small: ok" in joined


@pytest.mark.parametrize("long_part", ["name", "tag"])
def test_complete_pages_fit_the_utf8_budget_even_with_long_names_or_tags(long_part):
    name = "模型" * 600 if long_part == "name" else "orders"
    declarations = (
        (replace(EXCLUDE_TEST, id="規則" * 600),) if long_part == "tag" else ()
    )
    r = reader(
        {"models": [model(name, "description"), model("small", "ok")]},
        budget=600,
        declarations=declarations,
    )
    texts = [r.list(n)["text"] for n in range(1, r.pages + 1)]
    assert all(len(text.encode()) <= 600 for text in texts)
    assert any("small" in text for text in texts)
    if long_part == "name":
        line = next(
            line
            for text in texts
            for line in text.splitlines()
            if line.startswith("model ")
        )
        selector = line.removeprefix("model ").split(": ", 1)[0]
        assert len(selector.encode()) < 100
        assert r.select([selector]) == {"selected": [selector]}
        assert r.read([selector])["items"][0]["name"] == name
        assert r.read([name])["items"][0]["name"] == name


def test_compact_context_selectors_cannot_shadow_authored_names_or_rule_selectors():
    name = "模型" * 600
    r = reader(
        {
            "models": [model(name), model("@context-1")],
            "views": [{"name": "@context-2", "statement": "SELECT 1"}],
        },
        budget=600,
    )
    text = "\n".join(r.list(n)["text"] for n in range(1, r.pages + 1))
    selector = next(
        line.removeprefix("model ").split(": ", 1)[0]
        for line in text.splitlines()
        if line.startswith("model ") and "模型" in line
    )
    assert selector not in {"@context-1", "@context-2"}
    assert len(selector.encode()) < 100
    assert r.read([selector])["items"][0]["name"] == name
    assert r.read(["@context-1"])["items"][0]["name"] == "@context-1"
    assert r.read(["@context-2"])["items"][0]["kind"] == "view"


def test_a_budget_below_the_floor_is_refused():
    with pytest.raises(ValueError, match="invalid_context_budget"):
        reader({"models": [model("a")]}, budget=100)


def test_select_only_records_and_rejects_unknown_ids():
    r = three_models()
    assert r.select(["orders", "orders", "revenue"]) == {
        "selected": ["orders", "revenue"]
    }
    bad = r.select(["orders", "nope"])
    assert bad["error"] == "unknown_context_id" and bad["unknown"] == ["nope"]
    assert r.select([])["error"] == "invalid_ids"
    assert r.select("orders")["error"] == "invalid_ids"
    assert r.select(["orders"] * 17)["error"] == "invalid_ids"
    assert r.read(["nope"])["error"] == "unknown_context_id"
    assert r.read([5])["error"] == "unknown_context_id"


def test_read_returns_columns_enum_meanings_and_the_rules_that_concern_the_model():
    r = reader(
        {
            "models": [
                {
                    **model(
                        "orders", "One row per order.", ("id", "status", "customer_id")
                    ),
                    "columns": [
                        {"name": "id", "type": "INTEGER", "not_null": True},
                        {
                            "name": "status",
                            "type": "VARCHAR",
                            "description": "Order state.",
                            "enum_values": [{"value": "P", "meaning": "paid"}],
                        },
                        {
                            "name": "customer_id",
                            "type": "INTEGER",
                            "relationship": "orders_customers",
                        },
                        {"name": "hidden_col", "type": "INTEGER", "is_hidden": True},
                    ],
                },
                model("customers", "Customers.", ("id",)),
                model("fx_rates", None, ("day",)),
            ],
            "relationships": [
                {
                    "name": "orders_customers",
                    "models": ["orders", "customers"],
                    "join_type": "MANY_TO_ONE",
                    "condition": "orders.customer_id = customers.id",
                }
            ],
            "knowledge_rules": [
                {
                    "path": "knowledge/rules/by-prose.md",
                    "content": "Revenue comes from orders.",
                },
                {
                    "path": "knowledge/rules/by-declaration.md",
                    "content": "---\ndefaults:\n  - {id: exclude-test-orders, kind: exclude_rows, column: orders.is_test, exclude: true, covers: {reaching: orders, via: many_to_one}}\n---\nNo prose here.",
                },
                {
                    "path": "knowledge/rules/unrelated.md",
                    "content": "Nothing about it. Orderly is not orders_x.",
                },
            ],
        },
        declarations=(EXCLUDE_TEST,),
    )
    out = r.read(["orders"])
    (item,) = out["items"]
    assert [c["name"] for c in item["columns"]] == ["id", "status", "customer_id"]
    assert item["columns"][1]["enum_values"] == [{"value": "P", "meaning": "paid"}]
    assert item["columns"][2]["relationship"] == "orders_customers"
    assert item["relationships"][0]["condition"] == "orders.customer_id = customers.id"
    assert [x["path"] for x in out["rules"]] == [
        "knowledge/rules/by-prose.md",
        "knowledge/rules/by-declaration.md",
    ]
    assert r.read(["fx_rates"])["rules"] == []
    one = r.read(["rule:knowledge/rules/unrelated.md"])
    assert one["items"] == [] and one["rules"][0]["content"].startswith(
        "Nothing about it"
    )


# --- denied columns are removed from every projection ---------------------------------------


def denying_reader(budget=4096):
    return reader(
        {
            "models": [
                {
                    **model(
                        "customers",
                        "Customers. Their email is private. Region is shared.",
                        ("id",),
                    ),
                    "columns": [
                        {"name": "id", "type": "INTEGER"},
                        {
                            "name": "region",
                            "type": "VARCHAR",
                            "description": "Sales region.",
                        },
                        {
                            "name": "email",
                            "type": "VARCHAR",
                            "description": "Contact address.",
                            "enum_values": [{"value": "a@b", "meaning": "sample"}],
                            "relationship": "secret_rel",
                        },
                        {
                            "name": "tier",
                            "type": "VARCHAR",
                            "enum_values": [{"value": "g", "meaning": "gold"}],
                            "relationship": "by_email",
                        },
                    ],
                },
                model(
                    "orders",
                    "Orders reference customers.email for contact.",
                    ("id", "customer_id"),
                ),
            ],
            "relationships": [
                {
                    "name": "by_email",
                    "models": ["customers", "orders"],
                    "join_type": "MANY_TO_ONE",
                    "condition": "orders.contact = customers.email",
                },
                {
                    "name": "orders_customers",
                    "models": ["orders", "customers"],
                    "join_type": "MANY_TO_ONE",
                    "condition": "orders.customer_id = customers.id",
                },
            ],
            "cubes": [
                {
                    "name": "customer_cube",
                    "base_object": "customers",
                    "description": "Customer counts. Grouped by email or region.",
                    "measures": [
                        {"name": "customers", "type": "COUNT"},
                        {
                            "name": "email",
                            "type": "COUNT",
                            "description": "Distinct email.",
                        },
                    ],
                    "dimensions": [
                        {
                            "name": "region",
                            "type": "STRING",
                            "description": "Sales region.",
                        },
                        {"name": "Email", "type": "STRING"},
                    ],
                    "time_dimensions": [{"name": "email", "type": "DATE"}],
                }
            ],
            "views": [
                {
                    "name": "customer_overview",
                    "description": "Rollups exposing the email column. Regional rollups.",
                    "guarantees": [],
                }
            ],
            "knowledge_rules": [
                {
                    "path": "knowledge/rules/pii.md",
                    "content": "---\ndenied_columns:\n  - customers.email\ndefaults: []\n---\n# Customers\n\nCustomers are reported by region.",
                }
            ],
        },
        budget=budget,
        denied=[("customers", "email")],
    )


def test_a_denied_column_is_absent_from_every_projection():
    r = denying_reader()
    everything = json.dumps(
        [
            r.list(1),
            r.read(
                [
                    "customers",
                    "orders",
                    "customer_cube",
                    "customer_overview",
                    "rule:knowledge/rules/pii.md",
                ]
            ),
            r.structure_document(),
            r.rules_document(),
            r.describe(),
            r.documents(),
        ]
    )
    assert "email" not in everything.lower()
    assert "secret_rel" not in everything and "by_email" not in everything
    assert "a@b" not in everything
    read = r.read(["customers"])["items"][0]
    assert [c["name"] for c in read["columns"]] == ["id", "region", "tier"]
    assert read["columns"][2].get("relationship") is None
    assert read["description"] == "Customers. Region is shared."
    assert r.describe().splitlines()[1] == "- customers: Customers. Region is shared."
    assert "orders_customers" in r.structure_document()


def test_cube_members_and_view_text_do_not_name_a_denied_column():
    r = denying_reader()
    cube, view = r.read(["customer_cube", "customer_overview"])["items"]
    assert cube["description"] == "Customer counts."
    assert [m["name"] for m in cube["measures"]] == ["customers"]
    assert [m["name"] for m in cube["dimensions"]] == ["region"]
    assert cube["time_dimensions"] == []
    assert view["description"] == "Regional rollups."
    listed = r.list(1)["text"]
    assert "cube customer_cube: Customer counts." in listed
    assert "view customer_overview: Regional rollups." in listed
    assert "email" not in (listed + r.structure_document()).lower()


def test_strip_denied_declaration_removes_only_the_denylist_key():
    flow = "---\ndenied_columns: [a.b, c.d]\ndefaults: []\n---\nbody\n"
    assert strip_denied_declaration(flow) == "---\ndefaults: []\n---\nbody\n"
    block = "---\ndefaults:\n  - {id: x}\ndenied_columns:\n  - a.b\n  - c.d\n# note\nmore: 1\n---\nbody"
    assert (
        strip_denied_declaration(block)
        == "---\ndefaults:\n- {id: x}\nmore: 1\n---\nbody"
    )
    only = "---\ndenied_columns: [a.b]\n---\n# Title\n\nbody\n"
    assert strip_denied_declaration(only) == "# Title\n\nbody\n"
    plain = "# no front matter\ndenied_columns: [a.b]\n"
    assert strip_denied_declaration(plain) == plain
    unclosed = "---\ndenied_columns: [a.b]\nnever closed"
    assert strip_denied_declaration(unclosed) == unclosed
    untouched = "---\ndefaults: []\n---\nbody\n"
    assert strip_denied_declaration(untouched) == untouched


DECLARATION_SPELLINGS = {
    "plain flow": "---\ndenied_columns: [customers.email]\n---\nbody\n",
    "block list": "---\ndenied_columns:\n  - customers.email\n---\nbody\n",
    "double-quoted key": '---\n"denied_columns": [customers.email]\n---\nbody\n',
    "single-quoted key": "---\n'denied_columns': [customers.email]\n---\nbody\n",
    "complex key": "---\n? denied_columns\n: [customers.email]\n---\nbody\n",
    "flow-mapping front-matter": '---\n{"denied_columns": ["customers.email"]}\n---\nbody\n',
    "flow-mapping with another key": '---\n{"denied_columns": ["customers.email"], defaults: []}\n---\nbody\n',
    "anchor": "---\ndenied_columns: &d [customers.email]\n---\nbody\n",
    "crlf": "---\r\ndenied_columns: [customers.email]\r\ndefaults: []\r\n---\r\nbody\r\n",
    "bom": "\ufeff---\ndenied_columns: [customers.email]\n---\nbody\n",
    "trailing-space key": "---\ndenied_columns : [customers.email]\n---\nbody\n",
    "trailing-space fences": "---  \ndenied_columns: [customers.email]\n---  \nbody\n",
    "inline comment": "---\ndenied_columns: [customers.email] # pii\ndefaults: []\n---\nbody\n",
    "comment between entries": "---\ndenied_columns:\n  # pii\n  - customers.email\nmore: 1\n---\nbody\n",
    "quoted entry": '---\ndenied_columns:\n  - "customers.email"\n---\nbody\n',
    "scalar": "---\ndenied_columns: customers.email\n---\nbody\n",
}


@pytest.mark.parametrize("spelling", list(DECLARATION_SPELLINGS))
def test_the_declaration_never_reaches_rule_text_whatever_its_yaml_spelling(spelling):
    path = "knowledge/rules/pii.md"
    r = reader(
        {
            "models": [model("customers", "Customers.", ("id", "email"))],
            "knowledge_rules": [
                {"path": path, "content": DECLARATION_SPELLINGS[spelling]}
            ],
        },
        denied=[("customers", "email")],
    )
    served = json.dumps(
        [
            r.documents()["rules"],
            r.rules_document(),
            r.read([f"rule:{path}"]),
            r.read(["customers"]),
            r.list(1),
        ]
    )
    assert "email" not in served.lower()
    assert "denied_columns" not in served
    assert "body" in r.rules_document()


def test_a_denied_column_that_survives_stripping_refuses_startup():
    surviving = {
        "an alias of the declaration": "---\ndenied_columns: &d [customers.email]\nalso: *d\n---\nbody\n",
        "another key": "---\ndenied_columns: [customers.email]\nnote: customers.email is pii\n---\nbody\n",
        "a near-miss key": "---\nDenied_Columns: [Customers.Email]\n---\nbody\n",
        "a nested value": "---\ndefaults:\n  - {id: x, column: customers.email}\n---\nbody\n",
    }
    for label, content in surviving.items():
        with pytest.raises(DeniedColumnsInvalid, match="pii.md"):
            reader(
                {
                    "models": [model("customers", "Customers.", ("id", "email"))],
                    "knowledge_rules": [
                        {"path": "knowledge/rules/pii.md", "content": content}
                    ],
                },
                denied=[("customers", "email")],
            )
        assert label


def test_an_escaped_spelling_of_a_denied_column_in_a_non_declaring_file_refuses_startup():
    # No denied_columns key here, so nothing is stripped; the file is served as written, and
    # the double-quoted escape hides the name from a search of the raw text.
    content = '---\ndefaults:\n  - {id: x, note: "customers\\x2eemail"}\n---\nbody\n'
    assert "customers.email" not in content
    with pytest.raises(DeniedColumnsInvalid, match="pii.md: customers.email remains"):
        reader(
            {
                "models": [model("customers", "Customers.", ("id", "email"))],
                "knowledge_rules": [
                    {"path": "knowledge/rules/pii.md", "content": content}
                ],
            },
            denied=[("customers", "email")],
        )
    with pytest.raises(DeniedColumnsInvalid):
        strip_denied_declaration(content, frozenset({("customers", "email")}))
    # The same file is fine when the denied column is not the one it names.
    assert (
        strip_denied_declaration(content, frozenset({("customers", "id")})) == content
    )


def test_front_matter_yaml_cannot_read_but_that_mentions_the_key_refuses_startup():
    broken = "---\ndenied_columns: [customers.email\n---\nbody\n"
    with pytest.raises(DeniedColumnsInvalid):
        strip_denied_declaration(broken)
    unrelated = "---\ndefaults: [oops\n---\nbody\n"
    assert strip_denied_declaration(unrelated) == unrelated


def test_the_category_views_have_fixed_ids_and_kinds_and_no_sql():
    r = three_models()
    documents = r.documents()
    assert list(documents) == ["structure", "rules"]
    assert documents["structure"]["kind"] == "schema.structure"
    assert documents["rules"]["kind"] == "knowledge.rules"
    structure = documents["structure"]["content"]
    assert "model orders: One row per order." in structure
    assert "| amount | VARCHAR |" in structure
    assert "SELECT" not in structure.upper()
    assert documents["rules"]["content"] == ""


def test_the_loaded_event_reports_budget_and_paging():
    r = three_models(budget=2048)
    event = r.loaded_event()
    assert event == {
        "event": "context_loaded",
        "digest": "0" * 64,
        "loader_identity": "sha256:test",
        "models": 3,
        "pages": 1,
        "budget_bytes": 2048,
        "first_page_bytes": r.first_page_bytes(),
    }


def semantics_front(entries: str) -> str:
    return f"---\ndenied_columns: [customers.email]\nsemantics:\n{entries}---\nbody\n"


def test_the_real_loader_carries_the_semantics_and_the_manifest(real_project):
    snap = load_snapshot(real_project)
    assert [e["id"] for e in snap.catalog["semantics"]] == [
        "fiscal_calendar_bounds",
        "revenue_definition_match",
    ]
    assert snap.catalog["semantics"][1]["models"] == ["usd_line_value"]
    assert [v["name"] for v in snap.manifest["views"]] == ["usd_line_value"]
    assert snap.catalog["views"][0]["guarantees"] == ["convert-invoices-to-usd"]
    assert snap.declarations[2].domain == ("paid", "shipped", "cancelled", "pending")


@pytest.mark.parametrize(
    ("entries", "message"),
    [
        ("  - {id: a, models: [orders], note: x, extra: 1}\n", "semantics_invalid"),
        (
            "  - {id: a, models: [ghosts], note: fine}\n",
            "a: unknown model or view ghosts",
        ),
        (
            "  - {id: a, models: [orders], note: 'Ranks by email domain.'}\n",
            "a: names a denied column",
        ),
        ("  - {id: a, models: [orders], note: 'Skips customers.email.'}\n", "denied"),
        (
            "  - {id: customers-email, models: [orders], note: fine}\n",
            "names a denied column",
        ),
    ],
)
def test_a_semantics_entry_that_cannot_be_served_refuses_to_start(
    real_project, entries, message
):
    (real_project / "knowledge/rules/conventions.md").write_text(
        semantics_front(entries)
    )
    with pytest.raises((SemanticsInvalid, DeniedColumnsInvalid), match=message):
        load_snapshot(real_project)


def test_a_semantics_entry_may_name_a_view(real_project):
    (real_project / "knowledge/rules/conventions.md").write_text(
        semantics_front("  - {id: a, models: [usd_line_value, orders], note: fine}\n")
    )
    assert load_snapshot(real_project).catalog["semantics"][0]["models"] == [
        "usd_line_value",
        "orders",
    ]


def test_a_manifest_and_a_catalog_that_disagree_about_views_are_inconsistent(
    real_project,
):
    manifest = real_project / "target/mdl.json"
    built = json.loads(manifest.read_text())
    built["views"] = []
    manifest.write_text(json.dumps(built))
    with pytest.raises(ContextInconsistent, match="views"):
        load_snapshot(real_project)


def test_a_sale_statuses_rule_is_listed_on_its_model_and_in_the_rules_summary():
    rule = SaleStatuses(
        id="paid-and-shipped",
        column=ColumnRef("orders", "status"),
        values=("paid",),
        domain=("paid", "void"),
        overridable_by_caller=True,
        aggregated_only=False,
    )
    r = reader(
        {
            "models": [model("orders", "One row per order.", ("id", "status"))],
            "knowledge_rules": [
                {
                    "path": "knowledge/rules/a.md",
                    "content": "---\ndefaults:\n  - {id: paid-and-shipped, kind: sale_statuses}\n---\nbody\n",
                }
            ],
        },
        declarations=(rule,),
    )
    text = r.list()["text"]
    assert "model orders: One row per order. [defaults: paid-and-shipped]" in text
    assert (
        "rule knowledge/rules/a.md: defaults: paid-and-shipped; columns: orders.status"
        in text
    )


# --- declared view columns ---------------------------------------------------------------------

PAID_COLUMNS = [
    {"name": "order_id", "type": "INTEGER", "description": "The order."},
    {"name": "amount", "type": "DOUBLE"},
]


def view_reader(
    columns=PAID_COLUMNS, denied=(), budget=4096, description="Paid orders."
):
    return reader(
        {
            "models": [
                model("orders", "Orders.", ("id", "amount")),
                model("customers", "Customers.", ("id", "email")),
            ],
            "views": [
                {
                    "name": "paid_orders",
                    "description": description,
                    "guarantees": ["exclude-test-orders"],
                    **({"columns": columns} if columns is not None else {}),
                },
                {"name": "plain_orders", "description": "No declared columns."},
            ],
        },
        budget=budget,
        denied=denied,
    )


def test_read_returns_a_views_declared_columns_and_omits_them_when_undeclared():
    r = view_reader()
    paid, plain = r.read(["paid_orders", "plain_orders"])["items"]
    assert paid == {
        "kind": "view",
        "name": "paid_orders",
        "description": "Paid orders.",
        "guarantees": ["exclude-test-orders"],
        "columns": [
            {"name": "order_id", "type": "INTEGER", "description": "The order."},
            {"name": "amount", "type": "DOUBLE"},
        ],
    }
    assert plain == {
        "kind": "view",
        "name": "plain_orders",
        "description": "No declared columns.",
    }


def test_the_list_lines_and_first_page_do_not_change_with_declared_columns():
    with_columns, without = view_reader(), view_reader(columns=None)
    assert with_columns.list(1) == without.list(1)
    assert with_columns.first_page_bytes() == without.first_page_bytes()
    assert (
        "view paid_orders: Paid orders. [guarantees: exclude-test-orders]"
        in with_columns.list(1)["text"]
    )


def test_structure_has_a_column_table_for_a_view_that_declares_columns_only():
    document = view_reader().structure_document()
    assert (
        "## paid_orders\n\n| column | type | description |\n| --- | --- | --- |\n"
        "| order_id | INTEGER | The order. |\n| amount | DOUBLE |  |\n"
    ) in document
    assert "## plain_orders" not in document
    undeclared = view_reader(columns=None).structure_document()
    assert "## paid_orders" not in undeclared
    assert document.startswith(undeclared.split("\n## ")[0])


def test_a_denied_name_is_dropped_from_a_views_columns_whichever_model_owns_it():
    r = view_reader(
        columns=[
            {"name": "order_id", "type": "INTEGER"},
            {"name": "email", "type": "VARCHAR", "description": "Contact address."},
            {
                "name": "amount",
                "type": "DOUBLE",
                "description": "Order value. Joined on customers.email. Shown in USD.",
            },
            {
                "name": "note",
                "type": "VARCHAR",
                "description": "Free text. The email column is not here.",
            },
        ],
        denied=[("customers", "email")],
        description="Paid orders. Contact email is private.",
    )
    view = r.read(["paid_orders"])["items"][0]
    assert view["description"] == "Paid orders."
    assert view["columns"] == [
        {"name": "order_id", "type": "INTEGER"},
        {
            "name": "amount",
            "type": "DOUBLE",
            "description": "Order value. Shown in USD.",
        },
        {"name": "note", "type": "VARCHAR", "description": "Free text."},
    ]
    everything = json.dumps(
        [r.list(1), r.read(["paid_orders"]), r.structure_document()]
    )
    assert "email" not in everything.lower()


def test_a_view_whose_only_columns_are_denied_reads_as_undeclared():
    r = view_reader(
        columns=[{"name": "email", "type": "VARCHAR"}],
        denied=[("customers", "email")],
    )
    assert "columns" not in r.read(["paid_orders"])["items"][0]
    assert "## paid_orders" not in r.structure_document()


def test_an_invalid_view_columns_declaration_refuses_to_start(tmp_path):
    root = project_dir(tmp_path)
    catalog = good_catalog(
        root,
        view_columns_invalid=True,
        diagnostics=[
            {
                "kind": "view_columns_invalid",
                "path": "views/paid/metadata.yml",
                "entry": "columns[0]: type must be a non-empty string",
            }
        ],
    )
    loader = fake_loader(tmp_path, GOOD_PREPARED, catalog)
    with pytest.raises(
        ViewColumnsInvalid,
        match="view_columns_invalid: views/paid/metadata.yml: columns.0.: type must",
    ):
        load_snapshot(root, loader)
    flag_only = fake_loader(
        tmp_path, GOOD_PREPARED, good_catalog(root, view_columns_invalid=True)
    )
    with pytest.raises(ViewColumnsInvalid, match="unreadable view columns"):
        load_snapshot(root, flag_only)


def edit_view_columns(root: Path, columns):
    path = root / "views/usd_line_value/metadata.yml"
    meta = yaml.safe_load(path.read_text())
    meta["columns"] = columns
    path.write_text(yaml.safe_dump(meta, sort_keys=False))


def set_view_statement(root: Path, statement: str):
    source = root / "views/usd_line_value/sql.yml"
    source.write_text(yaml.safe_dump({"statement": statement}, sort_keys=False))
    rebuild_target(root)


def rebuild_target(root: Path):
    (root / "target/mdl.json").write_text(json.dumps(build_json(root)))


def test_stale_model_sql_with_the_same_columns_refuses_to_start(real_project):
    source = real_project / "models/orders/ref_sql.sql"
    source.write_text(source.read_text().strip() + " WHERE id > 0\n")
    with pytest.raises(ContextInconsistent, match="models"):
        load_snapshot(real_project)


def test_stale_model_sql_literal_whitespace_refuses_to_start(real_project):
    source = real_project / "models/orders/ref_sql.sql"
    original = source.read_text().strip()
    source.write_text(original + " WHERE 'a  b' = 'a  b'\n")
    rebuild_target(real_project)
    assert load_snapshot(real_project).manifest["models"]
    source.write_text(original + " WHERE 'a b' = 'a  b'\n")
    with pytest.raises(ContextInconsistent, match="models"):
        load_snapshot(real_project)


def test_stale_view_sql_with_the_same_columns_refuses_to_start(real_project):
    source = real_project / "views/usd_line_value/sql.yml"
    statement = yaml.safe_load(source.read_text())["statement"]
    source.write_text(
        yaml.safe_dump(
            {"statement": statement + " AND invoice_id > 0"}, sort_keys=False
        )
    )
    with pytest.raises(ContextInconsistent, match="views"):
        load_snapshot(real_project)


def test_stale_table_reference_with_the_same_columns_refuses_to_start(real_project):
    source = real_project / "models/orders/metadata.yml"
    metadata = yaml.safe_load(source.read_text())
    (real_project / "models/orders/ref_sql.sql").unlink()
    metadata["table_reference"] = {"table": "orders_one"}
    source.write_text(yaml.safe_dump(metadata, sort_keys=False))
    rebuild_target(real_project)
    assert load_snapshot(real_project).manifest["models"]
    metadata["table_reference"] = {"table": "orders_two"}
    source.write_text(yaml.safe_dump(metadata, sort_keys=False))
    with pytest.raises(ContextInconsistent, match="models"):
        load_snapshot(real_project)


def test_stale_calculated_column_expression_refuses_to_start(real_project):
    source = real_project / "models/orders/metadata.yml"
    metadata = yaml.safe_load(source.read_text())
    calculated = {
        "name": "double_amount",
        "type": "DOUBLE",
        "is_calculated": True,
        "expression": "amount * 2",
    }
    metadata["columns"].append(calculated)
    source.write_text(yaml.safe_dump(metadata, sort_keys=False))
    rebuild_target(real_project)
    assert load_snapshot(real_project).manifest["models"]
    calculated["expression"] = "amount * 3"
    source.write_text(yaml.safe_dump(metadata, sort_keys=False))
    with pytest.raises(ContextInconsistent, match="models"):
        load_snapshot(real_project)


@pytest.mark.parametrize(
    ("field", "value"),
    [("type", "VARCHAR"), ("not_null", False)],
)
def test_stale_model_column_type_or_flag_refuses_to_start(real_project, field, value):
    source = real_project / "models/orders/metadata.yml"
    metadata = yaml.safe_load(source.read_text())
    metadata["columns"][0][field] = value
    source.write_text(yaml.safe_dump(metadata, sort_keys=False))
    with pytest.raises(ContextInconsistent, match="models"):
        load_snapshot(real_project)


@pytest.mark.parametrize(
    ("field", "value"),
    [("primary_key", "customer_id"), ("base_object", "customers")],
)
def test_stale_model_key_or_base_object_refuses_to_start(real_project, field, value):
    source = real_project / "models/orders/metadata.yml"
    metadata = yaml.safe_load(source.read_text())
    metadata[field] = value
    source.write_text(yaml.safe_dump(metadata, sort_keys=False))
    with pytest.raises(ContextInconsistent, match="models"):
        load_snapshot(real_project)


def test_root_cube_mirror_expression_must_match_the_cli_source(real_project):
    cube = {
        "name": "order_totals",
        "base_object": "orders",
        "measures": [
            {"name": "total", "type": "DOUBLE", "expression": "SUM(order_total * 2)"}
        ],
    }
    directory = real_project / "cubes/order_totals"
    directory.mkdir(parents=True)
    (directory / "metadata.yml").write_text(yaml.safe_dump(cube, sort_keys=False))
    (real_project / "cubes.yml").write_text(yaml.safe_dump([cube], sort_keys=False))
    rebuild_target(real_project)
    assert load_snapshot(real_project).manifest["cubes"]
    cube["measures"][0]["expression"] = "SUM(order_total)"
    (real_project / "cubes.yml").write_text(yaml.safe_dump([cube], sort_keys=False))
    with pytest.raises(ContextInconsistent, match="cubes.yml"):
        load_snapshot(real_project)


def test_description_only_source_change_does_not_require_a_rebuild(real_project):
    source = real_project / "models/orders/metadata.yml"
    metadata = yaml.safe_load(source.read_text())
    metadata.setdefault("properties", {})["description"] = "Updated prose only."
    source.write_text(yaml.safe_dump(metadata, sort_keys=False))
    assert load_snapshot(real_project).manifest["models"]


def test_unreadable_current_sources_are_a_controlled_inconsistency(
    real_project, monkeypatch
):
    def unreadable(_):
        raise yaml.YAMLError("bad source")

    monkeypatch.setattr(adapter, "build_json", unreadable)
    with pytest.raises(ContextInconsistent, match="cannot be compared"):
        load_snapshot(real_project)


def test_source_builder_exit_is_a_controlled_inconsistency(real_project, monkeypatch):
    def terminated(_):
        raise SystemExit("private source detail")

    monkeypatch.setattr(adapter, "build_json", terminated)
    with pytest.raises(ContextInconsistent, match="cannot be compared") as raised:
        load_snapshot(real_project)
    assert "private source detail" not in str(raised.value)


def test_source_change_during_current_build_is_context_changed(
    real_project, monkeypatch
):
    source = real_project / "models/orders/ref_sql.sql"

    def moving(_):
        source.write_text(source.read_text() + "\n")
        raise yaml.YAMLError("changed")

    monkeypatch.setattr(adapter, "build_json", moving)
    with pytest.raises(ContextChanged, match="semantics"):
        load_snapshot(real_project)


def test_the_real_loader_carries_and_verifies_the_fixtures_view_columns(real_project):
    snap = load_snapshot(real_project)
    assert [c["name"] for c in snap.catalog["views"][0]["columns"]] == [
        "invoice_id",
        "customer_id",
        "invoice_date",
        "usd_value",
    ]
    assert snap.unverified_views == ()


@pytest.mark.parametrize(
    ("columns", "declared_only", "statement_only"),
    [
        (
            [
                {"name": "invoice_id", "type": "INTEGER"},
                {"name": "customer_id", "type": "INTEGER"},
                {"name": "invoice_date", "type": "DATE"},
            ],
            [],
            ["usd_value"],
        ),
        (
            [
                {"name": c, "type": "INTEGER"}
                for c in (
                    "invoice_id",
                    "customer_id",
                    "invoice_date",
                    "usd_value",
                    "rate",
                )
            ],
            ["rate"],
            [],
        ),
        (
            [
                {"name": c, "type": "INTEGER"}
                for c in ("invoice_id", "customer_id", "invoice_date", "value")
            ],
            ["value"],
            ["usd_value"],
        ),
    ],
)
def test_declared_columns_that_differ_from_the_statements_output_refuse_to_start(
    real_project, columns, declared_only, statement_only
):
    edit_view_columns(real_project, columns)
    with pytest.raises(ContextInconsistent) as raised:
        load_snapshot(real_project)
    message = str(raised.value)
    assert message.startswith("context_inconsistent: view usd_line_value")
    assert f"declared only: {declared_only}" in message
    assert f"statement only: {statement_only}" in message
    assert "SELECT" not in message and "FROM" not in message


def test_a_declaration_may_use_any_case_and_order_but_not_miss_a_column(real_project):
    columns = [
        {"name": c, "type": "INTEGER"}
        for c in ("usd_value", "invoice_date", "customer_id", "invoice_id")
    ]
    edit_view_columns(real_project, columns)
    assert load_snapshot(real_project).unverified_views == ()


@pytest.mark.parametrize(
    "statement",
    [
        "SELECT COLUMNS('i.*') FROM invoices i",
        "SELECT id, amount * 2 FROM invoices",
        "SELECT a.id, b.id FROM invoices a JOIN invoices b ON a.id = b.id",
        "SELECT id FROM not_a_model",
        "SELECT id FROM invoices; SELECT id FROM orders",
    ],
)
def test_a_view_the_host_cannot_read_stably_is_unverified_not_refused(
    real_project, statement
):
    set_view_statement(real_project, statement)
    snap = load_snapshot(real_project)
    assert snap.unverified_views == ("usd_line_value",)


def test_a_view_without_declared_columns_is_neither_checked_nor_unverified(
    real_project,
):
    edit_view_columns(real_project, [])
    set_view_statement(real_project, "SELECT COLUMNS('i.*') FROM invoices i")
    snap = load_snapshot(real_project)
    assert snap.unverified_views == ()
    assert "columns" not in snap.catalog["views"][0]


@pytest.mark.parametrize(
    "columns",
    [
        "invoice_id",
        [{"name": "Invoice-Id", "type": "INTEGER"}],
        [{"name": "invoice_id"}],
        [
            {"name": "invoice_id", "type": "INTEGER"},
            {"name": "invoice_id", "type": "INTEGER"},
        ],
        [{"name": "invoice_id", "type": "INTEGER", "description": "x" * 401}],
    ],
)
def test_a_malformed_columns_declaration_in_a_real_project_refuses_to_start(
    real_project, columns
):
    edit_view_columns(real_project, columns)
    with pytest.raises(ViewColumnsInvalid):
        load_snapshot(real_project)


@pytest.mark.parametrize(
    ("projection", "declared"),
    [
        ("id::BIGINT", "id"),
        ("CAST(id AS BIGINT)", "id"),
        ("TRY_CAST(id AS BIGINT)", "id"),
        ("'a'", "a"),
        ("DATE '2020-01-01'", "x"),
    ],
)
def test_an_unaliased_cast_or_literal_projection_is_not_a_stable_name(
    real_project, projection, declared
):
    edit_view_columns(
        real_project,
        [
            {"name": declared, "type": "INTEGER"},
            {"name": "customer_id", "type": "INTEGER"},
        ],
    )
    set_view_statement(real_project, f"SELECT {projection}, customer_id FROM invoices")
    assert load_snapshot(real_project).unverified_views == ("usd_line_value",)


def test_an_aliased_cast_and_a_bare_column_are_stable_names(real_project):
    edit_view_columns(
        real_project,
        [{"name": "id", "type": "BIGINT"}, {"name": "customer_id", "type": "INTEGER"}],
    )
    set_view_statement(
        real_project, "SELECT id::BIGINT AS id, i.customer_id FROM invoices i"
    )
    assert load_snapshot(real_project).unverified_views == ()


def test_a_denied_name_matches_a_views_column_whatever_its_case():
    r = reader(
        {
            "models": [
                model("customers", "Customers.", ("id", "EMAIL")),
                model("orders", "Orders.", ("id",)),
            ],
            "views": [
                {
                    "name": "contacts",
                    "description": "Contacts.",
                    "columns": [
                        {"name": "id", "type": "INTEGER"},
                        {
                            "name": "email",
                            "type": "VARCHAR",
                            "description": "The address. Never share it.",
                        },
                        {
                            "name": "note",
                            "type": "VARCHAR",
                            "description": "Free text. Mirrors the EMAIL column.",
                        },
                    ],
                }
            ],
        },
        denied=[("customers", "EMAIL")],
    )
    view = r.read(["contacts"])["items"][0]
    assert view["columns"] == [
        {"name": "id", "type": "INTEGER"},
        {"name": "note", "type": "VARCHAR", "description": "Free text."},
    ]
    everything = json.dumps([r.list(1), r.read(["contacts"]), r.structure_document()])
    assert "email" not in everything.lower()


@pytest.mark.parametrize(
    "statement",
    [
        "SELECT * FROM (SELECT id::BIGINT FROM orders) s",
        "SELECT s.* FROM (SELECT CAST(id AS BIGINT) FROM orders) s",
        "SELECT c.* FROM orders a JOIN (SELECT id::BIGINT FROM customers) c ON TRUE",
    ],
)
def test_an_unaliased_cast_inside_a_derived_table_is_not_a_stable_name(
    real_project, statement
):
    edit_view_columns(real_project, [{"name": "id", "type": "BIGINT"}])
    set_view_statement(real_project, statement)
    assert load_snapshot(real_project).unverified_views == ("usd_line_value",)


def test_an_aliased_cast_inside_a_derived_table_is_a_stable_name(real_project):
    edit_view_columns(real_project, [{"name": "id", "type": "BIGINT"}])
    set_view_statement(
        real_project, "SELECT * FROM (SELECT id::BIGINT AS id FROM orders) s"
    )
    assert load_snapshot(real_project).unverified_views == ()


def test_rule_body_never_names_a_denied_column():
    mixed = "knowledge/rules/mixed.md"
    only = "knowledge/rules/only.md"
    r = reader(
        {
            "models": [model("customers", "Customers.", ("id", "email"))],
            "knowledge_rules": [
                {
                    "path": mixed,
                    "content": "---\ndefaults: []\n---\n# Matching\n\n"
                    "Match people on customers.email when merging. Revenue is by region.\n\n"
                    "- Never show Customers.Email in a report.\n- Round to cents.\n",
                },
                {
                    "path": only,
                    "content": "Match on customers.email. Also customers.email again.\n",
                },
            ],
        },
        denied=[("customers", "email")],
    )
    served = json.dumps(
        [
            r.documents()["rules"],
            r.rules_document(),
            r.read([f"rule:{mixed}", f"rule:{only}"]),
            r.list(1),
        ]
    )
    assert "email" not in served.lower()
    body = {
        x["path"]: x["content"]
        for x in r.read([f"rule:{mixed}", f"rule:{only}"])["rules"]
    }
    assert "Revenue is by region." in body[mixed]
    assert "- Round to cents." in body[mixed]
    assert "# Matching" in body[mixed]
    assert body[only] == ""
    assert f"rule {only}" in r.list(1)["text"]


@pytest.mark.parametrize(
    "relative",
    [
        "models",
        "cubes",
        "views",
        "knowledge",
        "knowledge/rules",
        "models/linked",
        "knowledge/rules/loop",
    ],
)
def test_directory_symlink_cycles_fail_with_a_bounded_walk(tmp_path, relative):
    import os  # noqa: PLC0415
    import subprocess  # noqa: PLC0415

    root = tmp_path / "project"
    root.mkdir()
    (root / "wren_project.yml").write_text("name: test\n")
    link = root / relative
    link.parent.mkdir(parents=True, exist_ok=True)
    link.symlink_to(root, target_is_directory=True)
    code = "from pathlib import Path; from wren.context_adapter import project_digest; project_digest(Path(__import__('sys').argv[1]))"
    try:
        result = subprocess.run(
            [sys.executable, "-c", code, str(root)],
            capture_output=True,
            text=True,
            env={**os.environ},
            timeout=2,
        )
    except subprocess.TimeoutExpired:
        pytest.fail("source walk followed a directory-symlink cycle past the deadline")
    assert result.returncode != 0
    assert "directory_symlink_unsupported" in result.stderr


@pytest.mark.parametrize(
    "relative",
    [
        "models",
        "cubes",
        "views",
        "knowledge",
        "knowledge/rules",
        "models/linked",
        "knowledge/rules/loop",
    ],
)
def test_rust_and_python_reject_the_same_directory_symlinks(
    tmp_path, relative, required_loader
):
    import subprocess  # noqa: PLC0415

    root = tmp_path / "project"
    root.mkdir()
    (root / "wren_project.yml").write_text("name: test\n")
    link = root / relative
    link.parent.mkdir(parents=True, exist_ok=True)
    link.symlink_to(root, target_is_directory=True)
    with pytest.raises(OSError, match="directory_symlink_unsupported"):
        project_digest(root)
    loader = required_loader
    result = subprocess.run(
        [
            str(loader),
            str(root),
            "-o",
            str(tmp_path / "context.json"),
            "--catalog-out",
            str(tmp_path / "catalog.json"),
        ],
        capture_output=True,
        text=True,
        timeout=3,
    )
    assert result.returncode != 0 and "directory_symlink_unsupported" in result.stderr


def test_file_symlink_changes_remain_visible_to_both_digests_and_reader(
    real_project, tmp_path
):
    original = real_project / "knowledge/rules/conventions.md"
    target = tmp_path / "external-rule.md"
    original.rename(target)
    original.symlink_to(target)
    before = load_snapshot(real_project)
    text = target.read_text()
    target.write_text(text + "\nAdditional authored rule.\n")
    after = load_snapshot(real_project)
    assert before.digest != after.digest
    assert after.digest == project_digest(real_project)
    assert (
        "Additional authored rule."
        in ContextReader(after, after.denied, 4096).documents()["rules"]["content"]
    )


@pytest.mark.parametrize("relative", ["models", "models/orders"])
def test_digest_rejects_a_directory_swapped_after_classification(
    tmp_path, monkeypatch, relative
):
    import os  # noqa: PLC0415

    if os.name != "posix":
        pytest.skip("requires POSIX descriptor-relative traversal")
    root = tmp_path / "project"
    directory = root / relative
    directory.mkdir(parents=True)
    (root / "wren_project.yml").write_text("name: test\n")
    (directory / "source.yml").write_text("original context")
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "source.yml").write_text("outside context")
    original_stat = os.stat
    swapped = []

    def swap_after_stat(path, *args, **kwargs):
        result = original_stat(path, *args, **kwargs)
        targeted = (kwargs.get("dir_fd") is not None and path == directory.name) or (
            not isinstance(path, int) and Path(path) == directory
        )
        if targeted and not swapped:
            swapped.append(True)
            directory.rename(directory.with_name(".saved"))
            directory.symlink_to(outside, target_is_directory=True)
        return result

    monkeypatch.setattr(os, "stat", swap_after_stat)
    with pytest.raises(OSError, match="directory_symlink_unsupported"):
        project_digest(root)
    assert swapped


@pytest.mark.parametrize("relative", ["models", "models/orders"])
def test_digest_keeps_the_open_directory_when_its_path_is_replaced(
    tmp_path, monkeypatch, relative
):
    import os  # noqa: PLC0415

    if os.name != "posix":
        pytest.skip("requires POSIX descriptor-relative traversal")
    root = tmp_path / "project"
    directory = root / relative
    directory.mkdir(parents=True)
    (root / "wren_project.yml").write_text("name: test\n")
    (directory / "source.yml").write_text("original context")
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "source.yml").write_text("outside context")
    expected = project_digest(root)
    identity = directory.stat()
    original_listdir = os.listdir
    swapped = []

    def swap_before_listdir(path):
        if isinstance(path, int):
            current = os.fstat(path)
            targeted = (current.st_dev, current.st_ino) == (
                identity.st_dev,
                identity.st_ino,
            )
        else:
            targeted = Path(path) == directory
        if targeted and not swapped:
            swapped.append(True)
            directory.rename(directory.with_name(".saved"))
            directory.symlink_to(outside, target_is_directory=True)
        return original_listdir(path)

    monkeypatch.setattr(os, "listdir", swap_before_listdir)
    assert project_digest(root) == expected
    assert swapped


def test_descriptor_digest_keeps_byte_sorted_framing_and_regular_file_links(tmp_path):
    root = tmp_path / "project"
    contents = {
        "wren_project.yml": "name: framing\n",
        "instructions.md": "notes\n",
        "cubes.yml": "cubes: []\n",
        "cubes/a.yml": "cube\n",
        "models/a.yml": "model\n",
        "models/a/member.yml": "member\n",
        "models/a0.yml": "suffix\n",
        "models/é.yml": "unicode\n",
        "models/.hidden.yml": "ignored\n",
    }
    for name, content in contents.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
    target = tmp_path / "external.yml"
    target.write_text("linked\n")
    (root / "models/link.yml").symlink_to(target)
    assert (
        project_digest(root)
        == "9b376e40bbd6d8f73f967ad990a22f0baab496b75f4b5ab41b936d853751871b"
    )


@pytest.mark.parametrize("kind", ["file", "directory"])
def test_non_utf8_managed_names_raise_a_controlled_filesystem_error(tmp_path, kind):
    import errno  # noqa: PLC0415
    import os  # noqa: PLC0415

    if os.name != "posix":
        pytest.skip("requires byte-preserving POSIX filenames")
    root = tmp_path / "project"
    source = root / "knowledge"
    source.mkdir(parents=True)
    path = os.fsencode(source) + b"/invalid-\xff"
    try:
        if kind == "directory":
            os.mkdir(path)
        else:
            fd = os.open(path, os.O_CREAT | os.O_WRONLY, 0o600)
            os.close(fd)
    except OSError as error:
        if error.errno == errno.EILSEQ:
            pytest.skip("filesystem refuses non-UTF8 directory entries")
        raise
    with pytest.raises(OSError, match="non_utf8_source_name"):
        project_digest(root)


def test_hidden_non_utf8_names_still_do_not_contribute_to_the_digest(tmp_path):
    import errno  # noqa: PLC0415
    import os  # noqa: PLC0415

    if os.name != "posix":
        pytest.skip("requires byte-preserving POSIX filenames")
    root = tmp_path / "project"
    source = root / "knowledge"
    source.mkdir(parents=True)
    before = project_digest(root)
    try:
        fd = os.open(
            os.fsencode(source) + b"/.hidden-\xff", os.O_CREAT | os.O_WRONLY, 0o600
        )
    except OSError as error:
        if error.errno == errno.EILSEQ:
            pytest.skip("filesystem refuses non-UTF8 directory entries")
        raise
    os.close(fd)
    assert project_digest(root) == before


@pytest.mark.parametrize("hidden", [False, True])
def test_listed_surrogate_names_are_controlled_before_stat(
    tmp_path, monkeypatch, hidden
):
    import os  # noqa: PLC0415

    root = tmp_path / "project"
    source = root / "knowledge"
    source.mkdir(parents=True)
    expected = project_digest(root)
    identity = source.stat()
    original = os.listdir

    def listed(path):
        info = os.fstat(path) if isinstance(path, int) else Path(path).stat()
        if (info.st_dev, info.st_ino) == (identity.st_dev, identity.st_ino):
            return [".hidden-\udcff" if hidden else "invalid-\udcff"]
        return original(path)

    monkeypatch.setattr(os, "listdir", listed)
    if hidden:
        assert project_digest(root) == expected
    else:
        with pytest.raises(OSError, match="non_utf8_source_name"):
            project_digest(root)


@pytest.mark.parametrize(
    "reference", ['"customers"."email"', "customers . email", "`customers`.`email`"]
)
def test_rule_redaction_handles_quoted_and_spaced_identifiers(reference):
    assert (
        adapter._prose(
            f"Use {reference} to match. Keep regional rules.",
            None,
            frozenset({("customers", "email")}),
        )
        == "Keep regional rules."
    )


def test_qualified_denied_column_match_has_identifier_boundaries():
    sentence = "Use customers.email_verified for matching."
    assert (
        adapter._prose(sentence, None, frozenset({("customers", "email")})) == sentence
    )


def test_cube_catalog_cannot_disagree_with_built_cube_members():
    catalog = {
        "cubes": [
            {
                "name": "sales",
                "base_object": "orders",
                "measures": [{"name": "gross", "type": "DOUBLE"}],
            }
        ]
    }
    manifest = {
        "cubes": [
            {
                "name": "sales",
                "baseObject": "orders",
                "measures": [
                    {"name": "net", "type": "DOUBLE", "expression": "SUM(amount)"}
                ],
            }
        ]
    }
    with pytest.raises(ContextInconsistent, match="cube"):
        adapter._check_consistent(catalog, manifest)


@pytest.mark.parametrize(
    "field,authored,built",
    [
        ("granularities", ["day"], ["month"]),
        ("date_range", ["2026-01-01", "2026-06-30"], ["2026-02-01", "2026-06-30"]),
    ],
)
def test_cube_time_settings_must_match_the_built_manifest(field, authored, built):
    name = "dateRange" if field == "date_range" else field
    catalog = {
        "cubes": [
            {
                "name": "sales",
                "base_object": "orders",
                "time_dimensions": [{"name": "day", "type": "DATE", field: authored}],
            }
        ]
    }
    manifest = {
        "cubes": [
            {
                "name": "sales",
                "baseObject": "orders",
                "timeDimensions": [{"name": "day", "type": "DATE", name: built}],
            }
        ]
    }
    with pytest.raises(ContextInconsistent, match="cube"):
        adapter._check_consistent(catalog, manifest)


@pytest.mark.parametrize("field", ["condition", "models", "joinType"])
def test_relationship_execution_drift_refuses_stale_target(real_project, field):
    source = real_project / "relationships.yml"
    relations = yaml.safe_load(source.read_text())
    relation = relations["relationships"][0]
    if field == "condition":
        relation[field] += " AND 1 = 0"
    elif field == "models":
        relation[field] = list(reversed(relation[field]))
    else:
        relation["join_type"] = "one_to_one"
    source.write_text(yaml.safe_dump(relations))
    with pytest.raises(ContextInconsistent, match="relationships"):
        load_snapshot(real_project)
    rebuild_target(real_project)
    assert load_snapshot(real_project).manifest["relationships"]


def test_enum_meanings_are_redacted_without_mutating_catalog():
    catalog = {"models": [model("customers", columns=("id", "tier"))]}
    values = [
        {"value": "gold", "meaning": "Derived from customers.email."},
        {
            "value": "silver",
            "meaning": "Public tier. Uses customers.email.",
            "source": "metadata",
        },
    ]
    catalog["models"][0]["columns"][1]["enum_values"] = values
    r = reader(catalog, denied={("customers", "email")})
    output = r.read(["customers"])["items"][0]["columns"][1]
    assert output["enum_values"] == [
        {"value": "silver", "meaning": "Public tier.", "source": "metadata"}
    ]
    assert values[0]["meaning"] == "Derived from customers.email."
    assert values[1]["meaning"] == "Public tier. Uses customers.email."


def test_relationship_prose_and_outer_whitespace_do_not_require_rebuild(real_project):
    source = real_project / "relationships.yml"
    document = yaml.safe_load(source.read_text())
    relation = document["relationships"][0]
    relation["description"] = "A new explanation of the same relationship."
    relation["condition"] = "  " + relation["condition"] + "\n"
    source.write_text(yaml.safe_dump(document))
    assert load_snapshot(real_project).manifest["relationships"]


def test_hidden_rules_stay_out_of_snapshot_and_fingerprint(real_project):
    before = load_snapshot(real_project)
    hidden = real_project / "knowledge/rules/.private.md"
    visible = real_project / "knowledge/rules/conventions.md"
    hidden.write_text(visible.read_text())
    first = load_snapshot(real_project)
    assert first.digest == before.digest
    assert first.declarations == before.declarations
    hidden.write_text(hidden.read_text() + "\nA private note.\n")
    second = load_snapshot(real_project)
    assert second.digest == before.digest
    assert second.declarations == before.declarations


def test_enum_without_authored_meaning_is_kept_but_redacted_meaning_is_not():
    catalog = {"models": [model("customers", columns=("id", "tier"))]}
    values = [
        {"value": "missing"},
        {"value": "null", "meaning": None},
        {"value": "blank", "meaning": " "},
        {"value": "safe", "meaning": "Public tier."},
        {"value": "secret", "meaning": "Derived from customers.email."},
    ]
    catalog["models"][0]["columns"][1]["enum_values"] = values
    r = reader(catalog, denied={("customers", "email")})
    assert r.read(["customers"])["items"][0]["columns"][1]["enum_values"] == [
        {"value": "missing"},
        {"value": "null"},
        {"value": "blank"},
        {"value": "safe", "meaning": "Public tier."},
    ]
    assert values[1] == {"value": "null", "meaning": None}
    assert values[-1]["meaning"] == "Derived from customers.email."


def test_missing_enum_meanings_do_not_shrink_declared_status_domain(real_project):
    source = real_project / "models/orders/metadata.yml"
    document = yaml.safe_load(source.read_text())
    status = next(c for c in document["columns"] if c["name"] == "status")
    status["properties"]["enum_values"] = [
        {"value": "paid", "meaning": "Payment received."},
        {"value": "shipped"},
        {"value": "cancelled", "meaning": ""},
        {"value": "pending", "meaning": "Derived from customers.email."},
    ]
    source.write_text(yaml.safe_dump(document, sort_keys=False))
    rebuild_target(real_project)
    snap = load_snapshot(real_project)
    rule = next(r for r in snap.declarations if r.id == "count-paid-and-shipped")
    assert rule.domain == ("paid", "shipped", "cancelled", "pending")
    output = ContextReader(snap, snap.denied, 4096).read(["orders"])
    column = next(c for c in output["items"][0]["columns"] if c["name"] == "status")
    assert column["enum_values"] == [
        {"value": "paid", "meaning": "Payment received."},
        {"value": "shipped"},
        {"value": "cancelled"},
    ]


def test_hidden_relationship_condition_is_omitted_without_expanding_denied():
    customers = model("customers", columns=("id", "secret"))
    customers["columns"][1]["is_hidden"] = True
    r = reader(
        {
            "models": [customers, model("orders", columns=("id", "customer_id"))],
            "relationships": [
                {
                    "name": "private_join",
                    "models": ["customers", "orders"],
                    "join_type": "MANY_TO_ONE",
                    "condition": '"customers" . "secret" = orders.customer_id',
                }
            ],
        }
    )
    assert "secret" not in r.structure_document()
    assert not r.denied
    assert not r.read(["customers"])["items"][0].get("relationships")


@pytest.mark.parametrize("newline", ["\n", "\r\n", "\r"])
def test_rule_body_split_qualified_identifier_is_redacted_with_layout(newline):
    content = "# Safe title\n\n- Keep this bullet.\nMatch on customers.\nemail for identity.\n\n- Keep the last bullet.\n"
    content = content.replace("\n", newline)
    r = reader(
        {
            "models": [model("customers", columns=("id", "email"))],
            "knowledge_rules": [
                {"path": "knowledge/rules/split.md", "content": content}
            ],
        },
        denied={("customers", "email")},
    )
    served = r.rules_document()
    assert "email" not in served.lower()
    assert ("# Safe title" + newline * 2 + "- Keep this bullet.") in served
    assert (newline * 2 + "- Keep the last bullet.") in served


@pytest.mark.parametrize(
    "reference",
    ['"customers" . "email"', "`customers` . `email`", "[customers] . [email]"],
)
def test_front_matter_denied_references_use_qualified_matcher(reference):
    content = "---\nnote: '" + reference + "'\n---\nSafe body.\n"
    with pytest.raises(DeniedColumnsInvalid):
        strip_denied_declaration(content, frozenset({("customers", "email")}))


def test_rules_omitted_from_summary_stay_discoverable_on_bounded_index_pages():
    rules = [
        {"path": f"knowledge/rules/{i:03d}-交易規則.md", "content": f"Safe rule {i}."}
        for i in range(40)
    ]
    r = reader({"models": [model("orders")], "knowledge_rules": rules}, budget=2048)
    pages = [r.list(page)["text"] for page in range(1, r.pages + 1)]
    assert all(len(page.encode()) <= 2048 for page in pages)
    assert r.pages > 1
    for rule in rules:
        ident = "rule:" + rule["path"]
        assert any(ident in page for page in pages)
        assert r.read([ident])["rules"] == [
            {"path": rule["path"], "content": rule["content"]}
        ]


def test_long_rule_path_gets_readable_collision_free_index_selector():
    path = "knowledge/rules/" + "很長" * 1000 + ".md"
    r = reader(
        {
            "models": [model("@context-1")],
            "knowledge_rules": [{"path": path, "content": "Safe text."}],
        },
        budget=2048,
    )
    lines = [
        line
        for page in range(1, r.pages + 1)
        for line in r.list(page)["text"].splitlines()
        if line.startswith("rule @context-")
    ]
    assert lines
    selector = lines[0].split(": ", 1)[0].removeprefix("rule ")
    assert selector != "@context-1"
    assert r.read([selector])["rules"] == [{"path": path, "content": "Safe text."}]
    assert all(
        len(r.list(page)["text"].encode()) <= 2048 for page in range(1, r.pages + 1)
    )
