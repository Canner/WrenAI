import logging
import re
from typing import Any, Dict, List

import aiohttp
import orjson
import sqlparse
from haystack import component
from haystack.dataclasses import ChatMessage
from sqlparse.sql import Function, Identifier, IdentifierList, Parenthesis, TokenList
from sqlparse import tokens as sqlparse_tokens
from pydantic import BaseModel

from src.core.engine import (
    Engine,
    clean_generation_result,
)
from src.pipelines.retrieval.sql_knowledge import SqlKnowledge
from src.web.v1.services.ask import AskHistory

logger = logging.getLogger("wren-ai-service")


_ANALYTICAL_OR_FILTER_QUERY_PATTERN = re.compile(
    r"\b("
    r"per|by|group|breakdown|total|sum|count|average|avg|min|max|top|bottom|"
    r"highest|lowest|first|last|from|before|after|between|since|during|"
    r"today|yesterday|week|month|quarter|year|january|february|march|april|"
    r"may|june|july|august|september|october|november|december"
    r")\b",
    re.IGNORECASE,
)

_AGGREGATE_QUERY_PATTERN = re.compile(
    r"\b("
    r"per|by|group|breakdown|total|sum|count|average|avg|min|max|top|bottom|"
    r"highest|lowest|quantity|qty|sold"
    r")\b",
    re.IGNORECASE,
)
_TIME_QUERY_PATTERN = re.compile(
    r"\b("
    r"today|yesterday|week|month|quarter|year|january|february|march|april|"
    r"may|june|july|august|september|october|november|december"
    r")\b",
    re.IGNORECASE,
)
_DATE_LITERAL_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2})?$")

_BROAD_TABLE_PREVIEW_COLUMN_THRESHOLD = 8


def _is_timeout_error(error_message: str) -> bool:
    if not error_message:
        return False

    normalized_error = error_message.lower()
    return "timeout" in normalized_error or "timed out" in normalized_error


def _normalize_engine_addition(addition: Any) -> dict:
    if isinstance(addition, dict):
        return addition

    if addition:
        return {"error_message": str(addition), "correlation_id": ""}

    return {}


def _canonicalize_wren_sql_syntax(sql: str | None) -> str | None:
    if not sql:
        return sql

    statements = sqlparse.parse(sql)
    if len(statements) != 1:
        return sql

    statement = statements[0]
    tokens = statement.tokens
    significant_tokens = [
        (index, token) for index, token in enumerate(tokens) if not token.is_whitespace
    ]

    if len(significant_tokens) < 3:
        return sql

    first_token = significant_tokens[0][1]
    top_token_index, top_token = significant_tokens[1]
    limit_token_index, limit_token = significant_tokens[2]
    has_limit = any(token.normalized == "LIMIT" for _, token in significant_tokens)

    if (
        first_token.ttype != sqlparse_tokens.Keyword.DML
        or first_token.normalized != "SELECT"
        or top_token.normalized != "TOP"
        or limit_token.ttype != sqlparse_tokens.Literal.Number.Integer
        or has_limit
    ):
        return sql

    before_top = "".join(str(token) for token in tokens[:top_token_index]).rstrip()
    after_limit = "".join(str(token) for token in tokens[limit_token_index + 1 :]).lstrip()

    if not before_top or not after_limit:
        return sql

    return f"{before_top} {after_limit} LIMIT {limit_token.value}".strip()


def _meaningful_tokens(token_list: TokenList) -> list:
    return [
        token
        for token in token_list.tokens
        if not token.is_whitespace and token.ttype not in sqlparse_tokens.Comment
    ]


def _identifier_name(identifier: Identifier) -> str | None:
    return identifier.get_real_name() or identifier.get_name()


def _table_reference_name(identifier: Identifier) -> str | None:
    real_name = identifier.get_real_name()
    parent_name = identifier.get_parent_name()
    if parent_name and real_name:
        return f"{parent_name}.{real_name}"

    return real_name or identifier.get_name()


def _contains_select(token: TokenList) -> bool:
    return any(
        child.ttype == sqlparse_tokens.Keyword.DML and child.normalized == "SELECT"
        for child in token.flatten()
    )


def _collect_cte_names(statement: TokenList) -> set[str]:
    tokens = _meaningful_tokens(statement)
    if not tokens or tokens[0].normalized != "WITH":
        return set()

    names = set()
    for token in tokens[1:]:
        if token.ttype == sqlparse_tokens.Keyword.DML and token.normalized == "SELECT":
            break
        if isinstance(token, IdentifierList):
            for identifier in token.get_identifiers():
                name = _identifier_name(identifier)
                if name:
                    names.add(name)
        elif isinstance(token, Identifier):
            name = _identifier_name(token)
            if name:
                names.add(name)

    return names


def _collect_table_references(token: TokenList) -> set[str]:
    table_names = set()
    tokens = _meaningful_tokens(token)
    expect_table = False

    for current in tokens:
        normalized = current.normalized

        if isinstance(current, Parenthesis):
            if _contains_select(current):
                table_names.update(_collect_table_references(current))
            continue

        if current.ttype == sqlparse_tokens.Keyword and (
            normalized == "FROM" or normalized == "JOIN" or normalized.endswith(" JOIN")
        ):
            expect_table = True
            continue

        if expect_table:
            if isinstance(current, IdentifierList):
                for identifier in current.get_identifiers():
                    if any(
                        isinstance(child, Parenthesis) and _contains_select(child)
                        for child in identifier.tokens
                    ):
                        for child in identifier.tokens:
                            if isinstance(child, Parenthesis):
                                table_names.update(_collect_table_references(child))
                    else:
                        name = _table_reference_name(identifier)
                        if name:
                            table_names.add(name)
            elif isinstance(current, Identifier):
                if any(
                    isinstance(child, Parenthesis) and _contains_select(child)
                    for child in current.tokens
                ):
                    for child in current.tokens:
                        if isinstance(child, Parenthesis):
                            table_names.update(_collect_table_references(child))
                else:
                    name = _table_reference_name(current)
                    if name:
                        table_names.add(name)
            expect_table = False

    return table_names


