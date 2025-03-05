from typing import List, Optional, Tuple

from haystack import Document, component

from src.core.pipeline import BasicPipeline


def build_table_ddl(
    content: dict, columns: Optional[set[str]] = None, tables: Optional[set[str]] = None
) -> Tuple[str, bool]:
    columns_ddl = []
    has_calculated_field = False

    for column in content["columns"]:
        if column["type"] == "COLUMN":
            if not columns or (columns and column["name"] in columns):
                if "This column is a Calculated Field" in column["comment"]:
                    has_calculated_field = True
                column_ddl = (
                    f"{column['comment']}{column['name']} {column['data_type']}"
                )
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


def dry_run_pipeline(pipeline_cls: BasicPipeline, pipeline_name: str, **kwargs):
    from langfuse.decorators import langfuse_context

    from src.config import settings
    from src.core.pipeline import async_validate
    from src.providers import generate_components
    from src.utils import init_langfuse, setup_custom_logger

    setup_custom_logger("wren-ai-service", level_str=settings.logging_level)

    pipe_components = generate_components(settings.components)
    pipeline = pipeline_cls(**pipe_components[pipeline_name])
    init_langfuse(settings)

    async_validate(lambda: pipeline.run(**kwargs))

    langfuse_context.flush()


@component
class ScoreFilter:
    @component.output_types(
        documents=List[Document],
    )
    def run(self, documents: List[Document], score: float = 0.9):
        return {
            "documents": sorted(
                filter(lambda document: document.score >= score, documents),
                key=lambda document: document.score,
                reverse=True,
            )
        }
