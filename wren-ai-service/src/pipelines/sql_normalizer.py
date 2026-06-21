import re
from datetime import datetime, timedelta


def normalize_data_source(data_source: str | None) -> str:
    normalized = (data_source or "").strip().upper().replace("-", "_").replace(
        " ", "_"
    )
    if normalized in {"SQLSERVER", "SQL_SERVER", "MS_SQL", "MSSQLSERVER"}:
        return "MSSQL"
    return normalized


def _format_timestamp_literal(value: datetime) -> str:
    return value.strftime("'%Y-%m-%d %H:%M:%S'")


def _add_months(value: datetime, months: int) -> datetime:
    month_index = value.month - 1 + months
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    day = min(
        value.day,
        [
            31,
            29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28,
            31,
            30,
            31,
            30,
            31,
            31,
            30,
            31,
            30,
            31,
        ][month - 1],
    )
    return value.replace(year=year, month=month, day=day)


def _start_of_month(value: datetime) -> datetime:
    return value.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _replace_relative_getdate_calls(sql: str, now: datetime) -> str:
    def replace_month_offset(match: re.Match[str]) -> str:
        months = int(match.group(1))
        return _format_timestamp_literal(_add_months(now, months))

    def replace_year_offset(match: re.Match[str]) -> str:
        years = int(match.group(1))
        return _format_timestamp_literal(_add_months(now, years * 12))

    def replace_day_offset(match: re.Match[str]) -> str:
        days = int(match.group(1))
        return _format_timestamp_literal(now + timedelta(days=days))

    sql = re.sub(
        r"DATEADD\(\s*month\s*,\s*([+-]?\d+)\s*,\s*GETDATE\(\)\s*\)",
        replace_month_offset,
        sql,
        flags=re.IGNORECASE,
    )
    sql = re.sub(
        r"DATEADD\(\s*year\s*,\s*([+-]?\d+)\s*,\s*GETDATE\(\)\s*\)",
        replace_year_offset,
        sql,
        flags=re.IGNORECASE,
    )
    sql = re.sub(
        r"DATEADD\(\s*day\s*,\s*([+-]?\d+)\s*,\s*GETDATE\(\)\s*\)",
        replace_day_offset,
        sql,
        flags=re.IGNORECASE,
    )

    current_month_start = _format_timestamp_literal(_start_of_month(now))
    previous_month_start = _format_timestamp_literal(
        _start_of_month(_add_months(now, -1))
    )
    sql = re.sub(
        r"DATEADD\(\s*month\s*,\s*DATEDIFF\(\s*month\s*,\s*0\s*,\s*GETDATE\(\)\s*\)\s*,\s*0\s*\)",
        current_month_start,
        sql,
        flags=re.IGNORECASE,
    )
    sql = re.sub(
        r"DATEADD\(\s*month\s*,\s*DATEDIFF\(\s*month\s*,\s*0\s*,\s*GETDATE\(\)\s*\)\s*-\s*1\s*,\s*0\s*\)",
        previous_month_start,
        sql,
        flags=re.IGNORECASE,
    )
    return sql


def _rewrite_mssql_bucket_functions(sql: str) -> str:
    expression_pattern = r"((?:[^(),]|\([^()]*\))+?)"

    sql = re.sub(
        rf"DATEADD\(\s*month\s*,\s*DATEDIFF\(\s*month\s*,\s*0\s*,\s*{expression_pattern}\s*\)\s*,\s*0\s*\)",
        lambda m: (
            f"(EXTRACT(YEAR FROM {m.group(1)}) * 100 + EXTRACT(MONTH FROM {m.group(1)}))"
        ),
        sql,
        flags=re.IGNORECASE,
    )
    sql = re.sub(
        rf"DATEADD\(\s*year\s*,\s*DATEDIFF\(\s*year\s*,\s*0\s*,\s*{expression_pattern}\s*\)\s*,\s*0\s*\)",
        lambda m: f"EXTRACT(YEAR FROM {m.group(1)})",
        sql,
        flags=re.IGNORECASE,
    )
    return sql