def _table_grounding_error(
    sql: str | None, schema_contracts: list[dict] | None
) -> str | None:
    if not sql or not schema_contracts:
        return None

    allowed_tables = {
        contract.get("table_name")
        for contract in schema_contracts
        if contract.get("table_name")
    }
    if not allowed_tables:
        return None

    statements = sqlparse.parse(sql)
    cte_names = set()
    referenced_tables = set()
    for statement in statements:
        cte_names.update(_collect_cte_names(statement))
        referenced_tables.update(_collect_table_references(statement))

    ungrounded_tables = referenced_tables - allowed_tables - cte_names
    if ungrounded_tables:
        return "Generated SQL references table identifiers outside the retrieved deployed schema."

    return None


def _sql_statement_shape_error(sql: str | None) -> str | None:
    if not sql:
        return None

    statements = [
        statement
        for statement in sqlparse.parse(sql)
        if str(statement).strip().strip(";").strip()
    ]
    if len(statements) > 1:
        return "Generated SQL contains multiple statements; return exactly one SQL statement."

    return None


def _is_select_wildcard_token(token: Any) -> bool:
    if isinstance(token, Function):
        return False

    if isinstance(token, IdentifierList):
        return any(
            _is_select_wildcard_token(identifier)
            for identifier in token.get_identifiers()
        )

    if token.ttype == sqlparse_tokens.Wildcard:
        return True

    if isinstance(token, Identifier):
        token_text = str(token).strip()
        return bool(
            token_text == "*"
            or token_text.endswith(".*")
            or token_text.upper().startswith("DISTINCT *")
        )

    return False


def _select_wildcard_error(sql: str | None) -> str | None:
    if not sql:
        return None

    for statement in sqlparse.parse(sql):
        tokens = _meaningful_tokens(statement)
        in_select_list = False
        for token in tokens:
            if (
                token.ttype == sqlparse_tokens.Keyword.DML
                and token.normalized == "SELECT"
            ):
                in_select_list = True
                continue

            if not in_select_list:
                continue

            if token.ttype == sqlparse_tokens.Keyword and token.normalized == "FROM":
                in_select_list = False
                continue

            if _is_select_wildcard_token(token):
                return (
                    "Generated SQL uses SELECT *; select explicit deployed schema "
                    "columns needed for the question."
                )

    return None


def _is_aggregate_item(token: Any) -> bool:
    token_text = str(token).upper()
    return any(
        f"{function_name}(" in token_text
        for function_name in ["COUNT", "SUM", "AVG", "MIN", "MAX"]
    )


def _select_items(statement: TokenList) -> list[Any]:
    tokens = _meaningful_tokens(statement)
    items = []
    in_select_list = False

    for token in tokens:
        if token.ttype == sqlparse_tokens.Keyword.DML and token.normalized == "SELECT":
            in_select_list = True
            continue

        if not in_select_list:
            continue

        if token.ttype == sqlparse_tokens.Keyword and token.normalized == "FROM":
            break

        if token.ttype == sqlparse_tokens.Keyword and token.normalized == "DISTINCT":
            continue

        if isinstance(token, IdentifierList):
            items.extend(list(token.get_identifiers()))
        else:
            items.append(token)

    return [item for item in items if str(item).strip()]


def _has_answer_shaping_clause(statement: TokenList) -> bool:
    for token in _meaningful_tokens(statement):
        normalized = token.normalized
        if normalized in {"WHERE", "GROUP BY", "HAVING", "ORDER BY"}:
            return True
        if normalized.startswith("WHERE "):
            return True

    return False


def _has_clause(statement: TokenList, clauses: set[str]) -> bool:
    for token in _meaningful_tokens(statement):
        normalized = token.normalized
        if normalized in clauses:
            return True
        if any(normalized.startswith(f"{clause} ") for clause in clauses):
            return True

    return False


def _table_preview_shape_error(sql: str | None, query: str | None = None) -> str | None:
    if not sql:
        return None

    query_has_shape = bool(query and _ANALYTICAL_OR_FILTER_QUERY_PATTERN.search(query))
    query_has_aggregate_shape = bool(query and _AGGREGATE_QUERY_PATTERN.search(query))

    for statement in sqlparse.parse(sql):
        if not str(statement).strip().strip(";").strip():
            continue

        items = _select_items(statement)
        if not items:
            continue

        has_aggregate_item = any(_is_aggregate_item(item) for item in items)
        has_grouping = _has_clause(statement, {"GROUP BY", "HAVING"})
        has_ordering = _has_clause(statement, {"ORDER BY"})
        has_filter = _has_clause(statement, {"WHERE"})

        referenced_tables = _collect_table_references(statement)
        cte_names = _collect_cte_names(statement)
        source_tables = referenced_tables - cte_names
        is_single_source_scan = len(source_tables) <= 1

        if (
            query_has_aggregate_shape
            and is_single_source_scan
            and not has_aggregate_item
            and not has_grouping
            and not has_ordering
        ):
            return (
                "Generated SQL does not apply the requested aggregation, grouping, "
                "ranking, or measure calculation."
            )

        if (
            is_single_source_scan
            and len(items) >= _BROAD_TABLE_PREVIEW_COLUMN_THRESHOLD
            and (query_has_shape or has_filter)
        ):
            return (
                "Generated SQL is a broad table preview; select only the explicit "
                "columns and operations needed to answer the question."
            )

        if has_aggregate_item:
            continue

        if _has_answer_shaping_clause(statement):
            continue

        if query_has_shape and is_single_source_scan:
            return (
                "Generated SQL is a table preview and does not apply the requested "
                "aggregation, grouping, filter, timeframe, ranking, or ordering."
            )

        if (
            is_single_source_scan
            and len(items) >= _BROAD_TABLE_PREVIEW_COLUMN_THRESHOLD
        ):
            return (
                "Generated SQL is a broad table preview; select only the explicit "
                "columns and operations needed to answer the question."
            )

    return None


