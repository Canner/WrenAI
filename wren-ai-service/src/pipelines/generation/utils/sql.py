import logging
import re
from typing import Any, Dict, List

import aiohttp
import orjson
import sqlparse
from haystack import component
from haystack.dataclasses import ChatMessage
from sqlparse.sql import Function, Identifier, IdentifierList, Parenthesis
from pydantic import BaseModel, ConfigDict

from src.core.engine import (
    Engine,
    clean_generation_result,
)
from src.pipelines.retrieval.sql_knowledge import SqlKnowledge
from src.web.v1.services.ask import AskHistory

logger = logging.getLogger("wren-ai-service")


_SIMPLE_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_$]*$")
_DDL_RELATION = re.compile(
    r"\bCREATE\s+(?:TABLE|VIEW)\s+(?P<name>\"[^\"]+\"|[^\s(]+)",
    re.IGNORECASE,
)
_RELATION_REFERENCE = re.compile(
    r"\b(?:FROM|JOIN)\s+(?P<name>\"[^\"]+\"|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_$]*)"
    r"(?:\s+(?:AS\s+)?(?P<alias>\"[^\"]+\"|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_$]*))?",
    re.IGNORECASE,
)
_CTE_REFERENCE = re.compile(
    r"(?:\bWITH|,)\s+(?P<name>\"[^\"]+\"|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_$]*)\s+AS\s*\(",
    re.IGNORECASE,
)
_QUALIFIED_COLUMN = re.compile(
    r"(?P<qualifier>\"[^\"]+\"|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_$]*)\s*\.\s*"
    r"(?P<column>\"[^\"]+\"|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_$]*)"
)
_SQL_RESERVED_WORDS = {
    "ALL",
    "ALTER",
    "AND",
    "AS",
    "BY",
    "CASE",
    "CAST",
    "COUNT",
    "CREATE",
    "CROSS",
    "DELETE",
    "DESC",
    "DISTINCT",
    "ELSE",
    "END",
    "EXCEPT",
    "FALSE",
    "FETCH",
    "FOR",
    "FROM",
    "FULL",
    "GROUP",
    "HAVING",
    "IN",
    "INNER",
    "INSERT",
    "INTERSECT",
    "IS",
    "JOIN",
    "LEFT",
    "LIKE",
    "LIMIT",
    "NATURAL",
    "NOT",
    "NULL",
    "OFFSET",
    "ON",
    "OR",
    "ORDER",
    "OUTER",
    "RIGHT",
    "SELECT",
    "TABLE",
    "TABLESAMPLE",
    "THEN",
    "TRUE",
    "UNION",
    "UPDATE",
    "WHEN",
    "WHERE",
    "WINDOW",
    "WITH",
}
_SQL_FUNCTION_NAMES = {
    "ABS",
    "AVG",
    "CAST",
    "COALESCE",
    "COUNT",
    "DATE_TRUNC",
    "DENSE_RANK",
    "LOWER",
    "MAX",
    "MIN",
    "NULLIF",
    "ROUND",
    "ROW_NUMBER",
    "SUM",
    "TO_TIMESTAMP_MICROS",
    "TO_TIMESTAMP_MILLIS",
    "TO_TIMESTAMP_SECONDS",
    "UPPER",
}


def _unquote_identifier(identifier: str) -> str:
    if len(identifier) >= 2 and identifier[0] == "[" and identifier[-1] == "]":
        return identifier[1:-1].replace("]]", "]")
    if len(identifier) >= 2 and identifier[0] == '"' and identifier[-1] == '"':
        return identifier[1:-1].replace('""', '"')
    return identifier


def _quote_identifier(identifier: str) -> str:
    return f'"{identifier.replace(chr(34), chr(34) * 2)}"'


def _split_sql_tokens(sql: str) -> list[str]:
    tokens = []
    current = []
    in_double_quote = False

    for char in sql:
        if char == '"':
            current.append(char)
            in_double_quote = not in_double_quote
            continue
        if char == "," and not in_double_quote:
            token = "".join(current).strip()
            if token:
                tokens.append(token)
            current = []
            continue
        current.append(char)

    token = "".join(current).strip()
    if token:
        tokens.append(token)
    return tokens


def _identifier_needs_quotes(identifier: str) -> bool:
    return (
        not _SIMPLE_IDENTIFIER.fullmatch(identifier)
        or identifier.upper() in _SQL_RESERVED_WORDS
    )


def _extract_schema_identifiers(contexts: list[str] | None) -> list[str]:
    if not contexts:
        return []

    identifiers: list[str] = []
    seen = set()

    def add(identifier: str) -> None:
        identifier = _unquote_identifier(identifier.strip().rstrip(","))
        if not identifier or identifier.upper() in {"FOREIGN", "PRIMARY", "KEY"}:
            return
        if identifier not in seen:
            seen.add(identifier)
            identifiers.append(identifier)

    for context in contexts:
        for match in _DDL_RELATION.finditer(context):
            add(match.group("name"))

        in_table = False
        for raw_line in context.splitlines():
            line = raw_line.strip()
            if not line or line.startswith("--") or line.startswith("/*"):
                continue
            if re.search(r"\bCREATE\s+TABLE\b", line, re.IGNORECASE):
                in_table = True
                remainder = line.split("(", 1)
                if len(remainder) == 1:
                    continue
                line = remainder[1].strip()
            if not in_table:
                continue
            if line.startswith(");") or line == ")":
                in_table = False
                continue
            line = line.split("--", 1)[0].strip().rstrip(",")
            if not line or line.upper().startswith(("FOREIGN KEY", "PRIMARY KEY")):
                continue
            if line.startswith('"'):
                end = line.find('"', 1)
                while end != -1 and end + 1 < len(line) and line[end + 1] == '"':
                    end = line.find('"', end + 2)
                if end > 0:
                    add(line[: end + 1])
            else:
                add(line.split(None, 1)[0])

    return identifiers