def _rewrite_temporal_bucket_functions(sql: str) -> str:
    expression_pattern = r"((?:[^(),]|\([^()]*\))+?)"
    replacements = [
        (
            re.compile(
                rf"DATEPART\(\s*YEAR\s*,\s*{expression_pattern}\s*\)",
                re.IGNORECASE,
            ),
            lambda m: f"EXTRACT(YEAR FROM {m.group(1)})",
        ),
        (
            re.compile(
                rf"DATEPART\(\s*MONTH\s*,\s*{expression_pattern}\s*\)",
                re.IGNORECASE,
            ),
            lambda m: f"EXTRACT(MONTH FROM {m.group(1)})",
        ),
        (
            re.compile(
                rf"DATEPART\(\s*DAY\s*,\s*{expression_pattern}\s*\)",
                re.IGNORECASE,
            ),
            lambda m: f"EXTRACT(DAY FROM {m.group(1)})",
        ),
        (
            re.compile(rf"YEAR\(\s*{expression_pattern}\s*\)", re.IGNORECASE),
            lambda m: f"EXTRACT(YEAR FROM {m.group(1)})",
        ),
        (
            re.compile(rf"MONTH\(\s*{expression_pattern}\s*\)", re.IGNORECASE),
            lambda m: f"EXTRACT(MONTH FROM {m.group(1)})",
        ),
        (
            re.compile(rf"DAY\(\s*{expression_pattern}\s*\)", re.IGNORECASE),
            lambda m: f"EXTRACT(DAY FROM {m.group(1)})",
        ),
        (
            re.compile(
                rf"DATETRUNC\(\s*MONTH\s*,\s*{expression_pattern}\s*\)",
                re.IGNORECASE,
            ),
            lambda m: f"EXTRACT(MONTH FROM {m.group(1)})",
        ),
        (
            re.compile(
                rf"DATETRUNC\(\s*YEAR\s*,\s*{expression_pattern}\s*\)",
                re.IGNORECASE,
            ),
            lambda m: f"EXTRACT(YEAR FROM {m.group(1)})",
        ),
        (
            re.compile(
                rf"DATE_TRUNC\(\s*'?\s*MONTH\s*'?\s*,\s*{expression_pattern}\s*\)",
                re.IGNORECASE,
            ),
            lambda m: f"EXTRACT(MONTH FROM {m.group(1)})",
        ),
        (
            re.compile(
                rf"DATE_TRUNC\(\s*'?\s*YEAR\s*'?\s*,\s*{expression_pattern}\s*\)",
                re.IGNORECASE,
            ),
            lambda m: f"EXTRACT(YEAR FROM {m.group(1)})",
        ),
        (
            re.compile(
                rf"DATE_PART\(\s*'?\s*YEAR\s*'?\s*,\s*{expression_pattern}\s*\)",
                re.IGNORECASE,
            ),
            lambda m: f"EXTRACT(YEAR FROM {m.group(1)})",
        ),
        (
            re.compile(
                rf"DATE_PART\(\s*'?\s*MONTH\s*'?\s*,\s*{expression_pattern}\s*\)",
                re.IGNORECASE,
            ),
            lambda m: f"EXTRACT(MONTH FROM {m.group(1)})",
        ),
        (
            re.compile(
                rf"DATE_PART\(\s*'?\s*DAY\s*'?\s*,\s*{expression_pattern}\s*\)",
                re.IGNORECASE,
            ),
            lambda m: f"EXTRACT(DAY FROM {m.group(1)})",
        ),
        (
            re.compile(
                rf"EXTRACT\(\s*YEAR\s+FROM\s+{expression_pattern}\s*\)",
                re.IGNORECASE,
            ),
            lambda m: f"EXTRACT(YEAR FROM {m.group(1)})",
        ),
        (
            re.compile(
                rf"EXTRACT\(\s*MONTH\s+FROM\s+{expression_pattern}\s*\)",
                re.IGNORECASE,
            ),
            lambda m: f"EXTRACT(MONTH FROM {m.group(1)})",
        ),
        (
            re.compile(
                rf"EXTRACT\(\s*DAY\s+FROM\s+{expression_pattern}\s*\)",
                re.IGNORECASE,
            ),
            lambda m: f"EXTRACT(DAY FROM {m.group(1)})",
        ),
        (
            re.compile(
                rf"DATEPART\(\s*'YEAR'\s*,\s*{expression_pattern}\s*\)",
                re.IGNORECASE,
            ),
            lambda m: f"EXTRACT(YEAR FROM {m.group(1)})",
        ),
        (
            re.compile(
                rf"DATEPART\(\s*'MONTH'\s*,\s*{expression_pattern}\s*\)",
                re.IGNORECASE,
            ),
            lambda m: f"EXTRACT(MONTH FROM {m.group(1)})",
        ),
        (
            re.compile(
                rf"DATEPART\(\s*'DAY'\s*,\s*{expression_pattern}\s*\)",
                re.IGNORECASE,
            ),
            lambda m: f"EXTRACT(DAY FROM {m.group(1)})",
        ),
    ]

    rewritten = sql
    for pattern, replacement in replacements:
        rewritten = pattern.sub(replacement, rewritten)

    return rewritten