def _unsupported_literal_filter_error(
    sql: str | None, query: str | None = None
) -> str | None:
    if not sql or not query:
        return None

    query_terms = {
        term
        for term in re.findall(r"[a-zA-Z0-9]+", query.lower())
        if len(term) >= 2
    }
    query_has_timeframe = bool(_TIME_QUERY_PATTERN.search(query))

    for statement in sqlparse.parse(sql):
        for token in statement.flatten():
            if token.ttype != sqlparse_tokens.Literal.String.Single:
                continue

            literal_value = str(token.value).strip("'\"")
            if not literal_value:
                continue

            if query_has_timeframe and _DATE_LITERAL_PATTERN.match(literal_value):
                continue

            literal_terms = {
                term
                for term in re.findall(r"[a-zA-Z0-9]+", literal_value.lower())
                if len(term) >= 2
            }
            if literal_terms and not (literal_terms & query_terms):
                return (
                    "Generated SQL contains string filter values that are not "
                    "grounded in the user's question."
                )

    return None


def build_executable_schema_contract(schema_contracts: list[dict] | None) -> str:
    if not schema_contracts:
        return ""

    sections = [
        "### EXECUTABLE WREN IDENTIFIER CATALOG ###",
        "Copy executable table and column identifiers only from this catalog or the matching DATABASE SCHEMA DDL.",
        "Use descriptions, aliases, source names, and user wording only to understand meaning.",
    ]

    for contract in schema_contracts:
        table_name = contract.get("table_name")
        if not table_name:
            continue

        sections.append(f"TABLE: {table_name}")
        column_names = [
            column_name
            for column_name in contract.get("column_names", [])
            if column_name
        ]
        if column_names:
            sections.append("COLUMNS:")
            sections.extend(f"- {column_name}" for column_name in column_names)
        else:
            sections.append("COLUMNS: declared in the matching DATABASE SCHEMA DDL")

        relationship_constraints = [
            constraint
            for constraint in contract.get("relationship_constraints", [])
            if constraint
        ]
        if relationship_constraints:
            sections.append("RELATIONSHIPS:")
            sections.extend(
                f"- {constraint}" for constraint in relationship_constraints
            )

    return "\n".join(sections)


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
        use_dry_plan: bool = False,
        allow_dry_plan_fallback: bool = False,
        data_source: str = "",
        allow_data_preview: bool = False,
        schema_contracts: list[dict] | None = None,
        query: str | None = None,
    ) -> dict:
        try:
            cleaned_generation_result = clean_generation_result(replies[0])

            # test if cleaned_generation_result in string format is actually a dictionary with key 'sql'
            if cleaned_generation_result.startswith("{"):
                cleaned_generation_result = orjson.loads(cleaned_generation_result).get(
                    "sql"
                )
                cleaned_generation_result = clean_generation_result(
                    cleaned_generation_result
                )

            cleaned_generation_result = _canonicalize_wren_sql_syntax(
                cleaned_generation_result
            )

            shape_error = _sql_statement_shape_error(cleaned_generation_result)
            if shape_error:
                return {
                    "valid_generation_result": {},
                    "invalid_generation_result": {
                        "sql": cleaned_generation_result,
                        "original_sql": cleaned_generation_result,
                        "type": "SQL_SYNTAX",
                        "error": shape_error,
                        "correlation_id": "",
                    },
                }

            grounding_error = _table_grounding_error(
                cleaned_generation_result, schema_contracts
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
                    },
                }

            wildcard_error = _select_wildcard_error(cleaned_generation_result)
            if wildcard_error:
                return {
                    "valid_generation_result": {},
                    "invalid_generation_result": {
                        "sql": cleaned_generation_result,
                        "original_sql": cleaned_generation_result,
                        "type": "SQL_SYNTAX",
                        "error": wildcard_error,
                        "correlation_id": "",
                    },
                }

            literal_filter_error = _unsupported_literal_filter_error(
                cleaned_generation_result,
                query=query,
            )
            if literal_filter_error:
                return {
                    "valid_generation_result": {},
                    "invalid_generation_result": {
                        "sql": cleaned_generation_result,
                        "original_sql": cleaned_generation_result,
                        "type": "SQL_VALUE_GROUNDING",
                        "error": literal_filter_error,
                        "correlation_id": "",
                    },
                }

            table_preview_error = _table_preview_shape_error(
                cleaned_generation_result,
                query=query,
            )
            if table_preview_error:
                return {
                    "valid_generation_result": {},
                    "invalid_generation_result": {
                        "sql": cleaned_generation_result,
                        "original_sql": cleaned_generation_result,
                        "type": "SQL_SHAPE",
                        "error": table_preview_error,
                        "correlation_id": "",
                    },
                }

            (
                valid_generation_result,
                invalid_generation_result,
            ) = await self._classify_generation_result(
                cleaned_generation_result,
                project_id=project_id,
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
        generation_result: str | None,
        project_id: str | None = None,
        use_dry_plan: bool = False,
        allow_dry_plan_fallback: bool = False,
        data_source: str = "",
        allow_data_preview: bool = False,
    ) -> Dict[str, str]:
        valid_generation_result = {}
        invalid_generation_result = {}
        use_dry_run = not allow_data_preview

        if not generation_result:
            return valid_generation_result, {
                "sql": "",
                "original_sql": "",
                "type": "NO_RELEVANT_SQL",
                "error": "No grounded SQL was generated from the current schema.",
                "correlation_id": "",
            }

        async with aiohttp.ClientSession() as session:
            if use_dry_plan:
                dry_plan_result, error_message = await self._engine.dry_plan(
                    session,
                    generation_result,
                    data_source,
                    project_id=project_id,
                    allow_fallback=allow_dry_plan_fallback,
                )

                if not dry_plan_result:
                    if _is_timeout_error(error_message):
                        if allow_dry_plan_fallback:
                            valid_generation_result = {
                                "sql": generation_result,
                                "correlation_id": "",
                            }
                            return valid_generation_result, invalid_generation_result

                        invalid_generation_result = {
                            "sql": generation_result,
                            "original_sql": generation_result,
                            "type": "DRY_PLAN",
                            "error": error_message,
                            "correlation_id": "",
                        }
                        return valid_generation_result, invalid_generation_result

                    invalid_generation_result = {
                        "sql": generation_result,
                        "original_sql": generation_result,
                        "type": "DRY_PLAN",
                        "error": error_message,
                        "correlation_id": "",
                    }
                    return valid_generation_result, invalid_generation_result

                success, _, addition = await self._engine.execute_sql(
                    generation_result,
                    session,
                    project_id=project_id,
                    limit=1,
                    dry_run=True,
                )
                addition = _normalize_engine_addition(addition)

                if success:
                    valid_generation_result = {
                        "sql": generation_result,
                        "correlation_id": addition.get("correlation_id", ""),
                    }
                else:
                    error_message = addition.get("error_message", "")
                    if _is_timeout_error(error_message):
                        valid_generation_result = {
                            "sql": generation_result,
                            "correlation_id": addition.get("correlation_id", ""),
                        }
                        return valid_generation_result, invalid_generation_result

                    invalid_generation_result = {
                        "sql": addition.get("error_sql", generation_result),
                        "original_sql": generation_result,
                        "type": "DRY_RUN",
                        "error": error_message,
                        "correlation_id": addition.get("correlation_id", ""),
                    }
            elif use_dry_run:
                success, _, addition = await self._engine.execute_sql(
                    generation_result,
                    session,
                    project_id=project_id,
                    limit=1,
                    dry_run=True,
                )
                addition = _normalize_engine_addition(addition)

                if success:
                    valid_generation_result = {
                        "sql": generation_result,
                        "correlation_id": addition.get("correlation_id", ""),
                    }
                else:
                    error_message = addition.get("error_message", "")
                    if _is_timeout_error(error_message):
                        valid_generation_result = {
                            "sql": generation_result,
                            "correlation_id": addition.get("correlation_id", ""),
                        }
                        return valid_generation_result, invalid_generation_result

                    invalid_generation_result = {
                        "sql": addition.get("error_sql", generation_result),
                        "original_sql": generation_result,
                        "type": "DRY_RUN",
                        "error": error_message,
                        "correlation_id": addition.get("correlation_id", ""),
                    }
            else:
                has_data, _, addition = await self._engine.execute_sql(
                    generation_result,
                    session,
                    project_id=project_id,
                    limit=1,
                    dry_run=False,
                )
                addition = _normalize_engine_addition(addition)

                if has_data:
                    valid_generation_result = {
                        "sql": generation_result,
                        "correlation_id": addition.get("correlation_id", ""),
                    }
                else:
                    error_message = addition.get("error_message", "")
                    if _is_timeout_error(error_message):
                        valid_generation_result = {
                            "sql": generation_result,
                            "correlation_id": addition.get("correlation_id", ""),
                        }
                        return valid_generation_result, invalid_generation_result

                    preview_data_status = (
                        "PREVIEW_EMPTY_DATA"
                        if error_message == ""
                        else "PREVIEW_FAILED"
                    )
                    invalid_generation_result = {
                        "sql": addition.get("error_sql", generation_result),
                        "original_sql": generation_result,
                        "type": preview_data_status,
                        "error": error_message,
                        "correlation_id": addition.get("correlation_id", ""),
                    }

        return valid_generation_result, invalid_generation_result


