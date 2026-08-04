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
_RANKING_QUERY_PATTERN = re.compile(
    r"\b(top|bottom|highest|lowest|most|least|largest|smallest|fastest|slowest)\b",
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


def _normalize_identifier_part(identifier: str | None) -> str:
    if not identifier:
        return ""

    return identifier.strip().strip('"`[]').lower()


def _schema_contract_index(
    schema_contracts: list[dict] | None,
) -> dict[str, dict[str, Any]]:
    index: dict[str, dict[str, Any]] = {}
    for contract in schema_contracts or []:
        table_name = contract.get("table_name")
        normalized_table_name = _normalize_identifier_part(table_name)
        if not table_name or not normalized_table_name:
            continue

        column_names = [
            column_name for column_name in contract.get("column_names", []) if column_name
        ]
        index[normalized_table_name] = {
            "table_name": table_name,
            "columns": {
                _normalize_identifier_part(column_name) for column_name in column_names
            },
            "has_column_contract": bool(column_names),
        }

    return index


def _identifier_contains_subquery(identifier: Identifier) -> bool:
    return any(
        isinstance(child, Parenthesis) and _contains_select(child)
        for child in identifier.tokens
    )


def _mark_identifier_tree(identifier: Identifier, marked_ids: set[int]) -> None:
    marked_ids.add(id(identifier))
    for child in identifier.tokens:
        if isinstance(child, Identifier):
            _mark_identifier_tree(child, marked_ids)
        elif isinstance(child, IdentifierList):
            for child_identifier in child.get_identifiers():
                _mark_identifier_tree(child_identifier, marked_ids)
        elif isinstance(child, TokenList):
            for nested_child in child.tokens:
                if isinstance(nested_child, Identifier):
                    _mark_identifier_tree(nested_child, marked_ids)


def _collect_table_context(
    token: TokenList,
    schema_index: dict[str, dict[str, Any]],
    cte_names: set[str],
) -> tuple[dict[str, str], set[int]]:
    aliases: dict[str, str] = {}
    table_identifier_ids: set[int] = set()
    tokens = _meaningful_tokens(token)
    expect_table = False

    def add_table_identifier(identifier: Identifier) -> None:
        if _identifier_contains_subquery(identifier):
            for child in identifier.tokens:
                if isinstance(child, Parenthesis):
                    child_aliases, child_table_ids = _collect_table_context(
                        child, schema_index, cte_names
                    )
                    aliases.update(child_aliases)
                    table_identifier_ids.update(child_table_ids)
            return

        table_name = _table_reference_name(identifier)
        normalized_table_name = _normalize_identifier_part(table_name)
        if not normalized_table_name or normalized_table_name in cte_names:
            _mark_identifier_tree(identifier, table_identifier_ids)
            return

        if normalized_table_name not in schema_index:
            _mark_identifier_tree(identifier, table_identifier_ids)
            return

        _mark_identifier_tree(identifier, table_identifier_ids)
        aliases[normalized_table_name] = normalized_table_name

        real_name = _normalize_identifier_part(identifier.get_real_name())
        if real_name:
            aliases[real_name] = normalized_table_name

        alias = _normalize_identifier_part(identifier.get_alias())
        if alias:
            aliases[alias] = normalized_table_name

    for current in tokens:
        normalized = current.normalized

        if isinstance(current, Parenthesis):
            if _contains_select(current):
                child_aliases, child_table_ids = _collect_table_context(
                    current, schema_index, cte_names
                )
                aliases.update(child_aliases)
                table_identifier_ids.update(child_table_ids)
            continue

        if current.ttype == sqlparse_tokens.Keyword and (
            normalized == "FROM" or normalized == "JOIN" or normalized.endswith(" JOIN")
        ):
            expect_table = True
            continue

        if expect_table:
            if isinstance(current, IdentifierList):
                for identifier in current.get_identifiers():
                    add_table_identifier(identifier)
            elif isinstance(current, Identifier):
                add_table_identifier(current)
            expect_table = False

    return aliases, table_identifier_ids


def _iter_identifier_nodes(
    token: TokenList, parent: TokenList | None = None
) -> list[tuple[Identifier, TokenList | None]]:
    identifiers: list[tuple[Identifier, TokenList | None]] = []
    if isinstance(token, Identifier):
        identifiers.append((token, parent))

    if isinstance(token, TokenList):
        for child in token.tokens:
            if isinstance(child, TokenList):
                identifiers.extend(_iter_identifier_nodes(child, token))

    return identifiers


def _select_aliases(statement: TokenList) -> set[str]:
    return {
        _normalize_identifier_part(item.get_alias())
        for item in _select_items(statement)
        if isinstance(item, Identifier) and item.get_alias()
    }


def _identifier_has_function_child(identifier: Identifier) -> bool:
    return any(isinstance(child, Function) for child in identifier.tokens)


def _column_grounding_error(
    sql: str | None, schema_contracts: list[dict] | None
) -> str | None:
    if not sql or not schema_contracts:
        return None

    schema_index = _schema_contract_index(schema_contracts)
    if not schema_index:
        return None

    for statement in sqlparse.parse(sql):
        cte_names = {
            _normalize_identifier_part(cte_name)
            for cte_name in _collect_cte_names(statement)
        }
        table_aliases, table_identifier_ids = _collect_table_context(
            statement, schema_index, cte_names
        )
        referenced_tables = set(table_aliases.values())
        if not referenced_tables:
            continue

        allowed_unqualified_columns = set()
        all_referenced_tables_have_column_contract = True
        for table_name in referenced_tables:
            table_contract = schema_index.get(table_name)
            if not table_contract:
                continue
            allowed_unqualified_columns.update(table_contract["columns"])
            all_referenced_tables_have_column_contract = (
                all_referenced_tables_have_column_contract
                and table_contract["has_column_contract"]
            )

        select_aliases = _select_aliases(statement)

        for identifier, parent in _iter_identifier_nodes(statement):
            if id(identifier) in table_identifier_ids:
                continue

            if isinstance(parent, Function):
                function_name = _normalize_identifier_part(parent.get_name())
                if _normalize_identifier_part(_identifier_name(identifier)) == function_name:
                    continue

            if _identifier_has_function_child(identifier):
                continue

            column_name = _normalize_identifier_part(identifier.get_real_name())
            if not column_name:
                continue

            parent_name = _normalize_identifier_part(identifier.get_parent_name())
            if parent_name:
                if parent_name in cte_names:
                    continue

                source_table_name = table_aliases.get(parent_name)
                if not source_table_name:
                    return (
                        "Generated SQL references column identifiers outside the "
                        "retrieved deployed schema."
                    )

                table_contract = schema_index.get(source_table_name)
                if (
                    table_contract
                    and table_contract["has_column_contract"]
                    and column_name not in table_contract["columns"]
                ):
                    return (
                        "Generated SQL references column identifiers outside the "
                        "retrieved deployed schema."
                    )
                continue

            if column_name in select_aliases or column_name in cte_names:
                continue
            if column_name in table_aliases:
                continue
            if column_name in allowed_unqualified_columns:
                continue

            if all_referenced_tables_have_column_contract:
                return (
                    "Generated SQL references column identifiers outside the "
                    "retrieved deployed schema."
                )

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
    query_has_ranking_shape = bool(query and _RANKING_QUERY_PATTERN.search(query))

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

        if query_has_ranking_shape and has_aggregate_item and not has_ordering:
            return (
                "Generated SQL does not apply the requested ranking or ordering."
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
            if not replies:
                (
                    valid_generation_result,
                    invalid_generation_result,
                ) = await self._classify_generation_result(
                    None,
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

            cleaned_generation_result = clean_generation_result(replies[0])

            # test if cleaned_generation_result in string format is actually a dictionary with key 'sql'
            if cleaned_generation_result.startswith("{"):
                cleaned_generation_result = orjson.loads(cleaned_generation_result).get(
                    "sql"
                )
                if not cleaned_generation_result:
                    (
                        valid_generation_result,
                        invalid_generation_result,
                    ) = await self._classify_generation_result(
                        None,
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

            column_grounding_error = _column_grounding_error(
                cleaned_generation_result, schema_contracts
            )
            if column_grounding_error:
                return {
                    "valid_generation_result": {},
                    "invalid_generation_result": {
                        "sql": cleaned_generation_result,
                        "original_sql": cleaned_generation_result,
                        "type": "SCHEMA_GROUNDING",
                        "error": column_grounding_error,
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

            (
                valid_generation_result,
                invalid_generation_result,
            ) = await self._classify_generation_result(
                None,
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
- Treat the retrieved semantic context as the only authoritative source for this request.
- Do not use pretrained knowledge, common warehouse schemas, example schemas, or memorized business definitions as executable truth.
- Use the retrieved DATABASE SCHEMA and WREN SQL IDENTIFIER CONTRACT as the only executable context.
- Before generating SQL, silently validate that every model, column, metric, relationship, join path, filter field, grouping field, ordering field, and SQL function is present in the retrieved context.
- Use comments, aliases, descriptions, display labels, metrics, calculated fields, and relationships only to understand business meaning.
- Use role-hint metadata only as semantic hints for choosing exact declared columns. Metadata role labels are never SQL identifiers or SQL literal values.
- Copy executable table, column, metric, and relationship identifiers exactly from DATABASE SCHEMA. Do not create identifiers from user wording, descriptions, samples, history, physical names, lineage names, or error messages.
- Never output template SQL. Every table, column, metric, relationship, join key, function, filter value, grouping, ordering, and limit in the final SQL must be complete and executable for the current request.
- Never output generic, unresolved, variable-like, or placeholder identifiers or literal values. If a value or identifier would need to be filled in later, return null for sql.
- The SQL must answer every supported part of the user's request: requested subject, requested entity, requested filter value, timeframe, grouping, measure, ordering, and limit.
- Preserve the user's requested result shape exactly. Do not convert a detail-list request into a count, distinct count, latest-row query, top query, or summary unless the user explicitly asks for that operation.
- Do not add implicit filters, latest-period logic, maximum-date logic, row limits, distinctness, aggregation, or ordering unless the current user request requires it.
- If the user asks for a filtered result, include the filter only when the filtered concept is represented by an exact schema field. If the filter field is not present, return null for sql instead of ignoring the filter.
- If the user provides a literal filter value, copy that current request value into the SQL string literal exactly as the user provided it, except for normal SQL string escaping. Do not invent, translate, summarize, describe, or substitute filter values.
- If the user asks for a specific or particular entity but does not provide the required value, return null for sql instead of adding a stand-in value. Omit a missing filter only when the requested answer remains correct without it.
- Never use schema descriptions, column comments, aliases, display labels, source names, physical names, lineage names, reasoning text, or error messages as string literal data values.
- If the user asks "which", "who", or "what" for a ranked entity, select and group by the exact schema field that represents that requested entity. Do not replace the requested entity with a context field or unrelated dimension.
- Use row counting for record or entity volume questions when no numeric business measure is requested. Use numeric measures only when the question asks for a value, amount, quantity, rate, cost, or other declared measure.
- For analytical questions, return dimensions plus the requested measure expression or metric field. Do not return a raw table preview.
- For aggregate, ranking, grouped, or trend questions, produce an analytical query shape.
- For comparison questions, include each requested comparison group or time period and compute the requested difference, change, growth, or ranking when the required fields are grounded.
- Do not answer a comparison question with only one comparison side, one period, or one group unless the user explicitly asks for only that side.
- For detail-list questions, return only the fields needed to identify and describe the requested records, plus requested filters and timeframes.
- Do not answer a timeframe request with an unfiltered table scan.
- Prefer one model, view, or metric that already contains the requested fields. Do not join tables just because they were retrieved together. Do not invent join predicates from similar column names. Join only through relationships declared in DATABASE SCHEMA.
- Treat retrieved schema objects as ranked candidates for grounding, not as datasets to merge automatically. Do not combine parallel or similar retrieved models with UNION, UNION ALL, INTERSECT, or EXCEPT unless the current user explicitly asks to combine separate result sets and the retrieved DATABASE SCHEMA grounds every branch with identical result shape and compatible measures.
- If multiple retrieved schema objects are needed for the same result, use them only when the required columns and relationship path are present.
- If multiple semantic interpretations exist and the retrieved context does not make one interpretation authoritative, return null for sql instead of choosing one.
- If SQL execution or correction is needed, repair the query only when the repair can be verified using DATABASE SCHEMA, WREN SQL IDENTIFIER CONTRACT, and SQL FUNCTIONS. Never introduce a new schema object during repair.
- Return null for sql when the retrieved schema does not ground a required subject, entity, filter field, timeframe field, measure, or relationship.
- Generate Wren SQL only, using supported functions from SQL FUNCTIONS when functions are needed.
"""


_DEFAULT_TEXT_TO_SQL_RULES = """
### SQL RULES ###
- Generate exactly one SELECT statement.
- Never use "*" in the SELECT list.
- Use only Wren SQL syntax and only schema objects declared in DATABASE SCHEMA.
- Quote table and column identifiers with double quotes. Quote string literals with single quotes. Do not quote numeric literals.
- Never use SELECT *. Select only columns and expressions needed for the user's requested answer.
- Preserve the requested answer shape. For record-list requests, return the requested records with explicit identifying columns and filters; do not replace them with COUNT, DISTINCT, MAX, latest-row, ranking, or summary logic.
- Use COUNT, DISTINCT, SUM, AVG, MIN, MAX, GROUP BY, ORDER BY, LIMIT, date predicates, and joins only when the user's request requires that operation and the required identifiers are grounded in DATABASE SCHEMA.
- Do not include SQL comments.
- Use CTEs when they make multi-step SQL clearer.
- Use joins only when DATABASE SCHEMA declares the needed relationship.
- Use set operations only when the user explicitly requests combined result sets and the DATABASE SCHEMA grounds each branch. Do not use set operations to merge retrieved candidates that merely have similar dimensions or measures.
- Use declared views or metrics when they directly match the user's requested result.
- For metric-style requests, expose the requested dimensions and measure expressions or metric fields instead of returning raw table columns.
- Put aggregate expressions in SELECT or HAVING, not WHERE.
- For ranking requests, order by a selected column or selected aggregate alias and use LIMIT when the user requests a limit.
- For timeframe requests, apply a bounded predicate only when an exact date/time field and required date operation are supported by the retrieved context.
- Output aliases may label result expressions, but aliases are not source identifiers.
- Do not use connector-specific syntax such as SELECT TOP, square brackets, backticks, INTERVAL, unsupported date formatting, or unsupported statistical functions.
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
9. If the user asks for fields that require multiple schema objects, combine them only when DATABASE SCHEMA provides the exact relationship path and the result shape is grounded by the request. Retrieved schema objects are alternatives until the user request and DATABASE SCHEMA prove they must be combined. Do not use UNION, UNION ALL, INTERSECT, or EXCEPT unless the user explicitly asks to combine separate result sets and each branch is grounded with the same selected columns, compatible measure meaning, and any required grouping inside each branch.
10. Before finalizing the JSON response, YOU MUST perform a silent grounding check: every table, column, join key, filter field, grouping field, ordering field, and function in the SQL must be present in DATABASE SCHEMA or SQL FUNCTIONS. Every string literal used as a data value must be copied from the current user question or USER INSTRUCTIONS, or be a concrete date/time boundary derived directly from the user's explicit timeframe using supported SQL FUNCTIONS. If a planned element is not grounded, omit that element. If the element is needed to answer the user's requested subject, output column, filter, grouping, measure, timeframe, or relationship, return null for sql.
11. YOU MUST treat source database/schema/table names, physical datasource names, lineage names, comments, aliases, and display labels as semantic context only. Never use them as executable identifiers unless the exact same identifier appears in DATABASE SCHEMA.
12. If an identifier, literal value, placeholder, template marker, or function appears only in SQL samples, failed SQL, descriptions, lineage, reasoning text, or error messages, it is not executable for this request; ignore those parts when generating executable SQL.
13. If any planned SQL identifier cannot be copied exactly from DATABASE SCHEMA, EXECUTABLE WREN IDENTIFIER CATALOG, or WREN SQL IDENTIFIER CONTRACT, return null for sql. Never create a table or column from the user's wording.
14. If any planned SQL literal would be an unresolved variable, descriptive label, instruction to be replaced later, or placeholder value, return null for sql. The SQL field must never contain a partially completed query.
15. YOU MUST FOLLOW SQL Rules if they are not contradicted with instructions.

{text_to_sql_rules}

### FINAL ANSWER FORMAT ###
The final answer must be JSON. Return a SQL string only when it is fully grounded in DATABASE SCHEMA and SQL FUNCTIONS, contains no placeholders or template parts, and answers the user's requested intent. Do not create table or column identifiers from the user's wording. If the retrieved schema does not ground the requested subject, output column, filter, grouping, measure, timeframe, or relationship, return null for sql.

{{
    "sql": "complete executable SQL query string using only identifiers declared in DATABASE SCHEMA, or null"
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