def _rewrite_mssql_timestamp_casts(sql: str) -> str:
    expression_pattern = r"((?:[^(),]|\([^()]*\))+?)"
    timestamp_function_pattern = re.compile(
        rf"\bTO_TIMESTAMP(?:_(?:MILLIS|SECONDS|MICROS|NANOS))?\(\s*{expression_pattern}\s*\)",
        re.IGNORECASE,
    )
    timestamp_cast_pattern = re.compile(
        r"CAST\(\s*((?:[^()]|\([^()]*\))+?)\s+AS\s+TIMESTAMP\s*\)",
        re.IGNORECASE,
    )

    rewritten = timestamp_function_pattern.sub(
        lambda m: f"CAST({m.group(1)} AS DATETIME)", sql
    )
    rewritten = timestamp_cast_pattern.sub(
        lambda m: f"CAST({m.group(1)} AS DATETIME)", rewritten
    )
    return rewritten


def _rewrite_mssql_to_unixtime(sql: str) -> str:
    expression_pattern = r"((?:[^(),]|\([^()]*\))+?)"
    to_unixtime_pattern = re.compile(
        rf"\bTO_UNIXTIME\(\s*{expression_pattern}\s*\)",
        re.IGNORECASE,
    )

    return to_unixtime_pattern.sub(lambda m: m.group(1), sql)


def _rewrite_mssql_timestamp_subtraction(sql: str) -> str:
    expression_pattern = r"((?:[^(),+\-]|\([^()]*\))+?)"
    timestamp_subtraction_pattern = re.compile(
        rf"{expression_pattern}\s*-\s*{expression_pattern}\s+AS\s+(\"[^\"]+\")",
        re.IGNORECASE,
    )

    def replace_subtraction(match: re.Match[str]) -> str:
        left = match.group(1).strip()
        right = match.group(2).strip()
        alias = match.group(3)
        alias_text = str(alias or "").strip('"').lower()

        if not any(token in alias_text for token in ("duration", "turnaround")):
            return match.group(0)

        return f"DATEDIFF('second', {right}, {left}) AS {alias}"

    return timestamp_subtraction_pattern.sub(replace_subtraction, sql)


def _infer_mssql_timestamp_expression(sql: str) -> str | None:
    timestamp_column_pattern = re.compile(
        r'(?:(?:"[^"]+"\.)?"(?:created_at|updated_at|generated_at|opened_at|closed_at|completed_at|resolved_at)")',
        re.IGNORECASE,
    )
    if match := timestamp_column_pattern.search(sql):
        return match.group(0)

    table_pattern = re.compile(
        r'\bFROM\s+("[^"]+"|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)',
        re.IGNORECASE,
    )
    if match := table_pattern.search(sql):
        table_name = match.group(1)
        normalized_table_name = str(table_name or "").strip('"[]').lower()
        if "report" in normalized_table_name:
            return f'{table_name}."generated_at"'
        if any(
            token in normalized_table_name
            for token in ("repair", "ticket", "debug", "event", "log")
        ):
            return f'{table_name}."created_at"'

    return None