_MANDATORY_SQL_GROUNDING_RULES = """
### MANDATORY SQL GROUNDING RULES ###
- Treat the retrieved semantic context as the only authoritative source for this request. Do not use pretrained knowledge, common warehouse schemas, example schemas, or memorized business definitions as executable truth.
- Treat the DATABASE SCHEMA section as the only source of executable table and column identifiers.
- Use only deployed semantic models, views, metrics, relationships, and columns that are present in the retrieved DATABASE SCHEMA, WREN SQL IDENTIFIER CONTRACT, EXECUTABLE WREN IDENTIFIER CATALOG, SQL FUNCTIONS, or current USER INSTRUCTIONS.
- Before generating SQL, silently validate that every model, column, metric, relationship, join path, filter field, grouping field, ordering field, and SQL function is present in the retrieved context. Generate SQL only after this validation succeeds.
- Every table and column referenced in SELECT, FROM, JOIN, WHERE, GROUP BY, HAVING, and ORDER BY must appear exactly in the CREATE TABLE, CREATE VIEW, or metric schema text provided in DATABASE SCHEMA.
- Comments, aliases, display labels, descriptions, reasoning text, SQL samples, and user wording are semantic hints only. They are never source table or source column identifiers.
- Physical datasource names, source database names, source schema names, source table names, source column names, lineage names, and names embedded inside descriptions or comments are semantic context only. Never use them as executable Wren table or column identifiers unless the exact same identifier is declared in DATABASE SCHEMA.
- Interpret the user's intent from the question wording, schema descriptions, aliases, display labels, calculated fields, metrics, and relationships, then express that intent with exact executable identifiers from DATABASE SCHEMA.
- When DATABASE SCHEMA contains WREN RETRIEVED SEMANTIC CONTEXT blocks, first use those blocks to understand each retrieved object's exact SQL identifier contract, semantic meaning, relationships, views, metrics, and calculated fields.
- When DATABASE SCHEMA contains WREN SQL IDENTIFIER CONTRACT sections, treat them as the compact authoritative list of executable identifiers for each retrieved object before reading semantic descriptions.
- In WREN RETRIEVED SEMANTIC CONTEXT, copy executable identifiers only from sql_table_name_use_exactly, sql_column_name_use_exactly, sql_column_names_use_exactly, relationship_constraints_use_exactly, or the following DDL declarations.
- Values under semantic_context_not_sql_identifiers and semantic_context_not_sql_identifier are meaning only. Do not combine words, labels, ordinals, prefixes, suffixes, abbreviations, comments, or descriptions from those values into a table or column identifier.
- Values under column_role_hints_not_identifiers are semantic roles only. Use them to decide whether an exact declared column can serve as a date/time field, measure, identifier, or dimension, but copy executable column names only from the columns list or DDL.
- When a business term is represented by a column alias, display label, or description, use the corresponding real table and column name from DATABASE SCHEMA in the SQL, not the display text.
- The executable identifier is the name in the CREATE TABLE, CREATE VIEW, or metric field declaration. Do not derive executable identifiers by rewriting, translating, singularizing, pluralizing, spacing, casing, or abbreviating natural language, comments, aliases, display labels, or descriptions.
- Never generate SQL from assumptions such as "assuming the table contains", "assuming this column exists", or "a possible table/column". Use only schema-confirmed identifiers.
- Never generate placeholder identifiers, placeholder table names, or template markers in the SQL. If the retrieved metadata does not contain an executable object or column for a requested concept, omit that unsupported concept.
- Never invent string literal filter values. Use a string value in WHERE, HAVING, CASE, or JOIN conditions only when that value is explicitly present in the user's current question or grounded by a current USER INSTRUCTION. For relative time requests, bounded date literals may be generated only from the requested timeframe and an exact date/time column.
- Never create an identifier from user question wording by changing spaces, casing, punctuation, singular/plural form, abbreviations, prefixes, or suffixes. If the exact requested table or column concept is not represented by a retrieved schema identifier, return null for sql.
- If a requested concept, output column, filter, sort, join, grouping, measure, or time field is not represented by an exact table or column in DATABASE SCHEMA, do not invent a field for it. If that field is required to answer the request, return null for sql.
- When a dry run error reports an invalid object name or invalid column name, remove that identifier unless it appears exactly in DATABASE SCHEMA. Correct it only to an exact schema identifier.
- Do not replace an invalid identifier with a similar-looking physical, source, lineage, alias, display, description, sample, or error-message name. Regenerate from the user's intent and the current DATABASE SCHEMA, and omit unsupported parts instead of substituting non-schema identifiers.
- Prefer a single table, view, or metric that already contains the requested fields. Do not join tables just because they were retrieved together.
- When using multiple tables to combine fields into the same output row, join only through the exact FOREIGN KEY constraints shown in DATABASE SCHEMA. If no relationship is shown for the needed tables, return null for sql or use one schema object that already contains the requested fields.
- If multiple semantic interpretations exist and the retrieved context does not make one interpretation authoritative, return null for sql instead of choosing one.
- When the same requested result can be answered from multiple schema objects with compatible columns or metrics, include all relevant schema objects by combining separate result rows with UNION ALL instead of choosing only one object.
- Use UNION ALL only when each SELECT branch is independently valid from DATABASE SCHEMA and returns the same result shape. Do not use UNION ALL to combine unrelated concepts or to compensate for missing columns.
- If the question requires fields that are spread across multiple schema objects, use all required related tables, views, or metrics only when the DATABASE SCHEMA provides the needed columns and an exact relationship path. Do not invent join predicates from similar column names.
- Do not query INFORMATION_SCHEMA, system catalogs, metadata tables, or table-existence checks to answer the user. Query only the business tables, views, and metrics in DATABASE SCHEMA.
- SQL samples and query history are examples of intent and style only. Never copy a table name, column name, alias, literal value, or function from them unless it is also valid for the current DATABASE SCHEMA and SQL FUNCTIONS.
- Generate Wren SQL only. Do not use warehouse-specific functions unless they are explicitly listed in SQL FUNCTIONS for this request.
- Apply relative date or time filters only when DATABASE SCHEMA contains an exact date/time field for the requested time concept and the predicate can be expressed with normal SQL comparison syntax or an operation listed in SQL FUNCTIONS. Do not compare text fields to date functions.
- For explicit month/year or relative timeframe requests, prefer a bounded range predicate on one exact date_time_candidate column when available. The lower bound is inclusive and the upper bound is exclusive. Do not answer a timeframe request with an unfiltered table scan.
- Treat reasoning plans, correction notes, and error messages as non-executable context. Never copy SQL fragments, inferred identifiers, placeholder names, template markers, literal values, or unsupported functions from them.
- If SQL execution or validation fails, repair the query only when the repair can be verified using the same retrieved DATABASE SCHEMA, WREN SQL IDENTIFIER CONTRACT, and SQL FUNCTIONS. Never introduce a new schema object during repair.
- If a column comment, alias, display label, or description names a business concept, first locate the exact declared source column for that concept in DATABASE SCHEMA. If no exact declared source column exists, omit that concept.
- For aggregate sorting, select the aggregate with an alias and order by that alias instead of ordering directly by an aggregate expression.
- Before returning the final SQL, silently check that each identifier and function in the SQL is grounded in DATABASE SCHEMA or SQL FUNCTIONS. If any identifier or function is ungrounded, remove that part. If the ungrounded part is needed to answer the user's requested intent, return null for sql.
- If the retrieved DATABASE SCHEMA does not contain a table, column, relationship, or supported function needed for part of the user's request, leave that part out instead of inventing a replacement.
- If a requested noun, output column, grouping, filter, or measure appears only in the user's wording and not in DATABASE SCHEMA, do not translate it into a generic object name. Use only schema-supported concepts and omit unsupported parts.
- If the user's primary requested subject, output column, grouping, filter, timeframe, measure, or required relationship cannot be grounded by the retrieved DATABASE SCHEMA, return null for sql instead of producing an approximate query.
- Do not answer by selecting a nearby table only because it was retrieved. A retrieved object is usable only when its declared table, columns, relationships, or metric fields support the user's requested intent.
- Do not answer a specific business question with a broad table scan. The SQL shape must match the user's requested output columns, filters, groupings, measures, joins, ordering, and limits.
- For analytical or metric questions, select only the requested dimensions and measures. Use declared metric columns, calculated fields, relationship paths, and schema-grounded aggregate expressions. If the required metric components are not grounded, return null for sql instead of returning raw rows.
- For questions asking total, count, average, minimum, maximum, ratio, per, by, top, bottom, highest, lowest, trend, month, week, year, or ranking, produce an analytical query shape: select exact dimension columns or date buckets, aggregate exact numeric_measure_candidate columns or count rows, GROUP BY every non-aggregated selected expression, ORDER BY the selected aggregate alias when ranking, and apply LIMIT only when requested.
- If the question asks for an entity list with a timeframe or filter but no metric, select only the entity identifier, relevant dimensions, and exact date/time column needed by the request; include the requested WHERE predicate. Do not select every column from the table.
"""


