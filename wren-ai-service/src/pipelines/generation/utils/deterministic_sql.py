import calendar
import re
from dataclasses import dataclass
from datetime import date, timedelta

import orjson


_SEMANTIC_CONTEXT_PATTERN = re.compile(
    r"WREN RETRIEVED SEMANTIC CONTEXT\s*\n(\{.*?\})\s*\n", re.DOTALL
)
_CREATE_TABLE_PATTERN = re.compile(
    r"CREATE\s+TABLE\s+([A-Za-z_][A-Za-z0-9_]*|\"[^\"]+\")\s*\((.*?)\)",
    re.IGNORECASE | re.DOTALL,
)
_WORD_PATTERN = re.compile(r"[A-Za-z][A-Za-z0-9]*")
_IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

_STOP_TERMS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "between",
    "by",
    "from",
    "for",
    "in",
    "is",
    "most",
    "of",
    "on",
    "per",
    "show",
    "the",
    "to",
    "using",
    "what",
    "which",
    "with",
}
_DETAIL_TERMS = {"show", "list", "display", "find", "get"}
_RANKING_TERMS = {"top", "bottom", "highest", "lowest", "most", "least"}
_COUNT_TERMS = {"count", "counts", "number", "orders", "order"}
_SUM_TERMS = {
    "amount",
    "cost",
    "qty",
    "quantity",
    "revenue",
    "sales",
    "sold",
    "sum",
    "total",
    "value",
}
_VALUE_MEASURE_TERMS = {
    "amount",
    "cost",
    "qty",
    "quantity",
    "revenue",
    "sales",
    "sold",
    "value",
}
_AVG_TERMS = {"average", "avg", "mean"}
_MIN_TERMS = {"minimum", "min", "lowest"}
_MAX_TERMS = {"maximum", "max", "highest", "most"}
_MONTHS = {
    month.lower(): index for index, month in enumerate(calendar.month_name) if month
}


@dataclass(frozen=True)
class _Column:
    name: str
    data_type: str = ""
    semantic_text: str = ""
    roles: tuple[str, ...] = ()


@dataclass(frozen=True)
class _Table:
    name: str
    semantic_text: str
    columns: tuple[_Column, ...]


def generate_grounded_sql(query: str, documents: list[str]) -> str | None:
    tables = [
        table for document in documents for table in [_parse_table(document)] if table
    ]
    if not query or not tables:
        return None

    query_terms = _terms(query)
    if not query_terms:
        return None

    table = max(tables, key=lambda candidate: _table_score(candidate, query_terms))
    if _table_score(table, query_terms) <= 0:
        return None

    filters = _build_filters(query, table)
    aggregate_sql = _build_aggregate_sql(query, query_terms, table, filters)
    if aggregate_sql:
        return aggregate_sql

    return _build_detail_sql(query, query_terms, table, filters)


def _parse_table(document: str) -> _Table | None:
    context_match = _SEMANTIC_CONTEXT_PATTERN.search(document or "")
    if context_match:
        try:
            context = orjson.loads(context_match.group(1))
            contract = context.get("sql_identifier_contract") or {}
            table_name = contract.get("sql_table_name_use_exactly")
            columns = []
            allowed_columns = set(contract.get("sql_column_names_use_exactly") or [])
            for column in context.get("columns") or []:
                column_name = column.get("sql_column_name_use_exactly")
                if not column_name or (
                    allowed_columns and column_name not in allowed_columns
                ):
                    continue
                columns.append(
                    _Column(
                        name=column_name,
                        data_type=str(column.get("data_type") or ""),
                        semantic_text=str(
                            column.get("semantic_context_not_sql_identifier") or ""
                        ),
                        roles=tuple(column.get("semantic_roles_not_identifiers") or ()),
                    )
                )

            if table_name and columns:
                return _Table(
                    name=table_name,
                    semantic_text=str(
                        (context.get("semantic_context_not_sql_identifiers") or {}).get(
                            "description", ""
                        )
                    ),
                    columns=tuple(columns),
                )
        except orjson.JSONDecodeError:
            pass

    ddl_match = _CREATE_TABLE_PATTERN.search(document or "")
    if not ddl_match:
        return None

    columns = []
    for raw_column in ddl_match.group(2).split(","):
        pieces = raw_column.strip().split()
        if len(pieces) >= 2:
            columns.append(
                _Column(name=_unquote_identifier(pieces[0]), data_type=pieces[1])
            )

    if not columns:
        return None

    return _Table(
        name=_unquote_identifier(ddl_match.group(1)),
        semantic_text="",
        columns=tuple(columns),
    )


