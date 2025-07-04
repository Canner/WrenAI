from typing import Any, List, Optional, Tuple

from haystack import Document, component

from src.core.pipeline import BasicPipeline


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
) -> Tuple[str, bool]:
    columns_ddl = []
    has_calculated_field = False

    for column in content["columns"]:
        if column["type"] == "COLUMN":
            if (
                (not columns or (columns and column["name"] in columns))
                and column["data_type"].lower()
                != "unknown"  # quick fix: filtering out UNKNOWN column type
            ):
                if "This column is a Calculated Field" in column["comment"]:
                    has_calculated_field = True
                column_ddl = f"{column['comment']}{column['name']} {get_engine_supported_data_type(column['data_type'])}"
                if column["is_primary_key"]:
                    column_ddl += " PRIMARY KEY"
                columns_ddl.append(column_ddl)
        elif column["type"] == "FOREIGN_KEY":
            if not tables or (tables and set(column["tables"]).issubset(tables)):
                columns_ddl.append(f"{column['comment']}{column['constraint']}")

    return (
        f"{content['comment']}CREATE TABLE {content['name']} (\n  "
        + ",\n  ".join(columns_ddl)
        + "\n);"
    ), has_calculated_field


def dry_run_pipeline(
    pipeline_cls: BasicPipeline,
    pipeline_name: str,
    method: str = "run",
    **kwargs,
):
    from langfuse.decorators import langfuse_context

    from src.config import settings
    from src.core.pipeline import async_validate
    from src.providers import generate_components
    from src.utils import init_langfuse, setup_custom_logger

    setup_custom_logger(
        "wren-ai-service", level_str=settings.logging_level, is_dev=True
    )

    pipe_components = generate_components(settings.components)
    pipeline = pipeline_cls(**pipe_components[pipeline_name])
    init_langfuse(settings)

    async_validate(lambda: getattr(pipeline, method)(**kwargs))

    langfuse_context.flush()


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