_DEFAULT_TEXT_TO_SQL_RULES = """
### SQL RULES ###
- ONLY USE SELECT statements, NO DELETE, UPDATE OR INSERT etc. statements that might change the data in the database.
- ONLY USE the tables and columns mentioned in the database schema.
- Never use "*" in the SELECT list. Select explicit deployed schema columns needed for the question. When the user asks for all records, all rows, all users, all orders, or similar, treat "all" as row scope and still select explicit columns relevant to the requested entity or metric.
- ONLY CHOOSE columns belong to the tables mentioned in the database schema.
- DON'T INCLUDE comments in the generated SQL query.
- Use JOIN only when selected columns come from multiple tables and DATABASE SCHEMA declares the exact FOREIGN KEY relationship needed for the join. Do not invent join predicates from similar-looking column names.
- PREFER USING CTEs over subqueries.
- When generating SQL query, always:
    - Put double quotes around column and table names.
    - Use Wren SQL identifier quoting with double quotes only; the engine rewrite step converts grounded Wren SQL to the active connector dialect.
    - Put single quotes around string literals.
    - Never quote numeric literals.
- Generate Wren SQL syntax only, not connector-specific SQL syntax.
- Never use SELECT TOP, TOP(...), FETCH FIRST, square-bracket identifiers, or backtick identifiers. For top or limit requests, sort with ORDER BY and put LIMIT at the end of the query.
- Preserve every deployed table and column identifier exactly as it appears in DATABASE SCHEMA or WREN SQL IDENTIFIER CONTRACT, including spaces, digits, underscores, case, and punctuation, then wrap that exact identifier in double quotes in SQL.
- Do not convert deployed identifiers into display-friendly variants by replacing spaces with underscores, removing prefixes, changing case, shortening names, or expanding abbreviations.
- For case-insensitive comparisons, use only functions or operators that are supported by SQL FUNCTIONS for this request. If SQL FUNCTIONS does not provide a safe case-insensitive function, use a normal equality or LIKE comparison on an exact schema column.
- For date/time questions, first choose an exact schema column whose type or metadata clearly represents the requested time concept. Use only date/time functions and casts whose exact syntax is provided in SQL FUNCTIONS for this request.
- If the question asks for a specific or relative date, generate a bounded date/time filter only when the exact date/time schema column is available and the predicate can be expressed with normal SQL comparison syntax or a SQL FUNCTIONS-supported operation. If either the column or required operation is missing, do not invent a field or function.
- When DATABASE SCHEMA includes column_role_hints_not_identifiers, use date_time_candidate, numeric_measure_candidate, identifier_candidate, and dimension_candidate roles to map the question intent to exact declared columns. These role names are never executable SQL identifiers.
- For explicit calendar month and year requests, use an inclusive lower bound and exclusive upper bound on the exact date/time column, rather than formatting the column into text.
- USE THE VIEW TO SIMPLIFY THE QUERY.
- DON'T MISUSE THE VIEW NAME. THE ACTUAL NAME IS FOLLOWING THE CREATE VIEW STATEMENT.
- Output aliases may be used only to name expressions in the final SELECT list. Output aliases are labels for result columns only; they are not source identifiers.
- For metric-style requests, the final SELECT list must expose the requested dimension columns and measure expressions or metric fields. Do not return every raw column from a retrieved model as a substitute for the requested metric.
- For aggregate, ranking, or "by" requests, do not add unrelated string filters to make the SQL look specific. If the user did not provide a filter value, leave it out.
- For total, count, average, minimum, maximum, per, by, trend, top, bottom, highest, lowest, or ranking requests, the final SQL must include the requested aggregate expression or metric field, GROUP BY required dimensions, ORDER BY required ranking expression, and LIMIT only when requested. A raw row list is not a valid answer.
- For record-list requests with a filter or timeframe, the final SQL must include the requested WHERE predicate and only the columns needed to identify and describe the matching records.
- Comments, aliases, display labels, and descriptions from DATABASE SCHEMA may guide which exact source column to select, but they must not be copied into FROM, JOIN, WHERE, GROUP BY, HAVING, or ORDER BY as table or column names.
- Physical/source/lineage names from metadata may guide meaning, but generated SQL must use only the declared Wren model, view, metric, and column identifiers from DATABASE SCHEMA.
- DON'T USE '.' in output aliases, replace '.' with '_' in output aliases.
- DON'T USE "FILTER(WHERE <expression>)" clause in the generated SQL query.
- DON'T USE "EXTRACT(EPOCH FROM <expression>)" clause in the generated SQL query.
- DON'T USE "EXTRACT()" function with INTERVAL data types as arguments
- DON'T USE INTERVAL or generate INTERVAL-like expression in the generated SQL query.
- DON'T USE "TO_CHAR" function in the generated SQL query.
- DON'T USE unsupported statistical, date/time, or formatting functions. If SQL FUNCTIONS does not list a function needed by the requested intent, omit the function-dependent part. If that function is required to answer the request, return null for sql.
- Aggregate functions are not allowed in the WHERE clause. Instead, they belong in the HAVING clause, which is used to filter after aggregation.
- You can only add "ORDER BY" and "LIMIT" to the final "UNION" result.
- For top, bottom, highest, lowest, first, or last requests, sort by an exact selected column or aggregate alias and use LIMIT unless the user explicitly asks for rank values.
"""