def _terms(value: str) -> set[str]:
    terms = set()
    for token in _WORD_PATTERN.findall(value or ""):
        normalized = token.lower()
        terms.add(normalized)
        if normalized.endswith("ies") and len(normalized) > 4:
            terms.add(f"{normalized[:-3]}y")
        elif normalized.endswith("s") and len(normalized) > 3:
            terms.add(normalized[:-1])
    return terms


def _identifier_terms(value: str) -> set[str]:
    spaced = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", value or "")
    spaced = spaced.replace("_", " ")
    return _terms(spaced)


def _column_terms(column: _Column) -> set[str]:
    return (
        _identifier_terms(column.name)
        | _terms(column.semantic_text)
        | {term for role in column.roles for term in _identifier_terms(role)}
    )


def _table_score(table: _Table, query_terms: set[str]) -> int:
    score = len(
        (_identifier_terms(table.name) | _terms(table.semantic_text)) & query_terms
    )
    column_scores = sorted(
        (len(_column_terms(column) & query_terms) for column in table.columns),
        reverse=True,
    )
    return score + sum(column_scores[:6])


def _is_numeric(column: _Column) -> bool:
    data_type = column.data_type.lower()
    return "numeric_measure_candidate" in column.roles or any(
        token in data_type
        for token in (
            "int",
            "decimal",
            "numeric",
            "number",
            "double",
            "float",
            "real",
            "money",
        )
    )


def _is_datetime(column: _Column) -> bool:
    data_type = column.data_type.lower()
    return "date_time_candidate" in column.roles or any(
        token in data_type for token in ("date", "time", "timestamp")
    )


def _is_dimension(column: _Column) -> bool:
    return not _is_numeric(column) and not _is_datetime(column)


def _best_columns(
    table: _Table,
    query_terms: set[str],
    predicate,
    *,
    limit: int = 3,
) -> list[_Column]:
    scored = []
    for column in table.columns:
        if not predicate(column):
            continue
        score = len(_column_terms(column) & query_terms)
        if score:
            scored.append((score, column))
    return [
        column
        for _, column in sorted(scored, key=lambda item: item[0], reverse=True)[:limit]
    ]


def _best_measure(table: _Table, query_terms: set[str]) -> _Column | None:
    measures = _best_columns(table, query_terms, _is_numeric, limit=1)
    if measures:
        return measures[0]

    numeric_columns = [column for column in table.columns if _is_numeric(column)]
    return numeric_columns[0] if numeric_columns else None


def _best_date(table: _Table, query_terms: set[str]) -> _Column | None:
    date_columns = _best_columns(table, query_terms, _is_datetime, limit=1)
    if date_columns:
        return date_columns[0]

    date_columns = [column for column in table.columns if _is_datetime(column)]
    return date_columns[0] if date_columns else None


def _query_requests_aggregate(query_terms: set[str]) -> bool:
    aggregate_terms = (
        _RANKING_TERMS | _SUM_TERMS | _AVG_TERMS | _MIN_TERMS | _MAX_TERMS
    )
    return bool(query_terms & aggregate_terms) or (
        "by" in query_terms or "per" in query_terms or "compare" in query_terms
    )


