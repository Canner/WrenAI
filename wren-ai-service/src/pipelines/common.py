import asyncio
import re
from typing import Any, List, Optional, Tuple

from haystack import Document, component


def build_project_deploy_filter(
    project_id: Optional[str] = None,
    mdl_hash: Optional[str] = None,
) -> dict[str, Any] | None:
    conditions = []

    if project_id:
        conditions.append(
            {"field": "project_id", "operator": "==", "value": project_id}
        )

    if mdl_hash:
        conditions.append({"field": "mdl_hash", "operator": "==", "value": mdl_hash})

    return {"operator": "AND", "conditions": conditions} if conditions else None


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
    emitted_columns = set()
    emitted_relationships = set()
    has_calculated_field = False
    has_json_field = False
    relationship_columns = set()
    for column in content["columns"]:
        if column["type"] not in {"FOREIGN_KEY", "JOIN_PATH"}:
            continue
        if tables and not set(column.get("tables", [])).issubset(tables):
            continue
        if column.get("column"):
            relationship_columns.add(column.get("column"))
        relationship_columns.update(column.get("columns", []) or [])
    relationship_columns.discard(None)

    for column in content["columns"]:
        if column["type"] == "COLUMN":
            normalized_column_name = str(column["name"]).lower()
            if normalized_column_name in emitted_columns:
                continue

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
                emitted_columns.add(normalized_column_name)
        elif column["type"] in {"FOREIGN_KEY", "JOIN_PATH"}:
            if not tables or (tables and set(column.get("tables", [])).issubset(tables)):
                relationship_key = column.get("constraint", "")
                if relationship_key in emitted_relationships:
                    continue

                relationship_comment = (
                    column["comment"] if include_semantic_comments else ""
                )
                columns_ddl.append(f"{relationship_comment}{column['constraint']}")
                emitted_relationships.add(relationship_key)

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


async def retrieve_metadata(
    project_id: str,
    retriever,
    mdl_hash: Optional[str] = None,
) -> dict[str, Any]:
    cache_key = (
        id(retriever),
        str(project_id),
        str(mdl_hash),
    )
    if project_id and mdl_hash:
        if cache_key in _METADATA_CACHE:
            return _METADATA_CACHE[cache_key]

        lock = _METADATA_CACHE_LOCKS.setdefault(cache_key, asyncio.Lock())
        async with lock:
            if cache_key in _METADATA_CACHE:
                return _METADATA_CACHE[cache_key]

            metadata = await _retrieve_metadata_uncached(project_id, retriever, mdl_hash)
            _METADATA_CACHE[cache_key] = metadata
            return metadata

    return await _retrieve_metadata_uncached(project_id, retriever, mdl_hash)


_METADATA_CACHE: dict[tuple[int, str, str], dict[str, Any]] = {}
_METADATA_CACHE_LOCKS: dict[tuple[int, str, str], asyncio.Lock] = {}


async def _retrieve_metadata_uncached(
    project_id: str,
    retriever,
    mdl_hash: Optional[str] = None,
) -> dict[str, Any]:
    filters = build_project_deploy_filter(project_id=project_id, mdl_hash=mdl_hash)

    result = await retriever.run(query_embedding=[], filters=filters)
    documents = result["documents"]

    # only one document for a project, thus we can return the first one
    if documents:
        doc = documents[0]
        return doc.meta
    else:
        return {}


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