_DEFAULT_CALCULATED_FIELD_INSTRUCTIONS = """
#### Instructions for Calculated Field ####

The first structure is the special column marked as "Calculated Field". You need to interpret the purpose and calculation basis for these columns, then utilize them in the following text-to-sql generation tasks.
First, interpret each calculated field from its expression, data type, comments, aliases, descriptions, and relationship context in the provided DATABASE SCHEMA.
Then, if the user query matches a concept already represented by a calculated field, use that exact calculated field name from DATABASE SCHEMA instead of recreating or inventing the calculation.
Calculated field expressions are semantic definitions; do not copy identifiers from an expression unless they also appear as executable identifiers in the current DATABASE SCHEMA.
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
Use metric columns exactly as declared in DATABASE SCHEMA. Treat dimensions as grouping/filtering fields and measures as pre-defined numeric outputs. Metric base objects and measure expressions are semantic context only; do not copy identifiers from them unless those identifiers also appear in the current DATABASE SCHEMA.
When a question asks for a measure by one or more dimensions, produce a metric-shaped result: select the dimension columns, select the requested measure or grounded expression, group by the dimensions when aggregation is needed, and order or limit only when requested or needed by the question. Do not answer a metric question by selecting every column from a base model.
"""

_DEFAULT_JSON_FIELD_INSTRUCTIONS = """
#### Instructions for JSON related functions ####
- ONLY USE JSON_QUERY for querying fields if "json_type":"JSON" is identified in the columns comment, NOT the deprecated JSON_EXTRACT_SCALAR function.
    - DON'T USE CAST for JSON fields, ONLY USE the following funtions:
      - LAX_BOOL for boolean fields
      - LAX_FLOAT64 for double and float fields
      - LAX_INT64 for bigint fields
      - LAX_STRING for varchar fields
    - JSON paths and nested field names must come from the json_fields metadata attached to the exact JSON column in DATABASE SCHEMA.
- ONLY USE JSON_QUERY_ARRAY for querying "json_type":"JSON_ARRAY" is identified in the comment of the column, NOT the deprecated JSON_EXTRACT_ARRAY.
    - USE UNNEST to analysis each item individually in the ARRAY. YOU MUST SELECT FROM the parent table ahead of the UNNEST ARRAY.
    - The alias of the UNNEST(ARRAY) should be in the format `unnest_table_alias(individual_item_alias)`
    - If the items in the ARRAY are JSON objects, use JSON_QUERY to query the fields inside each JSON item.
    - To JOIN ON the fields inside UNNEST(ARRAY), YOU MUST SELECT FROM the parent table ahead of the UNNEST syntax, and the alias of the UNNEST(ARRAY) SHOULD BE IN THE FORMAT unnest_table_alias(individual_item_alias)
    - Do not copy JSON examples, placeholder aliases, or nested paths from prior context. Use only the current table name, JSON column name, and json_fields metadata in DATABASE SCHEMA.
- DON'T USE JSON_QUERY and JSON_QUERY_ARRAY when "json_type":"".
- DON'T USE LAX_BOOL, LAX_FLOAT64, LAX_INT64, LAX_STRING when "json_type":"".
"""