def _requested_aggregate(
    query_terms: set[str], measure: _Column | None
) -> tuple[str, str]:
    if query_terms & _AVG_TERMS:
        return "AVG", "AverageValue"
    if query_terms & _MIN_TERMS:
        return "MIN", "MinimumValue"
    if query_terms & _COUNT_TERMS and not (query_terms & _VALUE_MEASURE_TERMS):
        return "COUNT", "TotalOrders"
    if query_terms & _MAX_TERMS and measure and not (query_terms & {"most", "top"}):
        return "MAX", "MaximumValue"
    if measure:
        return "SUM", "TotalValue"
    return "COUNT", "TotalCount"


def _aggregate_dimension_terms(
    query: str, table: _Table, query_terms: set[str]
) -> set[str]:
    noise_terms = (
        _STOP_TERMS
        | _RANKING_TERMS
        | _SUM_TERMS
        | _AVG_TERMS
        | _MIN_TERMS
        | _MAX_TERMS
        | _COUNT_TERMS
        | {"compare", "generating"}
    )
    normalized = f" {query or ''} "

    for separator in (" by ", " per "):
        if separator not in normalized.lower():
            continue

        before, after = re.split(separator, normalized, maxsplit=1, flags=re.IGNORECASE)
        before_terms = _terms(before) - noise_terms
        after_terms = _terms(after) - noise_terms

        if before_terms and _best_columns(table, before_terms, _is_dimension, limit=1):
            return before_terms
        if after_terms and _best_columns(table, after_terms, _is_dimension, limit=1):
            return after_terms

    return (query_terms - noise_terms) or query_terms


def _build_aggregate_sql(
    query: str,
    query_terms: set[str],
    table: _Table,
    filters: list[str],
) -> str | None:
    if not _query_requests_aggregate(query_terms):
        return None

    dimensions = _best_columns(
        table, _aggregate_dimension_terms(query, table, query_terms), _is_dimension, limit=2
    )
    if not dimensions and not (query_terms & _COUNT_TERMS):
        return None

    measure = _best_measure(table, query_terms)
    function_name, alias = _requested_aggregate(query_terms, measure)
    if function_name == "COUNT":
        aggregate_expression = f"COUNT(*) AS {_sql_identifier(alias)}"
    elif measure:
        aggregate_expression = (
            f"{function_name}({_sql_identifier(measure.name)}) AS {_sql_identifier(alias)}"
        )
    else:
        return None

    select_items = [_sql_identifier(column.name) for column in dimensions]
    select_items.append(aggregate_expression)
    clauses = [
        "SELECT",
        "  " + ",\n  ".join(select_items),
        "FROM",
        f"  {_sql_identifier(table.name)}",
    ]
    if filters:
        clauses.extend(["WHERE", "  " + "\n  AND ".join(filters)])
    if dimensions:
        group_by = ", ".join(_sql_identifier(column.name) for column in dimensions)
        clauses.extend(["GROUP BY", f"  {group_by}"])
    if query_terms & _RANKING_TERMS or "top" in query_terms or "bottom" in query_terms:
        direction = "ASC" if query_terms & {"bottom", "lowest", "least"} else "DESC"
        clauses.extend(["ORDER BY", f"  {_sql_identifier(alias)} {direction}"])
        clauses.append(f"LIMIT {_top_limit(query)}")
    elif "top" in query_terms:
        clauses.append(f"LIMIT {_top_limit(query)}")

    return "\n".join(clauses)