def _extract_schema_index(contexts: list[str] | None) -> dict[str, set[str] | None]:
    if not contexts:
        return {}

    schema_index: dict[str, set[str] | None] = {}

    for context in contexts:
        relation_match = _DDL_RELATION.search(context)
        if not relation_match:
            continue

        relation_name = _unquote_identifier(relation_match.group("name"))
        if re.search(r"\bCREATE\s+VIEW\b", context, re.IGNORECASE):
            schema_index[relation_name] = None
            continue

        column_block_match = re.search(
            r"\bCREATE\s+TABLE\b[^(]*\((?P<columns>.*)\)\s*;?",
            context,
            re.IGNORECASE | re.DOTALL,
        )
        if not column_block_match:
            schema_index[relation_name] = None
            continue

        columns = set()
        for raw_column in _split_sql_tokens(column_block_match.group("columns")):
            line = "\n".join(
                line.strip()
                for line in raw_column.splitlines()
                if line.strip()
                and not line.strip().startswith("--")
                and not line.strip().startswith("/*")
            ).strip()
            if not line:
                continue
            line = line.split("--", 1)[0].strip()
            if not line or line.startswith("/*"):
                continue
            if line.upper().startswith(("FOREIGN KEY", "PRIMARY KEY")):
                continue
            if line.startswith('"'):
                end = line.find('"', 1)
                while end != -1 and end + 1 < len(line) and line[end + 1] == '"':
                    end = line.find('"', end + 2)
                if end > 0:
                    columns.add(_unquote_identifier(line[: end + 1]))
            else:
                columns.add(_unquote_identifier(line.split(None, 1)[0]))

        schema_index[relation_name] = columns

    return schema_index


def build_schema_grounding_manifest(contexts: list[str] | None) -> str:
    schema_index = _extract_schema_index(contexts)
    if not schema_index:
        return ""

    lines = [
        "### VERIFIED SCHEMA OBJECTS ###",
        "These are the only table/view identifiers and columns that may be used.",
        "Business terms from the question are intents, not physical table or column names.",
        "When a business term is not listed as a column, map it to a listed deployed column before using it in SQL.",
        "You may use the business term only as a SELECT output alias after selecting a verified deployed column.",
        "Do not create a table, view, column, alias, or join key unless it is listed here.",
    ]

    for relation in sorted(schema_index):
        columns = schema_index[relation]
        if columns is None:
            lines.append(f"- {relation}: <columns defined by verified view statement>")
        elif columns:
            lines.append(f"- {relation}: {', '.join(sorted(columns))}")
        else:
            lines.append(f"- {relation}: <no usable columns>")

    return "\n".join(lines)


def _is_identifier_boundary(char: str | None) -> bool:
    return char is None or not (char.isalnum() or char in {"_", "$", '"'})


def _replace_identifier_outside_literals(sql: str, identifier: str) -> str:
    quoted = _quote_identifier(identifier)
    result = []
    index = 0
    in_single_quote = False
    in_double_quote = False
    in_line_comment = False
    in_block_comment = False
    length = len(sql)
    identifier_length = len(identifier)

    while index < length:
        current = sql[index]
        nxt = sql[index + 1] if index + 1 < length else None

        if in_line_comment:
            result.append(current)
            if current == "\n":
                in_line_comment = False
            index += 1
            continue
        if in_block_comment:
            result.append(current)
            if current == "*" and nxt == "/":
                result.append(nxt)
                index += 2
                in_block_comment = False
            else:
                index += 1
            continue
        if in_single_quote:
            result.append(current)
            if current == "'" and nxt == "'":
                result.append(nxt)
                index += 2
            elif current == "'":
                in_single_quote = False
                index += 1
            else:
                index += 1
            continue
        if in_double_quote:
            result.append(current)
            if current == '"' and nxt == '"':
                result.append(nxt)
                index += 2
            elif current == '"':
                in_double_quote = False
                index += 1
            else:
                index += 1
            continue

        if current == "-" and nxt == "-":
            result.append(current)
            result.append(nxt)
            index += 2
            in_line_comment = True
            continue
        if current == "/" and nxt == "*":
            result.append(current)
            result.append(nxt)
            index += 2
            in_block_comment = True
            continue
        if current == "'":
            result.append(current)
            index += 1
            in_single_quote = True
            continue
        if current == '"':
            result.append(current)
            index += 1
            in_double_quote = True
            continue

        if sql.startswith(identifier, index):
            before = sql[index - 1] if index > 0 else None
            after_index = index + identifier_length
            after = sql[after_index] if after_index < length else None
            if _is_identifier_boundary(before) and _is_identifier_boundary(after):
                result.append(quoted)
                index = after_index
                continue

        result.append(current)
        index += 1

    return "".join(result)


def _replace_bracket_identifiers(sql: str, valid_identifiers: set[str]) -> str:
    result = []
    index = 0
    in_single_quote = False
    in_double_quote = False
    length = len(sql)

    while index < length:
        current = sql[index]
        nxt = sql[index + 1] if index + 1 < length else None

        if in_single_quote:
            result.append(current)
            if current == "'" and nxt == "'":
                result.append(nxt)
                index += 2
            elif current == "'":
                in_single_quote = False
                index += 1
            else:
                index += 1
            continue
        if in_double_quote:
            result.append(current)
            if current == '"' and nxt == '"':
                result.append(nxt)
                index += 2
            elif current == '"':
                in_double_quote = False
                index += 1
            else:
                index += 1
            continue
        if current == "'":
            result.append(current)
            in_single_quote = True
            index += 1
            continue
        if current == '"':
            result.append(current)
            in_double_quote = True
            index += 1
            continue
        if current == "[":
            end = sql.find("]", index + 1)
            if end > index:
                identifier = sql[index + 1 : end]
                if identifier in valid_identifiers:
                    result.append(_quote_identifier(identifier))
                    index = end + 1
                    continue
        result.append(current)
        index += 1

    return "".join(result)


