"""Execute native relationship projections against self-contained DuckDB fixtures."""

import base64
import copy
import json
from pathlib import Path

import duckdb
import pytest
import wren_core

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "relationship_identity"


@pytest.fixture
def db(tmp_path):
    """Create disjoint finding/project identities in a temporary database."""
    path = tmp_path / "scope_a.duckdb"
    with duckdb.connect(str(path)) as c:
        c.execute((FIXTURES / "fixture.sql").read_text())
    return path


@pytest.fixture
def mdl():
    return json.loads((FIXTURES / "mdl.json").read_text())


def query(db, mdl, sql):
    """Transform through the native binding and execute SQL without row repair."""
    ctx = wren_core.SessionContext(
        base64.b64encode(json.dumps(mdl).encode()).decode(),
        None,
        None,
        "duckdb",
    )
    expanded = ctx.transform_sql(sql)
    with duckdb.connect() as c:
        c.execute("ATTACH ? AS scope_a (READ_ONLY)", [str(db)])
        result = c.execute(expanded)
        names = [d[0] for d in result.description]
        return names, result.fetchall()


def model(mdl, name):
    return next(m for m in mdl["models"] if m["name"] == name)


def add_finding_columns(mdl, *columns):
    """Return a copy of the manifest with calculated TenderFinding columns."""
    mdl = copy.deepcopy(mdl)
    model(mdl, "TenderFinding")["columns"].extend(
        {"name": name, "type": "VARCHAR", "isCalculated": True, "expression": expr}
        for name, expr in columns
    )
    return mdl


def with_target_id(mdl):
    """Expose the related project identity alongside the finding identity."""
    return add_finding_columns(mdl, ("project_key", "project.id"))


def test_original_identity_and_shared_project(db, mdl):
    _, rows = query(db, mdl, (FIXTURES / "query.sql").read_text())
    assert rows == [("f1", "Project One"), ("f2", "Project One")]


def test_projection_order(db, mdl):
    sql = 'SELECT project_name, id FROM "TenderFinding" ORDER BY id'
    _, rows = query(db, mdl, sql)
    assert rows == [("Project One", "f1"), ("Project One", "f2")]


def test_source_and_target_identity_together(db, mdl):
    sql = 'SELECT id, project_key, project_name FROM "TenderFinding" ORDER BY id'
    _, rows = query(db, with_target_id(mdl), sql)
    assert rows == [("f1", "p1", "Project One"), ("f2", "p1", "Project One")]


def test_calculated_expression_binds_bare_columns_to_defining_model(db, mdl):
    mdl = add_finding_columns(
        mdl,
        ("project_key", "project.id"),
        ("finding_label", "concat(id, ':', project.name)"),
    )
    sql = 'SELECT id, project_key, finding_label FROM "TenderFinding" ORDER BY id'
    _, rows = query(db, mdl, sql)
    assert rows == [("f1", "p1", "f1:Project One"), ("f2", "p1", "f2:Project One")]


def test_id_only_without_relationship_projection(db, mdl):
    _, rows = query(db, mdl, 'SELECT id FROM "TenderFinding" ORDER BY id')
    assert rows == [("f1",), ("f2",)]


def test_public_aliases(db, mdl):
    sql = (
        "SELECT id AS finding_identity, project_name AS project_label "
        'FROM "TenderFinding" ORDER BY finding_identity'
    )
    names, rows = query(db, mdl, sql)
    assert names == ["finding_identity", "project_label"]
    assert rows == [("f1", "Project One"), ("f2", "Project One")]


def test_to_many_distinct_identity_uses_original_dimension(db, mdl):
    """Count finding identities while retaining the project dimension."""
    mdl = copy.deepcopy(mdl)
    model(mdl, "TenderProject")["columns"].extend(
        [
            {
                "name": "findings",
                "type": "TenderFinding",
                "relationship": "finding_project",
            },
            {
                "name": "finding_count",
                "type": "BIGINT",
                "isCalculated": True,
                "expression": "COUNT(DISTINCT findings.id)",
            },
        ]
    )
    sql = 'SELECT id, finding_count FROM "TenderProject" ORDER BY id'
    _, rows = query(db, mdl, sql)
    assert rows == [("p1", 2)]


def test_null_relationship_preserves_source_identity(db, mdl):
    """Retain the finding and null target fields for a missing relationship."""
    mdl = with_target_id(mdl)
    project_id = next(
        c for c in model(mdl, "TenderFinding")["columns"] if c["name"] == "project_id"
    )
    project_id["notNull"] = False
    with duckdb.connect(str(db)) as c:
        c.execute("ALTER TABLE src_review_row ALTER COLUMN project_ref DROP NOT NULL")
        c.execute("INSERT INTO src_review_row VALUES ('f3', NULL)")
    sql = 'SELECT id, project_key, project_name FROM "TenderFinding" ORDER BY id'
    _, rows = query(db, mdl, sql)
    assert rows == [
        ("f1", "p1", "Project One"),
        ("f2", "p1", "Project One"),
        ("f3", None, None),
    ]