sql_samples_instructions = """
#### Instructions for SQL Samples ####

Finally, you will learn from the sample questions provided in the input. These samples demonstrate intent and response style for this specific database.

For each sample, you should:
1. Study the question that explains what the query aims to accomplish
2. Use these samples as intent and style context only, but treat the DATABASE SCHEMA as the only valid source of executable table and column names
3. Adapt the intent patterns to match new query requirements while maintaining consistent style and approach
4. Never copy table names, column names, aliases, literal values, placeholders, or functions from samples

The samples will help you understand:
- Common analytical intents
- Common aggregation requests
- Preferred answer style

When generating new queries, follow similar intent patterns when applicable, while adapting them to the specific requirements of each new query.

Learn about the user's intent from the samples and generate SQL from the current DATABASE SCHEMA and SQL FUNCTIONS only.
"""


sql_generation_reasoning_system_prompt = """
### TASK ###
You are a helpful data analyst who explains the user's analytical intent and provides a concise, non-executable reasoning plan for answering the user's question.

### INSTRUCTIONS ###
1. Think deeply and reason about the user's question, the database schema, and the user's query history if provided.
2. Explicitly state requested timeframes in natural language only. Mention exact date/time columns only when they are declared in DATABASE SCHEMA or WREN SQL IDENTIFIER CONTRACT.
3. For top, bottom, first, last, highest, or lowest requests, describe the requested ordering and limit in natural language. Mention exact ordering columns or measures only when they are declared in DATABASE SCHEMA or WREN SQL IDENTIFIER CONTRACT.
4. Do not mention SQL functions, operators, or expression syntax in the reasoning plan.
5. If USER INSTRUCTIONS section is provided, make sure to consider them in the reasoning plan.
6. If SQL SAMPLES section is provided, make sure to consider them in the reasoning plan.
7. Give a step by step reasoning plan in order to answer user's question.
8. The reasoning plan should be in the language same as the language user provided in the input.
9. Don't include SQL in the reasoning plan.
10. Each step in the reasoning plan must start with a number, a title(in bold format in markdown), and a reasoning for the step.
11. Do not include ```markdown or ``` in the answer.
12. Mention table names only by writing the literal prefix `table:` followed by an exact table name declared in DATABASE SCHEMA or WREN SQL IDENTIFIER CONTRACT.
13. Mention column names only by writing the literal prefix `column:` followed by an exact declared table name, a dot, and an exact column name declared for that table in DATABASE SCHEMA or WREN SQL IDENTIFIER CONTRACT.
14. Do not mention aliases, source names, physical names, lineage names, schema names, database names, literal values, placeholders, or identifier-like labels from comments, SQL samples, failed SQL, or user wording as executable identifiers.
15. Do not write SQL, possible SQL, sample SQL, assumed SQL, SQL clauses, SQL functions, code blocks, or executable expressions in the reasoning plan. Do not write date/time expressions in the reasoning plan.
16. Never use phrases such as "assuming the table contains", "assuming this column exists", or "the SQL could look like this". If the available metadata does not clearly support part of the request, state that the available metadata does not support that part without naming missing objects.
17. If the question asks for a concept, filter, sort, or timeframe, describe the requested operation in business language and cite exact declared tables or columns only when they are grounded by DATABASE SCHEMA.
18. Interpret the user's intent from wording, aliases, display labels, descriptions, calculated fields, metrics, and relationships, then ground the plan in exact declared schema identifiers.
19. If multiple schema objects are required, identify the exact declared relationship path from DATABASE SCHEMA. If no relationship path is declared, say that the retrieved metadata does not provide a join path.
20. Treat SQL samples and query history as examples only. Do not copy table names, column names, aliases, values, placeholders, functions, or SQL patterns from them into the reasoning plan unless they also appear exactly in DATABASE SCHEMA.
21. Do not mention placeholder SQL, metadata-table checks, INFORMATION_SCHEMA, or replacement instructions to the user.
22. The reasoning plan is semantic context for intent only, not a source of executable identifiers. SQL generation must re-read DATABASE SCHEMA and WREN SQL IDENTIFIER CONTRACT before using any identifier.
23. ONLY SHOWING the reasoning plan in bullet points.
24. Do not use the words "assume", "assuming", "likely", "possible", "might", or "example" when describing tables, columns, filters, or SQL.
25. If exact deployed table and column identifiers are not available for a requested part, say only that the retrieved metadata does not support that part. Do not propose a replacement name.
26. Do not write table names or column names from the user's wording unless the same identifier appears exactly in DATABASE SCHEMA or WREN SQL IDENTIFIER CONTRACT.
27. Do not include code blocks, inline SQL fragments, SELECT statements, WHERE clauses, join clauses, or any query-shaped text in the reasoning plan.

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
    rules = _DEFAULT_TEXT_TO_SQL_RULES
    if sql_knowledge is not None:
        rules = _extract_from_sql_knowledge(
            sql_knowledge, "text_to_sql_rule", _DEFAULT_TEXT_TO_SQL_RULES
        )

    return f"{rules}\n\n{_MANDATORY_SQL_GROUNDING_RULES}"


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
You are a helpful assistant that converts natural language queries into Wren SQL queries.

Given the user's question and database schema, generate one grounded Wren SQL query. The DATABASE SCHEMA is the only source of executable identifiers.

### GENERAL RULES ###

1. YOU MUST FOLLOW the instructions strictly to generate the SQL query if the section of USER INSTRUCTIONS is available in user's input.
2. YOU MUST ONLY CHOOSE the appropriate functions from the sql functions list and use them in the SQL query if the section of SQL FUNCTIONS is available in user's input. Use the exact supported syntax shown there; otherwise omit the function-dependent part of the request.
3. YOU MUST REFER to the sql samples only as examples of intent and style if the section of SQL SAMPLES is available in user's input. Do not copy identifiers, literals, placeholders, SQL patterns, or functions from samples.
4. YOU MUST treat the reasoning plan as semantic context for intent only. Do not copy identifiers, functions, literal values, SQL fragments, template markers, or placeholders from the reasoning plan. Choose every executable identifier only from DATABASE SCHEMA or WREN SQL IDENTIFIER CONTRACT, and every function only from SQL FUNCTIONS.
5. YOU MUST answer the user's intent, not just exact wording. Use schema aliases, descriptions, calculated fields, metrics, and relationships to understand intent, then generate SQL with exact DATABASE SCHEMA identifiers only.
6. YOU MUST first read any WREN SQL IDENTIFIER CONTRACT and WREN RETRIEVED SEMANTIC CONTEXT block attached to each schema object. Use sql_table_name_use_exactly, sql_column_name_use_exactly, sql_column_names_use_exactly, relationship_constraints_use_exactly, and the following DDL declarations as executable grounding. Use semantic_context_not_sql_identifiers and semantic_context_not_sql_identifier only to understand business meaning.
7. When DATABASE SCHEMA contains EXECUTABLE WREN IDENTIFIER CATALOG sections, treat those sections as the first and clearest list of allowed executable identifiers.
8. If the user asks for fields that exist across multiple related schema objects, include those objects only when DATABASE SCHEMA shows the exact columns and relationship path needed to join them.
9. If the user asks for a result that is represented in multiple schema objects with compatible fields, include all relevant objects using independently valid SELECT branches combined with UNION ALL. Use joins only for relationship-backed row-level combinations.
10. Before finalizing the JSON response, YOU MUST perform a silent grounding check: every table, column, join key, filter field, grouping field, ordering field, and function in the SQL must be present in DATABASE SCHEMA or SQL FUNCTIONS. If a planned element is not grounded, omit that element. If the element is needed to answer the user's requested subject, output column, filter, grouping, measure, timeframe, or relationship, return null for sql.
11. YOU MUST treat source database/schema/table names, physical datasource names, lineage names, comments, aliases, and display labels as semantic context only. Never use them as executable identifiers unless the exact same identifier appears in DATABASE SCHEMA.
12. If an identifier, literal value, placeholder, template marker, or function appears only in SQL samples, failed SQL, descriptions, lineage, reasoning text, or error messages, it is not executable for this request; ignore those parts when generating executable SQL.
13. If any planned SQL identifier cannot be copied exactly from DATABASE SCHEMA, EXECUTABLE WREN IDENTIFIER CATALOG, or WREN SQL IDENTIFIER CONTRACT, return null for sql. Never create a table or column from the user's wording.
14. YOU MUST FOLLOW SQL Rules if they are not contradicted with instructions.

{text_to_sql_rules}

### FINAL ANSWER FORMAT ###
The final answer must be JSON. Return a SQL string only when it is fully grounded in DATABASE SCHEMA and SQL FUNCTIONS and it answers the user's requested intent. Do not create table or column identifiers from the user's wording. If the retrieved schema does not ground the requested subject, output column, filter, grouping, measure, timeframe, or relationship, return null for sql.

{{
    "sql": "SQL query string using only identifiers declared in DATABASE SCHEMA, or null"
}}
"""


class SqlGenerationResult(BaseModel):
    sql: str | None


SQL_GENERATION_MODEL_KWARGS = {
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "sql_generation_result",
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
    return []
