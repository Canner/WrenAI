from datetime import datetime
from typing import Optional

import pytz

from src.core.pipeline import BasicPipeline
from src.web.v1.services import Configuration


def show_current_time(timezone: Configuration.Timezone):
    # Get the current time in the specified timezone
    tz = pytz.timezone(
        timezone.name
    )  # Assuming timezone.name contains the timezone string
    current_time = datetime.now(tz)

    return f'{current_time.strftime("%Y-%m-%d %A %H:%M:%S")}'  # YYYY-MM-DD weekday_name HH:MM:SS, ex: 2024-10-23 Wednesday 12:00:00


def build_table_ddl(
    content: dict, columns: Optional[set[str]] = None, tables: Optional[set[str]] = None
) -> str:
    columns_ddl = []
    for column in content["columns"]:
        if column["type"] == "COLUMN":
            if not columns or (columns and column["name"] in columns):
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
    )


def dry_run_pipeline(pipeline_cls: BasicPipeline, pipeline_name: str, **kwargs):
    from langfuse.decorators import langfuse_context

    from src.config import settings
    from src.core.pipeline import async_validate
    from src.providers import generate_components
    from src.utils import init_langfuse, setup_custom_logger

    setup_custom_logger("wren-ai-service", level_str=settings.logging_level)

    pipe_components = generate_components(settings.components)
    pipeline = pipeline_cls(**pipe_components[pipeline_name])
    init_langfuse()

    async_validate(lambda: pipeline.run(**kwargs))

    langfuse_context.flush()