def _rewrite_mssql_invented_date_identifiers(sql: str) -> str:
    timestamp_expression = _infer_mssql_timestamp_expression(sql)
    if not timestamp_expression:
        return sql

    invented_date_identifier_pattern = re.compile(
        r'(?<!\.)"(?:RepairDate|repair_date|repairDate|date|month_date|event_date)"',
        re.IGNORECASE,
    )
    return invented_date_identifier_pattern.sub(timestamp_expression, sql)


def _rewrite_mssql_bare_time_bucket_identifiers(sql: str) -> str:
    timestamp_expression = _infer_mssql_timestamp_expression(sql)
    if not timestamp_expression:
        return sql

    bucket_expressions = {
        "year": f"EXTRACT(YEAR FROM {timestamp_expression})",
        "month": f"EXTRACT(MONTH FROM {timestamp_expression})",
        "day": f"EXTRACT(DAY FROM {timestamp_expression})",
    }
    rewritten = sql

    for bucket, expression in bucket_expressions.items():
        select_identifier_pattern = re.compile(
            rf'(?P<prefix>\bSELECT\s+|,\s*)"{bucket}"(?P<suffix>\s*(?:,|\bFROM\b))',
            re.IGNORECASE,
        )

        def replace_select_identifier(match: re.Match[str]) -> str:
            prefix = match.group("prefix")
            suffix = match.group("suffix")
            return f'{prefix}{expression} AS "{bucket}"{suffix}'

        rewritten = select_identifier_pattern.sub(
            replace_select_identifier, rewritten
        )

    clause_pattern = re.compile(
        r"\b(GROUP\s+BY|ORDER\s+BY|HAVING)\b(?P<body>.*?)(?=\b(?:ORDER\s+BY|GROUP\s+BY|HAVING|LIMIT|OFFSET|FETCH|UNION|WHERE)\b|$)",
        re.IGNORECASE | re.DOTALL,
    )

    def replace_clause(match: re.Match[str]) -> str:
        body = match.group("body")
        for bucket, expression in bucket_expressions.items():
            body = re.sub(
                rf'"{bucket}"',
                expression,
                body,
                flags=re.IGNORECASE,
            )
            body = re.sub(
                rf"\[{bucket}\]",
                expression,
                body,
                flags=re.IGNORECASE,
            )
        return f"{match.group(1)}{body}"

    return clause_pattern.sub(replace_clause, rewritten)


def _rewrite_mssql_invented_failure_category(sql: str) -> str:
    if not re.search(r"\bdbo_repair_logs\b", sql, flags=re.IGNORECASE):
        return sql
    if not re.search(r"\bfailure[_\s]+category\b", sql, flags=re.IGNORECASE):
        return sql

    failure_code_expression = '"dbo_repair_logs"."failure_code"'
    rewritten = re.sub(
        r'(?P<prefix>\bSELECT\s+|,\s*)(?:(?:"dbo_repair_logs"|\[dbo_repair_logs\]|dbo_repair_logs)\s*\.\s*)?(?:"failure[_\s]+category"|\[failure[_\s]+category\]|failure[_\s]+category)(?P<suffix>\s*(?:,|\bFROM\b))',
        rf'\g<prefix>{failure_code_expression} AS "failure_category"\g<suffix>',
        sql,
        flags=re.IGNORECASE,
    )
    rewritten = re.sub(
        r"\bAS\s+failure\s+category\b",
        'AS "failure_category"',
        rewritten,
        flags=re.IGNORECASE,
    )

    clause_pattern = re.compile(
        r"\b(GROUP\s+BY|ORDER\s+BY|HAVING)\b(?P<body>.*?)(?=\b(?:ORDER\s+BY|GROUP\s+BY|HAVING|LIMIT|OFFSET|FETCH|UNION|WHERE)\b|$)",
        re.IGNORECASE | re.DOTALL,
    )

    def replace_clause(match: re.Match[str]) -> str:
        body = re.sub(
            r'(?:(?:"dbo_repair_logs"|\[dbo_repair_logs\]|dbo_repair_logs)\s*\.\s*)?(?:"failure[_\s]+category"|\[failure[_\s]+category\]|failure[_\s]+category)',
            failure_code_expression,
            match.group("body"),
            flags=re.IGNORECASE,
        )
        return f"{match.group(1)}{body}"

    return clause_pattern.sub(replace_clause, rewritten)