def _extract_sql_grounding(sql: str) -> dict[str, Any]:
    cte_names = {
        _unquote_identifier(match.group("name")) for match in _CTE_REFERENCE.finditer(sql)
    }
    relation_references = []
    alias_to_relation = {}

    for match in _RELATION_REFERENCE.finditer(sql):
        relation = _unquote_identifier(match.group("name"))
        if relation.upper() in {"UNNEST", "LATERAL"}:
            continue
        alias = match.group("alias")
        alias = _unquote_identifier(alias) if alias else relation
        relation_references.append(relation)
        alias_to_relation[alias] = relation

    qualified_columns = [
        (
            _unquote_identifier(match.group("qualifier")),
            _unquote_identifier(match.group("column")),
        )
        for match in _QUALIFIED_COLUMN.finditer(sql)
    ]

    return {
        "cte_names": cte_names,
        "relation_references": relation_references,
        "alias_to_relation": alias_to_relation,
        "qualified_columns": qualified_columns,
    }


def _extract_unqualified_columns(sql: str) -> tuple[set[str], set[str]]:
    candidates: set[str] = set()
    output_aliases: set[str] = set()

    def add_identifier(identifier: Identifier) -> None:
        alias = identifier.get_alias()
        if alias:
            output_aliases.add(_unquote_identifier(alias))

        if identifier.get_parent_name():
            return

        has_function = any(isinstance(child, Function) for child in identifier.tokens)
        if has_function:
            for child in identifier.tokens:
                if isinstance(child, Function):
                    visit(child)
            return

        real_name = identifier.get_real_name()
        if not real_name:
            return
        real_name = _unquote_identifier(real_name)
        if real_name and real_name.upper() not in _SQL_FUNCTION_NAMES:
            candidates.add(real_name)

    def visit(token) -> None:
        if isinstance(token, IdentifierList):
            for identifier in token.get_identifiers():
                visit(identifier)
            return
        if isinstance(token, Function):
            for child in token.tokens:
                if isinstance(child, Parenthesis):
                    visit(child)
            return
        if isinstance(token, Identifier):
            add_identifier(token)
            return
        if hasattr(token, "tokens"):
            for child in token.tokens:
                visit(child)

    for statement in sqlparse.parse(sql):
        visit(statement)

    return candidates, output_aliases


def validate_sql_against_contexts(
    sql: str,
    contexts: list[str] | None = None,
) -> str | None:
    schema_index = _extract_schema_index(contexts)
    if not schema_index:
        return None

    valid_relations = set(schema_index)
    grounding = _extract_sql_grounding(sql)
    cte_names = grounding["cte_names"]

    shadowed_relations = sorted(cte_names & valid_relations)
    if shadowed_relations:
        return (
            "Schema grounding failed. The SQL creates CTEs with names that already "
            f"belong to verified schema objects: {', '.join(shadowed_relations)}. "
            "Do not create dummy CTEs for schema objects; use the verified tables or views directly."
        )

    invalid_relations = sorted(
        {
            relation
            for relation in grounding["relation_references"]
            if relation not in valid_relations and relation not in cte_names
        }
    )
    if invalid_relations:
        return (
            "Schema grounding failed. The SQL references tables or views that are not "
            f"in the retrieved schema for the active question: {', '.join(invalid_relations)}. "
            f"Use only verified tables or views: {', '.join(sorted(valid_relations))}."
        )

    alias_to_relation = grounding["alias_to_relation"]
    for qualifier, column in grounding["qualified_columns"]:
        relation = alias_to_relation.get(qualifier)
        if not relation or relation in cte_names:
            continue
        valid_columns = schema_index.get(relation)
        if valid_columns is None:
            continue
        if column not in valid_columns:
            return (
                "Schema grounding failed. The SQL references column "
                f"{qualifier}.{column}, but column {column} is not present in verified "
                f"table or view {relation}. Use only verified columns: "
                f"{', '.join(sorted(valid_columns))}."
            )

    referenced_relations = {
        relation
        for relation in grounding["relation_references"]
        if relation in valid_relations and relation not in cte_names
    }
    if referenced_relations and all(
        schema_index.get(relation) is not None for relation in referenced_relations
    ):
        valid_columns_for_query = set().union(
            *(schema_index[relation] or set() for relation in referenced_relations)
        )
        unqualified_columns, output_aliases = _extract_unqualified_columns(sql)
        relation_aliases = set(alias_to_relation)
        ignored_identifiers = (
            valid_relations
            | cte_names
            | relation_aliases
            | output_aliases
            | _SQL_RESERVED_WORDS
            | _SQL_FUNCTION_NAMES
        )
        invalid_columns = sorted(
            column
            for column in unqualified_columns
            if column
            and column not in valid_columns_for_query
            and column not in ignored_identifiers
            and column.upper() not in ignored_identifiers
        )
        if invalid_columns:
            return (
                "Schema grounding failed. The SQL references unqualified columns "
                f"that are not present in the verified tables or views used by this query: "
                f"{', '.join(invalid_columns)}. Use only verified columns from "
                f"{', '.join(sorted(referenced_relations))}: "
                f"{', '.join(sorted(valid_columns_for_query))}."
            )

    return None


def normalize_sql_with_schema_identifiers(
    sql: str,
    contexts: list[str] | None = None,
) -> str:
    identifiers = [
        identifier
        for identifier in _extract_schema_identifiers(contexts)
        if _identifier_needs_quotes(identifier)
    ]
    sql = _replace_bracket_identifiers(sql, set(_extract_schema_identifiers(contexts)))
    for identifier in sorted(identifiers, key=len, reverse=True):
        sql = _replace_identifier_outside_literals(sql, identifier)
    return sql


