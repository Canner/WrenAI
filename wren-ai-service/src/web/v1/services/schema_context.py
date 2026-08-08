from typing import Any

from pydantic import BaseModel, Field


class RetrievedSchemaContext(BaseModel):
    documents: list[dict[str, Any]] = Field(default_factory=list)
    table_names: list[str] = Field(default_factory=list)
    contexts: list[str] = Field(default_factory=list)
    unpruned_contexts: list[str] = Field(default_factory=list)
    grounding: str = ""
    has_calculated_field: bool = False
    has_metric: bool = False
    has_json_field: bool = False

    @property
    def sql_generation_contexts(self) -> list[str]:
        return self.contexts or self.unpruned_contexts

    @property
    def is_empty(self) -> bool:
        return not self.documents and not self.contexts and not self.unpruned_contexts


def build_schema_grounding_context(documents: list[dict[str, Any]]) -> str:
    lines: list[str] = []

    for document in documents:
        table_name = document.get("table_name")
        if not table_name:
            continue

        lines.append(f'- model/table: "{table_name}"')

        source_columns = (
            document.get("column_names")
            if "column_names" in document
            else document.get("manifest_column_names", [])
        )
        columns = [column for column in source_columns if column]
        if columns:
            lines.append("  columns:")
            lines.extend(f'    - "{column}"' for column in columns)

        relationship_constraints = [
            constraint
            for constraint in document.get("relationship_constraints", [])
            if constraint
        ]
        if relationship_constraints:
            lines.append("  relationships:")
            lines.extend(
                f"    - {constraint}" for constraint in relationship_constraints
            )

    return "\n".join(lines)


def build_sql_contexts(
    documents: list[dict[str, Any]],
    *,
    use_unpruned: bool = False,
) -> list[str]:
    ddl_key = "unpruned_table_ddl" if use_unpruned else "table_ddl"
    return [
        ddl
        for document in documents
        if (ddl := document.get(ddl_key) or document.get("table_ddl"))
    ]


def build_retrieved_schema_context(
    retrieval_result: dict[str, Any],
) -> RetrievedSchemaContext:
    constructed = retrieval_result.get("construct_retrieval_results", {})
    documents = [
        document
        for document in constructed.get("retrieval_results", [])
        if isinstance(document, dict)
    ]

    return RetrievedSchemaContext(
        documents=documents,
        table_names=[
            table_name
            for document in documents
            if (table_name := document.get("table_name"))
        ],
        contexts=build_sql_contexts(documents),
        unpruned_contexts=build_sql_contexts(documents, use_unpruned=True),
        grounding=build_schema_grounding_context(documents),
        has_calculated_field=constructed.get("has_calculated_field", False),
        has_metric=constructed.get("has_metric", False),
        has_json_field=constructed.get("has_json_field", False),
    )