def _build_detail_sql(
    query: str,
    query_terms: set[str],
    table: _Table,
    filters: list[str],
) -> str | None:
    if not filters and not (query_terms & _DETAIL_TERMS):
        return None

    selected = []
    for predicate in (_is_datetime, _is_dimension, _is_numeric):
        for column in _best_columns(table, query_terms, predicate, limit=4):
            if column.name not in {item.name for item in selected}:
                selected.append(column)

    if len(selected) < 3:
        for column in table.columns:
            if column.name not in {item.name for item in selected}:
                selected.append(column)
            if len(selected) >= 6:
                break

    selected = selected[:6]
    if not selected:
        return None

    clauses = [
        "SELECT",
        "  " + ",\n  ".join(_sql_identifier(column.name) for column in selected),
        "FROM",
        f"  {_sql_identifier(table.name)}",
    ]
    if filters:
        clauses.extend(["WHERE", "  " + "\n  AND ".join(filters)])

    date_column = _best_date(table, query_terms)
    if date_column:
        clauses.extend(["ORDER BY", f"  {_sql_identifier(date_column.name)} DESC"])
    clauses.append("LIMIT 500")
    return "\n".join(clauses)


def _build_filters(query: str, table: _Table) -> list[str]:
    query_terms = _terms(query)
    filters: list[str] = []

    date_range = _date_range(query)
    date_column = _best_date(table, query_terms)
    if date_range and date_column:
        start, end = date_range
        date_identifier = _sql_identifier(date_column.name)
        filters.append(f"{date_identifier} >= '{start.isoformat()}'")
        filters.append(f"{date_identifier} < '{end.isoformat()}'")

    literal_filter = _literal_dimension_filter(query, table)
    if literal_filter:
        filters.append(literal_filter)

    return filters


def _literal_dimension_filter(query: str, table: _Table) -> str | None:
    if _query_requests_aggregate(_terms(query)):
        return None

    query_words = _WORD_PATTERN.findall(query or "")
    lowered_words = [word.lower() for word in query_words]

    for column in table.columns:
        if not _is_dimension(column):
            continue
        column_terms = _identifier_terms(column.name)
        for index, word in enumerate(lowered_words[:-1]):
            if word not in column_terms:
                continue
            literal_words = []
            for next_word in query_words[index + 1 : index + 4]:
                normalized = next_word.lower()
                if normalized in _STOP_TERMS or normalized in _MONTHS:
                    break
                literal_words.append(next_word)
            if literal_words:
                literal = " ".join(literal_words)
                return f"{_sql_identifier(column.name)} = '{_escape_literal(literal)}'"

    return None


def _date_range(query: str, today: date | None = None) -> tuple[date, date] | None:
    current = today or date.today()
    normalized = (query or "").lower()

    if "today" in normalized:
        return current, current + timedelta(days=1)
    if "yesterday" in normalized:
        previous = current - timedelta(days=1)
        return previous, current
    if "last week" in normalized:
        return current - timedelta(days=7), current + timedelta(days=1)
    if "last month" in normalized:
        start = _add_months(date(current.year, current.month, 1), -1)
        end = date(current.year, current.month, 1)
        return start, end

    last_months = re.search(r"\blast\s+(\d{1,2})\s+months?\b", normalized)
    if last_months:
        return _add_months(current, -int(last_months.group(1))), current + timedelta(
            days=1
        )

    for month_name, month_index in _MONTHS.items():
        match = re.search(rf"\b{month_name}\s+(\d{{4}})\b", normalized)
        if match:
            start = date(int(match.group(1)), month_index, 1)
            return start, _add_months(start, 1)

    return None


def _add_months(value: date, months: int) -> date:
    month = value.month - 1 + months
    year = value.year + month // 12
    month = month % 12 + 1
    day = min(value.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def _top_limit(query: str) -> int:
    match = re.search(r"\btop\s+(\d{1,3})\b", query.lower())
    if not match:
        return 10
    return min(max(int(match.group(1)), 1), 500)


def _sql_identifier(identifier: str) -> str:
    if _IDENTIFIER_PATTERN.match(identifier):
        return identifier
    return '"' + identifier.replace('"', '""') + '"'


def _unquote_identifier(identifier: str) -> str:
    identifier = identifier.strip()
    if identifier.startswith('"') and identifier.endswith('"'):
        return identifier[1:-1].replace('""', '"')
    return identifier


def _escape_literal(value: str) -> str:
    return value.replace("'", "''")