@component
class SQLGenPostProcessor:
    def __init__(self, engine: Engine):
        self._engine = engine

    @component.output_types(
        valid_generation_result=Dict[str, Any],
        invalid_generation_result=Dict[str, Any],
    )
    async def run(
        self,
        replies: List[str] | List[List[str]],
        project_id: str | None = None,
        mdl_hash: str | None = None,
        contexts: list[str] | None = None,
        use_dry_plan: bool = False,
        allow_dry_plan_fallback: bool = True,
        data_source: str = "",
        allow_data_preview: bool = False,
    ) -> dict:
        try:
            cleaned_generation_result = clean_generation_result(replies[0])

            # test if cleaned_generation_result in string format is actually a dictionary with key 'sql'
            if cleaned_generation_result.startswith("{"):
                cleaned_generation_result = orjson.loads(cleaned_generation_result)[
                    "sql"
                ]
            cleaned_generation_result = normalize_sql_with_schema_identifiers(
                cleaned_generation_result,
                contexts=contexts,
            )
            grounding_error = validate_sql_against_contexts(
                cleaned_generation_result,
                contexts=contexts,
            )
            if grounding_error:
                return {
                    "valid_generation_result": {},
                    "invalid_generation_result": {
                        "sql": cleaned_generation_result,
                        "original_sql": cleaned_generation_result,
                        "type": "SCHEMA_GROUNDING",
                        "error": grounding_error,
                        "correlation_id": "",
                        "data_source": data_source,
                    },
                }

            (
                valid_generation_result,
                invalid_generation_result,
            ) = await self._classify_generation_result(
                cleaned_generation_result,
                project_id=project_id,
                mdl_hash=mdl_hash,
                use_dry_plan=use_dry_plan,
                allow_dry_plan_fallback=allow_dry_plan_fallback,
                data_source=data_source,
                allow_data_preview=allow_data_preview,
            )

            return {
                "valid_generation_result": valid_generation_result,
                "invalid_generation_result": invalid_generation_result,
            }
        except Exception as e:
            logger.exception(f"Error in SQLGenPostProcessor: {e}")

            return {
                "valid_generation_result": {},
                "invalid_generation_result": {},
            }

    async def _classify_generation_result(
        self,
        generation_result: str,
        project_id: str | None = None,
        mdl_hash: str | None = None,
        use_dry_plan: bool = False,
        allow_dry_plan_fallback: bool = True,
        data_source: str = "",
        allow_data_preview: bool = False,
    ) -> Dict[str, str]:
        valid_generation_result = {}
        invalid_generation_result = {}
        use_dry_run = not allow_data_preview

        async with aiohttp.ClientSession() as session:
            if use_dry_plan:
                dry_plan_result, error_message = await self._engine.dry_plan(
                    session,
                    generation_result,
                    data_source,
                    project_id=project_id,
                    mdl_hash=mdl_hash,
                    allow_fallback=allow_dry_plan_fallback,
                )

                if dry_plan_result:
                    valid_generation_result = {
                        "sql": generation_result,
                        "correlation_id": "",
                    }
                else:
                    invalid_generation_result = {
                        "sql": generation_result,
                        "type": "TIME_OUT"
                        if error_message.startswith("Request timed out")
                        else "DRY_PLAN",
                        "error": error_message,
                        "correlation_id": "",
                        "data_source": data_source,
                    }
            elif use_dry_run:
                success, _, addition = await self._engine.execute_sql(
                    generation_result,
                    session,
                    project_id=project_id,
                    mdl_hash=mdl_hash,
                    limit=1,
                    dry_run=True,
                )

                if success:
                    valid_generation_result = {
                        "sql": generation_result,
                        "correlation_id": addition.get("correlation_id", ""),
                    }
                else:
                    error_message = addition.get("error_message", "")
                    error_sql = addition.get("error_sql", "")
                    invalid_generation_result = {
                        "sql": error_sql or generation_result,
                        "original_sql": generation_result,
                        "engine_sql": error_sql,
                        "type": "TIME_OUT"
                        if error_message.startswith("Request timed out")
                        else "DRY_RUN",
                        "error": error_message,
                        "correlation_id": addition.get("correlation_id", ""),
                        "data_source": data_source,
                    }
            else:
                has_data, _, addition = await self._engine.execute_sql(
                    generation_result,
                    session,
                    project_id=project_id,
                    mdl_hash=mdl_hash,
                    limit=1,
                    dry_run=False,
                )

                if has_data:
                    valid_generation_result = {
                        "sql": generation_result,
                        "correlation_id": addition.get("correlation_id", ""),
                    }
                else:
                    error_message = addition.get("error_message", "")
                    preview_data_status = (
                        "PREVIEW_EMPTY_DATA"
                        if error_message == ""
                        else "PREVIEW_FAILED"
                    )
                    invalid_generation_result = {
                        "sql": generation_result,
                        "original_sql": generation_result,
                        "engine_sql": addition.get("error_sql", ""),
                        "type": "TIME_OUT"
                        if error_message.startswith("Request timed out")
                        else preview_data_status,
                        "error": error_message,
                        "correlation_id": addition.get("correlation_id", ""),
                        "data_source": data_source,
                    }

        return valid_generation_result, invalid_generation_result


