import re
from typing import Any, List, Optional, Tuple

from haystack import Document, component

PROJECT_BRIDGE_SCOPE_FIELD = "project_id"


def normalize_runtime_scope_id(value: str | int | None) -> Optional[str]:
    if value is None:
        return None

    normalized = str(value).strip()
    return normalized or None


def normalize_runtime_scope_ids(
    value: str | int | list[str | int] | tuple[str | int, ...] | None,
) -> list[str]:
    if value is None:
        return []

    if isinstance(value, (list, tuple)):
        raw_scope_ids = value
    else:
        raw_scope_ids = str(value).split(",")

    normalized_scope_ids: list[str] = []
    for raw_scope_id in raw_scope_ids:
        normalized_scope_id = normalize_runtime_scope_id(raw_scope_id)
        if (
            normalized_scope_id
            and normalized_scope_id not in normalized_scope_ids
        ):
            normalized_scope_ids.append(normalized_scope_id)

    return normalized_scope_ids


def resolve_pipeline_runtime_scope_id(
    runtime_scope_id: str | int | None = None,
    *,
    bridge_scope_id: str | int | None = None,
) -> Optional[str]:
    """
    Resolve the canonical runtime scope id used inside pipelines.

    `bridge_scope_id` is the compatibility bridge name for old
    project-scoped callers while the service surface finishes migrating to
    runtime-scope-first naming.
    """

    return normalize_runtime_scope_id(runtime_scope_id) or normalize_runtime_scope_id(
        bridge_scope_id
    )


def build_runtime_scope_filters(
    scope_id: str | int | None,
    *,
    conditions: Optional[list[dict[str, Any]]] = None,
) -> Optional[dict[str, Any]]:
    """
    Build retrieval/indexing filters for the current runtime scope.

    Storage backends still index documents by the `project_id` compatibility meta field
    during the migration window. Keep that bridge detail localized here so the
    rest of the pipelines can stay runtime-scope-first.
    """

    merged_conditions = list(conditions or [])
    normalized_scope_ids = normalize_runtime_scope_ids(scope_id)
    if len(normalized_scope_ids) == 1:
        merged_conditions.append(
            {
                "field": PROJECT_BRIDGE_SCOPE_FIELD,
                "operator": "==",
                "value": normalized_scope_ids[0],
            }
        )
    elif len(normalized_scope_ids) > 1:
        merged_conditions.append(
            {
                "operator": "OR",
                "conditions": [
                    {
                        "field": PROJECT_BRIDGE_SCOPE_FIELD,
                        "operator": "==",
                        "value": normalized_scope_id,
                    }
                    for normalized_scope_id in normalized_scope_ids
                ],
            }
        )

    if not merged_conditions:
        return None

    return {
        "operator": "AND",
        "conditions": merged_conditions,
    }


def build_runtime_scope_meta(scope_id: str | int | None) -> dict[str, str]:
    normalized_scope_id = normalize_runtime_scope_id(scope_id)
    if not normalized_scope_id:
        return {}

    return {PROJECT_BRIDGE_SCOPE_FIELD: normalized_scope_id}


def get_engine_supported_data_type(data_type: str) -> str:
    """
    This function makes sure downstream ai pipeline get column data types in a format that is supported by the data engine.
    """
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
    content: dict, columns: Optional[set[str]] = None, tables: Optional[set[str]] = None
) -> Tuple[str, bool, bool]:
    columns_ddl = []
    has_calculated_field = False
    has_json_field = False

    for column in content["columns"]:
        if column["type"] == "COLUMN":
            if (
                (not columns or (columns and column["name"] in columns))
                and column["data_type"].lower()
                != "unknown"  # quick fix: filtering out UNKNOWN column type
            ):
                if "This column is a Calculated Field" in column["comment"]:
                    has_calculated_field = True
                if column["data_type"].lower() == "json":
                    has_json_field = True
                column_ddl = f"{column['comment']}{column['name']} {get_engine_supported_data_type(column['data_type'])}"
                if column["is_primary_key"]:
                    column_ddl += " PRIMARY KEY"
                columns_ddl.append(column_ddl)
        elif column["type"] == "FOREIGN_KEY":
            if not tables or (tables and set(column["tables"]).issubset(tables)):
                columns_ddl.append(f"{column['comment']}{column['constraint']}")

    return (
        (
            f"{content['comment']}CREATE TABLE {content['name']} (\n  "
            + ",\n  ".join(columns_ddl)
            + "\n);"
        ),
        has_calculated_field,
        has_json_field,
    )


async def retrieve_metadata(scope_id: str | int | None, retriever) -> dict[str, Any]:
    filters = build_runtime_scope_filters(scope_id)
    result = await retriever.run(query_embedding=[], filters=filters)
    documents = result["documents"]

    # only one metadata document is expected for a runtime scope
    if documents:
        doc = documents[0]
        return doc.meta
    else:
        return {}


async def retrieve_data_source(
    scope_id: str | int | None,
    retriever,
    *,
    default: str = "local_file",
) -> str:
    metadata = await retrieve_metadata(scope_id, retriever)
    return metadata.get("data_source", default)


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
