import ast
import re
from typing import Any, List, Optional, Tuple

from haystack import Document, component


def get_engine_supported_data_type(data_type: str | None) -> str:
    """
    This function makes sure downstream ai pipeline get column data types in a format that is supported by the data engine.
    """
    if not data_type:
        return "UNKNOWN"

    match data_type.upper():
        case "BPCHAR" | "NAME" | "UUID" | "INET":
            return "VARCHAR"
        case "OID":
            return "INT"
        case "BIGNUMERIC":
            return "NUMERIC"
        case "BYTES":
            return "BYTEA"
        case "DATETIME":
            return "TIMESTAMP"
        case "FLOAT64":
            return "DOUBLE"
        case "INT64":
            return "BIGINT"
        case _:
            return data_type.upper()


def build_table_ddl(
    content: dict,
    columns: Optional[set[str]] = None,
    tables: Optional[set[str]] = None,
    include_semantic_comments: bool = True,
) -> Tuple[str, bool, bool]:
    columns_ddl = []
    has_calculated_field = False
    has_json_field = False
    relationship_columns = {
        column.get("column")
        for column in content["columns"]
        if column["type"] == "FOREIGN_KEY"
        and (not tables or set(column.get("tables", [])).issubset(tables))
    }
    relationship_columns.discard(None)

    for column in content["columns"]:
        if column["type"] == "COLUMN":
            raw_data_type = column["data_type"]
            supported_data_type = get_engine_supported_data_type(raw_data_type)
            if (
                (
                    not columns
                    or column["name"] in columns
                    or column["name"] in relationship_columns
                    or column["is_primary_key"]
                )
                and (
                    raw_data_type is None
                    or supported_data_type.lower()
                    != "unknown"  # quick fix: filtering out UNKNOWN column type
                )
            ):
                if "This column is a Calculated Field" in column["comment"]:
                    has_calculated_field = True
                if supported_data_type.lower() == "json":
                    has_json_field = True
                column_comment = column["comment"] if include_semantic_comments else ""
                column_ddl = f"{column_comment}{column['name']} {supported_data_type}"
                if column["is_primary_key"]:
                    column_ddl += " PRIMARY KEY"
                columns_ddl.append(column_ddl)
        elif column["type"] == "FOREIGN_KEY":
            if not tables or (tables and set(column.get("tables", [])).issubset(tables)):
                relationship_comment = (
                    column["comment"] if include_semantic_comments else ""
                )
                columns_ddl.append(f"{relationship_comment}{column['constraint']}")

    table_comment = content["comment"] if include_semantic_comments else ""
    return (
        (
            f"{table_comment}CREATE TABLE {content['name']} (\n  "
            + ",\n  ".join(columns_ddl)
            + "\n);"
        ),
        has_calculated_field,
        has_json_field,
    )


async def retrieve_metadata(project_id: str, retriever) -> dict[str, Any]:
    filters = None
    if project_id:
        filters = {
            "operator": "AND",
            "conditions": [
                {"field": "project_id", "operator": "==", "value": project_id},
            ],
        }

    result = await retriever.run(query_embedding=[], filters=filters)
    documents = result["documents"]

    # only one document for a project, thus we can return the first one
    if documents:
        doc = documents[0]
        return doc.meta
    else:
        return {}


def resolve_schema_manifest(
    metadata: dict[str, Any],
    schema_manifest: dict[str, list[str]] | None,
) -> dict[str, list[str]] | None:
    active_schema_manifest = metadata.get("schema_manifest")
    if isinstance(active_schema_manifest, dict) and active_schema_manifest:
        return active_schema_manifest

    return schema_manifest


async def retrieve_schema_manifest(
    project_id: str,
    retriever,
) -> dict[str, list[str]]:
    filters: dict[str, Any] = {
        "operator": "AND",
        "conditions": [
            {"field": "type", "operator": "==", "value": "TABLE_SCHEMA"},
        ],
    }
    if project_id:
        filters["conditions"].append(
            {"field": "project_id", "operator": "==", "value": project_id}
        )

    result = await retriever.run(query_embedding=[], filters=filters, top_k=10000)
    manifest: dict[str, list[str]] = {}

    for document in result.get("documents", []):
        content = ast.literal_eval(document.content)
        table_name = document.meta.get("name") or content.get("name")
        if not table_name:
            continue

        manifest.setdefault(table_name, [])
        if content.get("type") == "TABLE_COLUMNS":
            column_names = [
                column["name"]
                for column in content.get("columns", [])
                if column.get("type") == "COLUMN"
                and column.get("name")
                and column.get("data_type", "").lower() != "unknown"
            ]
        elif content.get("type") in {"VIEW", "METRIC"}:
            column_names = [
                column["name"]
                for column in content.get("columns", [])
                if column.get("name")
                and column.get("data_type", "").lower() != "unknown"
            ]
        else:
            column_names = []

        for column_name in column_names:
            if column_name not in manifest[table_name]:
                manifest[table_name].append(column_name)

    return {table_name: columns for table_name, columns in manifest.items() if columns}


async def resolve_active_schema_manifest(
    metadata: dict[str, Any],
    schema_manifest: dict[str, list[str]] | None,
    project_id: str,
    dbschema_retriever,
) -> dict[str, list[str]] | None:
    resolved_schema_manifest = resolve_schema_manifest(metadata, schema_manifest)
    if metadata.get("schema_manifest") or not project_id:
        return resolved_schema_manifest

    indexed_schema_manifest = await retrieve_schema_manifest(
        project_id=project_id,
        retriever=dbschema_retriever,
    )
    return indexed_schema_manifest or resolved_schema_manifest


@component
class ScoreFilter:
    @component.output_types(
        documents=List[Document],
    )
    def run(
        self,
        documents: List[Document],
        score: float = 0.9,
        max_size: int = 10,
    ):
        return {
            "documents": sorted(
                filter(lambda document: document.score >= score, documents),
                key=lambda document: document.score,
                reverse=True,
            )[:max_size]
        }


MULTIPLE_NEW_LINE_REGEX = re.compile(r"\n{3,}")


def clean_up_new_lines(text: str) -> str:
    return MULTIPLE_NEW_LINE_REGEX.sub("\n\n\n", text)