_DEFAULT_TEXT_TO_SQL_RULES = """
### SQL RULES ###
- ONLY USE SELECT statements, NO DELETE, UPDATE OR INSERT etc. statements that might change the data in the database.
- ONLY USE the tables and columns mentioned in the database schema.
- Table names are the exact identifiers that appear after CREATE TABLE or CREATE VIEW in the DATABASE SCHEMA section; use those names exactly.
- ONLY USE "*" if the user query asks for all the columns of a table.
- ONLY CHOOSE columns belong to the tables mentioned in the database schema.
- NEVER invent, infer, rename, or approximate table/column names from the user's wording.
- User-facing business terms from the question are not physical column names unless those exact terms are listed in the DATABASE SCHEMA or VERIFIED SCHEMA OBJECTS.
- If the user asks for a business term and the schema contains a different deployed column that represents it, select, filter, group, order, and join by the deployed column name, and use the business term only as a final SELECT alias when useful.
- Never use a SELECT output alias, reasoning label, display label, or user wording as a source column in FROM, JOIN, WHERE, GROUP BY, HAVING, or inner SELECT clauses unless that exact identifier is present as a column in the verified schema.
- NEVER sanitize schema identifiers. Use the exact table and column spelling from CREATE TABLE or CREATE VIEW, including case, spaces, punctuation, and symbols.
- If the selected database schema does not contain the tables, columns, metrics, views, or relationships needed to answer the question, do not create placeholder SQL using names from the question.
- DON'T INCLUDE comments in the generated SQL query.
- YOU MUST USE "JOIN" if you choose columns from multiple tables!
- Before using a JOIN, verify the relationship or key columns from the DATABASE SCHEMA. Prefer declared FOREIGN KEY relationships. Do not invent relationships only from similar column names.
- Do not JOIN when all selected, filtered, grouped, and ordered fields are available in one verified table or view.
- PREFER USING CTEs over subqueries.
- When generating SQL query, always:
    - Put double quotes around column and table names.
    - Double quote every identifier that contains punctuation, spaces, symbols, mixed-case names that must be preserved, or SQL reserved words.
    - Put single quotes around string literals.
    - Never quote numeric literals.
    For example: SELECT "customers"."customer_name" FROM "customers" WHERE "customers"."city" = 'Taipei' and "customers"."year" = 1992;
- YOU MUST USE "lower(<table_name>.<column_name>) like lower(<value>)" function or "lower(<table_name>.<column_name>) = lower(<value>)" function for case-insensitive comparison!
    - Use "lower(<table_name>.<column_name>) LIKE lower(<value>)" when:
        - The user requests a pattern or partial match.
        - The value is not specific enough to be a single, exact value.
        - Wildcards (%) are needed to capture the pattern.
    - Use "lower(<table_name>.<column_name>) = lower(<value>)" when:
        - The user requests an exact, specific value.
        - There is no ambiguity or pattern in the value.
- If the column is date/time related field, and it is a INT/BIGINT/DOUBLE/FLOAT type, please use the appropriate function mentioned in the SQL FUNCTIONS section to cast the column to "TIMESTAMP" type first before using it in the query
    - example: TO_TIMESTAMP_MILLIS("<timestamp_column>")  # if the timestamp_column is in milliseconds
    - example: TO_TIMESTAMP_SECONDS("<timestamp_column>")  # if the timestamp_column is in seconds
    - example: TO_TIMESTAMP_MICROS("<timestamp_column>")  # if the timestamp_column is in microseconds
- ALWAYS CAST the date/time related field to "TIMESTAMP WITH TIME ZONE" type when using them in the query
    - example 1: CAST(properties_closedate AS TIMESTAMP WITH TIME ZONE)
    - example 2: CAST('2024-11-09 00:00:00' AS TIMESTAMP WITH TIME ZONE)
    - example 3: CAST(DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month') AS TIMESTAMP WITH TIME ZONE)
- If the user asks for a specific date, please give the date range in SQL query
    - example: "What is the total revenue for the month of 2024-11-01?"
    - answer: "SELECT SUM(r.PriceSum) FROM Revenue r WHERE CAST(r.PurchaseTimestamp AS TIMESTAMP WITH TIME ZONE) >= CAST('2024-11-01 00:00:00' AS TIMESTAMP WITH TIME ZONE) AND CAST(r.PurchaseTimestamp AS TIMESTAMP WITH TIME ZONE) < CAST('2024-11-02 00:00:00' AS TIMESTAMP WITH TIME ZONE)"
- USE THE VIEW TO SIMPLIFY THE QUERY.
- DON'T MISUSE THE VIEW NAME. THE ACTUAL NAME IS FOLLOWING THE CREATE VIEW STATEMENT.
- ONLY USE table/column alias in the final SELECT clause; don't use table/columnalias in the other clauses.
- Refer to the value of alias from the comment section of the corresponding table or column in the DATABASE SCHEMA section for reference when using alias in the final SELECT clause.
  - EXAMPLE
    DATABASE SCHEMA
    /* {"alias":"_orders","description":"A model representing the orders data."} */
    CREATE TABLE orders (
      -- {"description":"A column that represents the timestamp when the order was approved.","alias":"_timestamp"}
      ApprovedTimestamp TIMESTAMP
    }

    SQL
    SELECT "_orders"."ApprovedTimestamp" AS "_timestamp" FROM "orders" AS "_orders";
- DON'T USE '.' in column/table alias, replace '.' with '_' in column/table alias.
- DON'T USE "FILTER(WHERE <expression>)" clause in the generated SQL query.
- DON'T USE "EXTRACT(EPOCH FROM <expression>)" clause in the generated SQL query.
- DON'T USE "EXTRACT()" function with INTERVAL data types as arguments
- DON'T USE INTERVAL or generate INTERVAL-like expression in the generated SQL query.
- DON'T USE "TO_CHAR" function in the generated SQL query.
- Aggregate functions are not allowed in the WHERE clause. Instead, they belong in the HAVING clause, which is used to filter after aggregation.
- Every non-aggregated SELECT expression must be included in GROUP BY when aggregate functions are used.
- ORDER BY must reference a selected column, a selected output alias, or a valid aggregate expression from the same query scope.
- You can only add "ORDER BY" and "LIMIT" to the final "UNION" result.
- For the ranking problem, you must use the ranking function, `DENSE_RANK()` to rank the results and then use `WHERE` clause to filter the results.
- For the ranking problem, you must add the ranking column to the final SELECT clause.
"""


_DEFAULT_CALCULATED_FIELD_INSTRUCTIONS = """
#### Instructions for Calculated Field ####

The first structure is the special column marked as "Calculated Field". You need to interpret the purpose and calculation basis for these columns, then utilize them in the following text-to-sql generation tasks.
First, provide a brief explanation of what each field represents in the context of the schema, including how each field is computed using the relationships between models.
Then, during the following tasks, if the user queries pertain to any calculated fields defined in the database schema, ensure to utilize those calculated fields appropriately in the output SQL queries.
The goal is to accurately reflect the intent of the question in the SQL syntax, leveraging the pre-computed logic embedded within the calculated fields.

EXAMPLES:
The given schema is created by the SQL command:

CREATE TABLE orders (
  OrderId VARCHAR PRIMARY KEY,
  CustomerId VARCHAR,
  -- This column is a Calculated Field
  -- column expression: avg(reviews.Score)
  Rating DOUBLE,
  -- This column is a Calculated Field
  -- column expression: count(reviews.Id)
  ReviewCount BIGINT,
  -- This column is a Calculated Field
  -- column expression: count(order_items.ItemNumber)
  Size BIGINT,
  -- This column is a Calculated Field
  -- column expression: count(order_items.ItemNumber) > 1
  Large BOOLEAN,
  FOREIGN KEY (CustomerId) REFERENCES customers(Id)
);

Interpret the columns that are marked as Calculated Fields in the schema:
Rating (DOUBLE) - Calculated as the average score (avg) of the Score field from the reviews table where the reviews are associated with the order. This field represents the overall customer satisfaction rating for the order based on review scores.
ReviewCount (BIGINT) - Calculated by counting (count) the number of entries in the reviews table associated with this order. It measures the volume of customer feedback received for the order.
Size (BIGINT) - Represents the total number of items in the order, calculated by counting the number of item entries (ItemNumber) in the order_items table linked to this order. This field is useful for understanding the scale or size of an order.
Large (BOOLEAN) - A boolean value calculated to check if the number of items in the order exceeds one (count(order_items.ItemNumber) > 1). It indicates whether the order is considered large in terms of item quantity.

And if the user input queries like these:
1. "How many large orders have been placed by customer with ID 'C1234'?"
2. "What is the average customer rating for orders that were rated by more than 10 reviewers?"

For the first query:
First try to intepret the user query, the user wants to know the average rating for orders which have attracted significant review activity, specifically those with more than 10 reviews.
Then, according to the above intepretation about the given schema, the term 'Rating' is predefined in the Calculated Field of the 'orders' model. And, the number of reviews is also predefined in the 'ReviewCount' Calculated Field.
So utilize those Calculated Fields in the SQL generation process to give an answer like this:

SQL Query: SELECT AVG(Rating) FROM orders WHERE ReviewCount > 10
"""