def _rewrite_mssql_datepart_alias_references(sql: str) -> str:
    datepart_alias_pattern = re.compile(
        r"\b((?:DATEPART\(\s*'?\s*(?:YEAR|MONTH|DAY)\s*'?\s*,\s*((?:[^()]|\([^()]*\))+?)\s*\)|(?:YEAR|MONTH|DAY)\(\s*((?:[^()]|\([^()]*\))+?)\s*\)|EXTRACT\(\s*(?:YEAR|MONTH|DAY)\s+FROM\s+((?:[^()]|\([^()]*\))+?)\s*\)))\s+AS\s+(?:\"([^\"]+)\"|\[([^\]]+)\]|([A-Za-z_][A-Za-z0-9_]*))",
        re.IGNORECASE,
    )
    aliases: dict[str, str] = {}

    for match in datepart_alias_pattern.finditer(sql):
        expression = match.group(1)
        alias = match.group(5) or match.group(6) or match.group(7)
        if alias:
            aliases[str(alias).lower()] = expression

    if not aliases:
        return sql

    clause_pattern = re.compile(
        r"\b(GROUP\s+BY|ORDER\s+BY|HAVING)\b(?P<body>.*?)(?=\b(?:ORDER\s+BY|GROUP\s+BY|HAVING|LIMIT|OFFSET|FETCH|UNION|WHERE)\b|$)",
        re.IGNORECASE | re.DOTALL,
    )

    def replace_clause(match: re.Match) -> str:
        body = match.group("body")
        placeholders: dict[str, str] = {}
        for alias, expression in aliases.items():
            placeholder = f"__WREN_MSSQL_DATEPART_ALIAS_{len(placeholders)}__"
            placeholders[placeholder] = expression
            body = re.sub(
                rf'"{re.escape(alias)}"',
                placeholder,
                body,
                flags=re.IGNORECASE,
            )
            body = re.sub(
                rf"\[{re.escape(alias)}\]",
                placeholder,
                body,
                flags=re.IGNORECASE,
            )
            body = re.sub(
                rf"(?<![A-Za-z_\(])\b{re.escape(alias)}\b(?!\s*\()",
                placeholder,
                body,
                flags=re.IGNORECASE,
            )
        for placeholder, expression in placeholders.items():
            body = body.replace(placeholder, expression)
        return f"{match.group(1)}{body}"

    return clause_pattern.sub(replace_clause, sql)


def normalize_generation_result_sql(sql: str, data_source: str | None = None) -> str:
    normalized = sql

    if normalize_data_source(data_source) == "MSSQL":
        now = datetime.now()
        normalized = re.sub(
            r"\s+NULLS\s+(?:LAST|FIRST)\b", "", normalized, flags=re.IGNORECASE
        )
        normalized = re.sub(
            r"CAST\(\s*('(?:[^']|'')*')\s+AS\s+DATETIME(?:2|OFFSET)\s*\)",
            r"\1",
            normalized,
            flags=re.IGNORECASE,
        )
        normalized = _replace_relative_getdate_calls(normalized, now)
        normalized = re.sub(
            r"\bAS\s+failure\s+category\b",
            'AS "failure_category"',
            normalized,
            flags=re.IGNORECASE,
        )
        normalized = _rewrite_mssql_to_unixtime(normalized)
        normalized = _rewrite_mssql_timestamp_subtraction(normalized)
        normalized = _rewrite_mssql_timestamp_casts(normalized)
        normalized = _rewrite_mssql_invented_date_identifiers(normalized)
        normalized = _rewrite_mssql_invented_failure_category(normalized)
        normalized = _rewrite_mssql_bare_time_bucket_identifiers(normalized)
        normalized = _rewrite_mssql_bucket_functions(normalized)
        normalized = _rewrite_temporal_bucket_functions(normalized)
        normalized = _rewrite_mssql_datepart_alias_references(normalized)

    return re.sub(r"\s+", " ", normalized).strip()