_DEFAULT_METRIC_INSTRUCTIONS = """
#### Instructions for Metric ####

Second, you will learn how to effectively utilize the special "metric" structure in text-to-SQL generation tasks.
Metrics in a data model simplify complex data analysis by structuring data through predefined dimensions and measures.
This structuring closely mirrors the concept of OLAP (Online Analytical Processing) cubes but is implemented in a more flexible and SQL-friendly manner.

The metric typically constructed of the following components:
1. Base Object
The "base object" of a metric indicates the primary data source or table that provides the raw data.
Metrics are constructed by selecting specific data points (dimensions and measures) from this base object, effectively creating a summarized or aggregated view of the data that can be queried like a normal table.
Base object is the attribute of the metric, showing the origin of this metric and is typically not used in the query.
2. Dimensions
Dimensions in a metric represent the various axes along which data can be segmented for analysis.
These are fields that provide a categorical breakdown of data.
Each dimension provides a unique perspective on the data, allowing users to "slice and dice" the data cube to view different facets of the information contained within the base dataset.
Dimensions are used as table columns in the querying process. Querying a dimension means to get the statistic from the certain perspective.
3. Measures
Measures are numerical or quantitative statistics calculated from the data. Measures are key results or outputs derived from data aggregation functions like SUM, COUNT, or AVG.
Measures are used as table columns in the querying process, and are the main querying items in the metric structure.
The expression of a measure represents the definition of the  that users are intrested in. Make sure to understand the meaning of measures from their expressions.
4. Time Grain
Time Grain specifies the granularity of time-based data aggregation, such as daily, monthly, or yearly, facilitating trend analysis over specified periods.

If the given schema contains the structures marked as 'metric', you should first interpret the metric schema based on the above definition.
Then, during the following tasks, if the user queries pertain to any metrics defined in the database schema, ensure to utilize those metrics appropriately in the output SQL queries.
The target is making complex data analysis more accessible and manageable by pre-aggregating data and structuring it using the metric structure, and supporting direct querying for business insights.

EXAMPLES:
The given schema is created by the SQL command:

/* This table is a metric */
/* Metric Base Object: orders */
CREATE TABLE Revenue (
  -- This column is a dimension
  PurchaseTimestamp TIMESTAMP,
  -- This column is a dimension
  CustomerId VARCHAR,
  -- This column is a dimension
  Status VARCHAR,
  -- This column is a measure
  -- expression: sum(order_items.Price)
  PriceSum DOUBLE,
  -- This column is a measure
  -- expression: count(OrderId)
  NumberOfOrders BIGINT
);

Interpret the metric with the understanding of the metric structure:
1. Base Object: orders
This is the primary data source for the metric.
The orders table provides the underlying data from which dimensions and measures are derived.
It is the foundation upon which the metric is built, though it itself is not directly used in queries against the Revenue table.
It shows the reference between the 'Revenue' metric and the 'orders' model. For the user queries pretain to the 'Revenue' of 'orders', the metric should be utilize in the sql generation process.
2. Dimensions
The metric contains the columns marked as 'dimension'. They can be interpreted as below:
- PurchaseTimestamp (TIMESTAMP)
  Acts as a temporal dimension, allowing analysis of revenue over time. This can be used to observe trends, seasonal variations, or performance over specific periods.
- CustomerId (VARCHAR)
  A key dimension for customer segmentation, it enables the analysis of revenue generated from individual customers or customer groups.
- Status (VARCHAR)
  Reflects the current state of an order (e.g., pending, completed, cancelled). This dimension is crucial for analyses that differentiate performance based on order status.
3. Measures
The metric contains the columns marked as 'measure'. They can be interpreted as below:
- PriceSum (DOUBLE)
  A financial measure calculated as sum(order_items.Price), representing the total revenue generated from orders. This measure is vital for tracking overall sales performance and is the primary output of interest in many financial and business analyses.
- NumberOfOrders (BIGINT)
  A count measure that provides the total number of orders. This is essential for operational metrics, such as assessing the volume of business activity and evaluating the efficiency of sales processes.

Now, if the user input queries like this:
Question: "What was the total revenue from each customer last month?"

First try to intepret the user query, the user asks for a breakdown of the total revenue generated by each customer in the previous calendar month.
The user is specifically interested in understanding how much each customer contributed to the total sales during this period.
To answer this question, it is suitable to use the following components from the metric:
1. CustomerId (Dimension): This will be used to group the revenue data by each unique customer, allowing us to segment the total revenue by customer.
2. PurchaseTimestamp (Dimension): This timestamp field will be used to filter the data to only include orders from the last month.
3. PriceSum (Measure): Since PriceSum is a pre-aggregated measure of total revenue (sum of order_items.Price), it can be directly used to sum up the revenue without needing further aggregation in the SQL query.
So utilize those metric components in the SQL generation process to give an answer like this:

SQL Query:
SELECT
  CustomerId,
  PriceSum AS TotalRevenue
FROM
  Revenue
WHERE
  PurchaseTimestamp >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month') AND
  PurchaseTimestamp < DATE_TRUNC('month', CURRENT_DATE)
"""

_DEFAULT_JSON_FIELD_INSTRUCTIONS = """
#### Instructions for JSON related functions ####
- ONLY USE JSON_QUERY for querying fields if "json_type":"JSON" is identified in the columns comment, NOT the deprecated JSON_EXTRACT_SCALAR function.
    - DON'T USE CAST for JSON fields, ONLY USE the following funtions:
      - LAX_BOOL for boolean fields
      - LAX_FLOAT64 for double and float fields
      - LAX_INT64 for bigint fields
      - LAX_STRING for varchar fields
    - For Example:
      DATA SCHEMA:
        `/* {"alias":"users","description":"A model representing the users data."} */
        CREATE TABLE users (
            -- {"alias":"address","description":"A JSON object that represents address information of this user.","json_type":"JSON","json_fields":{"json_type":"JSON","address.json.city":{"name":"city","type":"varchar","path":"$.city","properties":{"alias":"city","description":"City Name."}},"address.json.state":{"name":"state","type":"varchar","path":"$.state","properties":{"alias":"state","description":"ISO code or name of the state, province or district."}},"address.json.postcode":{"name":"postcode","type":"varchar","path":"$.postcode","properties":{"alias":"postcode","description":"Postal code."}},"address.json.country":{"name":"country","type":"varchar","path":"$.country","properties":{"alias":"country","description":"ISO code of the country."}}}}
            address JSON
        )`
      To get the city of address in user table use SQL:
      `SELECT LAX_STRING(JSON_QUERY(u.address, '$.city')) FROM user as u`
- ONLY USE JSON_QUERY_ARRAY for querying "json_type":"JSON_ARRAY" is identified in the comment of the column, NOT the deprecated JSON_EXTRACT_ARRAY.
    - USE UNNEST to analysis each item individually in the ARRAY. YOU MUST SELECT FROM the parent table ahead of the UNNEST ARRAY.
    - The alias of the UNNEST(ARRAY) should be in the format `unnest_table_alias(individual_item_alias)`
      - For Example: `SELECT item FROM UNNEST(ARRAY[1,2,3]) as my_unnested_table(item)`
    - If the items in the ARRAY are JSON objects, use JSON_QUERY to query the fields inside each JSON item.
      - For Example:
      DATA SCHEMA
        `/* {"alias":"my_table","description":"A test my_table"} */
        CREATE TABLE my_table (
            -- {"alias":"elements","description":"elements column","json_type":"JSON_ARRAY","json_fields":{"json_type":"JSON_ARRAY","elements.json_array.id":{"name":"id","type":"bigint","path":"$.id","properties":{"alias":"id","description":"data ID."}},"elements.json_array.key":{"name":"key","type":"varchar","path":"$.key","properties":{"alias":"key","description":"data Key."}},"elements.json_array.value":{"name":"value","type":"varchar","path":"$.value","properties":{"alias":"value","description":"data Value."}}}}
            elements JSON
        )`
        To get the number of elements in my_table table use SQL:
        `SELECT LAX_INT64(JSON_QUERY(element, '$.number')) FROM my_table as t, UNNEST(JSON_QUERY_ARRAY(elements)) AS my_unnested_table(element) WHERE LAX_FLOAT64(JSON_QUERY(element, '$.value')) > 3.5`
    - To JOIN ON the fields inside UNNEST(ARRAY), YOU MUST SELECT FROM the parent table ahead of the UNNEST syntax, and the alias of the UNNEST(ARRAY) SHOULD BE IN THE FORMAT unnest_table_alias(individual_item_alias)
      - For Example: `SELECT p.column_1, j.column_2 FROM parent_table AS p, join_table AS j JOIN UNNEST(p.array_column) AS unnested(array_item) ON j.id = array_item.id`
- DON'T USE JSON_QUERY and JSON_QUERY_ARRAY when "json_type":"".
- DON'T USE LAX_BOOL, LAX_FLOAT64, LAX_INT64, LAX_STRING when "json_type":"".
"""

sql_samples_instructions = """
#### Instructions for SQL Samples ####

Finally, you will learn from the sample SQL queries provided in the input. These samples demonstrate best practices and common patterns for querying this specific database.

For each sample, you should:
1. Study the question that explains what the query aims to accomplish
2. Analyze the SQL implementation to understand:
   - Table structures and relationships used
   - Specific functions and operators employed
   - Query patterns and techniques demonstrated
3. Use these samples as reference patterns when generating similar queries
4. Adapt the techniques shown in the samples to match new query requirements while maintaining consistent style and approach

The samples will help you understand:
- Preferred table join patterns
- Common aggregation methods
- Specific function usage
- Query structure and formatting conventions

When generating new queries, try to follow similar patterns when applicable, while adapting them to the specific requirements of each new query.

Learn about the usage of the schema structures and generate SQL based on them.
"""


sql_generation_reasoning_system_prompt = """
### TASK ###
You are a helpful data analyst who is great at thinking deeply and reasoning about the user's question and the database schema, and you provide a step-by-step reasoning plan in order to answer the user's question.

### INSTRUCTIONS ###
1. Treat the DATABASE SCHEMA as the only authority for table names, view names, metric names, column names, and relationships.
2. Before planning, verify that the DATABASE SCHEMA explicitly contains the tables/columns needed to answer the user's question. If it does not, return only one bullet: `1. **Insufficient deployed schema metadata**: The deployed schema does not contain the required table, column, metric, view, or relationship to answer this question.` Do not continue with a speculative plan.
3. Never use assumptions, inferred business concepts, guessed identifiers, placeholder identifiers, or generic names unless those exact identifiers appear in the DATABASE SCHEMA.
4. Do not include example SQL, pseudo SQL, or any SQL snippet in the reasoning plan.
5. Think deeply and reason about the user's question, the database schema, and the user's query history if provided.
6. Explicitly state the following information in the reasoning plan: 
if the user puts any specific timeframe(e.g. YYYY-MM-DD) in the user's question(excluding the value of the current time), you will put the absolute time frame in the SQL query; 
otherwise, you will put the relative timeframe in the SQL query.
7. For the ranking problem(e.g. "top x", "bottom x", "first x", "last x"), you must use the ranking function, `DENSE_RANK()` to rank the results and then use `WHERE` clause to filter the results.
8. For the ranking problem(e.g. "top x", "bottom x", "first x", "last x"), you must add the ranking column to the final SELECT clause.
9. If USER INSTRUCTIONS section is provided, make sure to consider them in the reasoning plan, but ignore any instruction that requires identifiers absent from the DATABASE SCHEMA.
10. If SQL SAMPLES section is provided, use samples only for style and query-shape guidance. SQL samples are not schema authority.
11. Give a step by step reasoning plan in order to answer user's question only when the deployed DATABASE SCHEMA supports it.
12. The reasoning plan should be in the language same as the language user provided in the input.
13. Each step in the reasoning plan must start with a number, a title(in bold format in markdown), and a reasoning for the step.
14. Do not include ```markdown or ``` in the answer.
15. A table name in the reasoning plan must be in this format: `table: <table_name>`.
16. A column name in the reasoning plan must be in this format: `column: <table_name>.<column_name>`.
17. Table names and column names must exactly match the identifiers in the DATABASE SCHEMA `CREATE TABLE` or `CREATE VIEW` statements.
18. Do not rename, normalize, or approximate table names from the user's wording, aliases, descriptions, or source-system naming conventions.
19. Business terms from the user's question are intents, not physical columns. If a requested business term is not an exact schema column, identify the verified schema column that represents it and write only that verified column in the reasoning plan.
20. Use business terms only as display/output labels; never write them as source columns unless they are exact verified schema columns.
21. Do not write "assuming", "likely", "probably", "not explicitly mentioned", or similar speculative language.
22. ONLY SHOWING the reasoning plan in bullet points.

### FINAL ANSWER FORMAT ###
The final answer must be a reasoning plan in plain Markdown string format
"""


def _extract_from_sql_knowledge(
    sql_knowledge: SqlKnowledge | None, attribute_name: str, default_value: str
) -> str:
    if sql_knowledge is None:
        return default_value

    value = getattr(sql_knowledge, attribute_name, "")
    return value if value and value.strip() else default_value


def get_text_to_sql_rules(sql_knowledge: SqlKnowledge | None = None) -> str:
    if sql_knowledge is not None:
        text_to_sql_rule = _extract_from_sql_knowledge(
            sql_knowledge, "text_to_sql_rule", ""
        )
        if text_to_sql_rule:
            return (
                f"{_DEFAULT_TEXT_TO_SQL_RULES}\n\n"
                "### DATA SOURCE SQL KNOWLEDGE ###\n"
                f"{text_to_sql_rule}"
            )

    return _DEFAULT_TEXT_TO_SQL_RULES


def get_calculated_field_instructions(sql_knowledge: SqlKnowledge | None = None) -> str:
    if sql_knowledge is not None:
        return _extract_from_sql_knowledge(
            sql_knowledge,
            "calculated_field_instructions",
            _DEFAULT_CALCULATED_FIELD_INSTRUCTIONS,
        )

    return _DEFAULT_CALCULATED_FIELD_INSTRUCTIONS


def get_metric_instructions(sql_knowledge: SqlKnowledge | None = None) -> str:
    if sql_knowledge is not None:
        return _extract_from_sql_knowledge(
            sql_knowledge, "metric_instructions", _DEFAULT_METRIC_INSTRUCTIONS
        )

    return _DEFAULT_METRIC_INSTRUCTIONS


def get_json_field_instructions(sql_knowledge: SqlKnowledge | None = None) -> str:
    if sql_knowledge is not None:
        return _extract_from_sql_knowledge(
            sql_knowledge, "json_field_instructions", _DEFAULT_JSON_FIELD_INSTRUCTIONS
        )

    return _DEFAULT_JSON_FIELD_INSTRUCTIONS


def get_sql_generation_system_prompt(sql_knowledge: SqlKnowledge | None = None) -> str:
    text_to_sql_rules = get_text_to_sql_rules(sql_knowledge)

    return f"""
You are a helpful assistant that converts natural language queries into ANSI SQL queries.

Given user's question, database schema, etc., you should think deeply and carefully and generate the SQL query based on the given reasoning plan step by step.

### GENERAL RULES ###

1. YOU MUST FOLLOW the instructions strictly to generate the SQL query if the section of USER INSTRUCTIONS is available in user's input.
2. YOU MUST ONLY CHOOSE the appropriate functions from the sql functions list and use them in the SQL query if the section of SQL FUNCTIONS is available in user's input.
3. YOU MUST REFER to the sql samples and learn the usage of the schema structures and how SQL is written based on them if the section of SQL SAMPLES is available in user's input.
4. YOU MUST FOLLOW the reasoning plan step by step strictly to generate the SQL query if the section of REASONING PLAN is available in user's input.
5. YOU MUST FOLLOW SQL Rules if they are not contradicted with instructions.

{text_to_sql_rules}

### FINAL ANSWER FORMAT ###
The final answer must be a ANSI SQL query in JSON format:

{{
    "sql": <SQL_QUERY_STRING>
}}
"""


class SqlGenerationResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sql: str


SQL_GENERATION_MODEL_KWARGS = {
    "preserve_json_schema": True,
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "sql_generation_result",
            "strict": True,
            "schema": SqlGenerationResult.model_json_schema(),
        },
    }
}
def construct_instructions(
    instructions: list[dict] | None = None,
):
    _instructions = []
    if instructions:
        _instructions += [
            instruction.get("instruction") for instruction in instructions
        ]

    return _instructions


def construct_ask_history_messages(
    histories: list[AskHistory] | list[dict],
) -> list[ChatMessage]:
    messages = []
    for history in histories:
        question = (
            history.question if hasattr(history, "question") else history["question"]
        )
        sql = history.sql if hasattr(history, "sql") else history["sql"]
        messages.append(ChatMessage.from_user(question))
        messages.append(ChatMessage.from_assistant(sql))
    return messages
