import logging
import re
from typing import Any, Dict, List

import aiohttp
import orjson
from haystack import component
from haystack.dataclasses import ChatMessage
from pydantic import BaseModel

from src.core.engine import (
    Engine,
    clean_generation_result,
)
from src.pipelines.retrieval.sql_knowledge import SqlKnowledge
from src.web.v1.services.ask import AskHistory

logger = logging.getLogger("wren-ai-service")


_IDENTIFIER_ATOM_PATTERN = (
    r'"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_$]*'
)
_QUALIFIED_IDENTIFIER_PATTERN = (
    rf"(?:{_IDENTIFIER_ATOM_PATTERN})(?:\s*\.\s*(?:{_IDENTIFIER_ATOM_PATTERN}))*"
)
_CREATE_TABLE_RE = re.compile(
    rf"\bCREATE\s+TABLE\s+(?P<table>{_QUALIFIED_IDENTIFIER_PATTERN})\s*\((?P<body>.*?)\n\);",
    re.IGNORECASE | re.DOTALL,
)
_CREATE_VIEW_RE = re.compile(
    rf"\bCREATE\s+VIEW\s+(?P<table>{_QUALIFIED_IDENTIFIER_PATTERN})\b",
    re.IGNORECASE,
)
_TABLE_REFERENCE_RE = re.compile(
    rf"\b(?:FROM|JOIN)\s+(?P<table>{_QUALIFIED_IDENTIFIER_PATTERN})(?:\s+(?:AS\s+)?(?P<alias>[A-Za-z_][A-Za-z0-9_$]*))?",
    re.IGNORECASE,
)
_CTE_RE = re.compile(
    rf"(?:\bWITH|,)\s+(?P<name>{_IDENTIFIER_ATOM_PATTERN})\s+AS\s*\(",
    re.IGNORECASE,
)
_QUALIFIED_COLUMN_RE = re.compile(
    rf"(?P<qualifier>{_QUALIFIED_IDENTIFIER_PATTERN})\s*\.\s*(?P<column>{_IDENTIFIER_ATOM_PATTERN})",
    re.IGNORECASE,
)
_STRING_LITERAL_RE = re.compile(r"'(?:''|[^'])*'")
_COMMENT_RE = re.compile(r"--.*?$|/\*.*?\*/", re.MULTILINE | re.DOTALL)

_SQL_STOP_WORDS = {
    "AND",
    "AS",
    "ASC",
    "BETWEEN",
    "BY",
    "CASE",
    "CAST",
    "CURRENT_DATE",
    "CURRENT_TIMESTAMP",
    "DATE",
    "DATE_TRUNC",
    "DAY",
    "DESC",
    "DISTINCT",
    "ELSE",
    "END",
    "EXISTS",
    "FALSE",
    "FROM",
    "FULL",
    "GROUP",
    "HAVING",
    "IN",
    "INNER",
    "INTERVAL",
    "IS",
    "JOIN",
    "LEFT",
    "LIKE",
    "LIMIT",
    "LOWER",
    "MONTH",
    "NOT",
    "NULL",
    "ON",
    "OR",
    "ORDER",
    "OUTER",
    "PARTITION",
    "RIGHT",
    "SELECT",
    "THEN",
    "TRUE",
    "UNION",
    "WHEN",
    "WHERE",
    "WITH",
    "YEAR",
}
_NON_COLUMN_STARTS = {
    "CONSTRAINT",
    "FOREIGN",
    "PRIMARY",
    "UNIQUE",
}


def _strip_identifier_quotes(identifier: str) -> str:
    identifier = identifier.strip()
    if (
        (identifier.startswith('"') and identifier.endswith('"'))
        or (identifier.startswith("`") and identifier.endswith("`"))
        or (identifier.startswith("[") and identifier.endswith("]"))
    ):
        return identifier[1:-1]

    return identifier


def _identifier_parts(identifier: str) -> list[str]:
    return [
        _strip_identifier_quotes(match.group(0))
        for match in re.finditer(_IDENTIFIER_ATOM_PATTERN, identifier)
    ]


def _normalize_identifier(identifier: str) -> str:
    return ".".join(_identifier_parts(identifier)).lower()


def _schema_catalog_from_contexts(
    schema_contexts: list[Any] | None,
) -> dict[str, set[str]]:
    catalog: dict[str, set[str]] = {}

    for context in schema_contexts or []:
        context = getattr(context, "content", context)
        context = "" if context is None else str(context)

        for match in _CREATE_TABLE_RE.finditer(context):
            table_name = ".".join(_identifier_parts(match.group("table")))
            columns: set[str] = set()
            for line in match.group("body").splitlines():
                stripped = line.strip().rstrip(",")
                if not stripped or stripped.startswith(("--", "/*", "*")):
                    continue

                token_match = re.match(_IDENTIFIER_ATOM_PATTERN, stripped)
                if not token_match:
                    continue

                column_name = _strip_identifier_quotes(token_match.group(0))
                if column_name.upper() in _NON_COLUMN_STARTS:
                    continue

                columns.add(column_name)

            catalog[table_name] = columns

        for match in _CREATE_VIEW_RE.finditer(context):
            table_name = ".".join(_identifier_parts(match.group("table")))
            catalog.setdefault(table_name, set())

    return catalog


def _cte_names(sql: str) -> set[str]:
    return {_normalize_identifier(match.group("name")) for match in _CTE_RE.finditer(sql)}


def _referenced_tables(
    sql: str, catalog_by_name: dict[str, str], ctes: set[str]
) -> tuple[set[str], dict[str, str | None], list[str]]:
    referenced: set[str] = set()
    qualifiers: dict[str, str | None] = {}
    unknown_tables: list[str] = []

    for match in _TABLE_REFERENCE_RE.finditer(sql):
        table_ref = match.group("table")
        normalized_ref = _normalize_identifier(table_ref)
        table_parts = _identifier_parts(table_ref)
        normalized_last_part = table_parts[-1].lower() if table_parts else ""

        if normalized_ref in ctes:
            qualifiers[normalized_ref] = None
            continue

        if normalized_ref in catalog_by_name:
            table_name = catalog_by_name[normalized_ref]
        elif len(table_parts) == 1 and normalized_last_part in catalog_by_name:
            table_name = catalog_by_name[normalized_last_part]
        else:
            unknown_tables.append(table_ref)
            continue

        referenced.add(table_name)
        qualifiers[table_name.lower()] = table_name
        qualifiers[table_parts[-1].lower()] = table_name

        alias = match.group("alias")
        if alias and alias.upper() not in _SQL_STOP_WORDS:
            qualifiers[alias.lower()] = table_name

    return referenced, qualifiers, unknown_tables


def _clause_texts(sql: str) -> list[str]:
    cleaned_sql = _COMMENT_RE.sub(" ", _STRING_LITERAL_RE.sub(" ", sql))
    clause_pattern = re.compile(
        r"\b(?:WHERE|ON|GROUP\s+BY|ORDER\s+BY|HAVING|PARTITION\s+BY)\b(?P<body>.*?)(?=\b(?:WHERE|GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|UNION|JOIN|LEFT\s+JOIN|RIGHT\s+JOIN|INNER\s+JOIN|FULL\s+JOIN)\b|$)",
        re.IGNORECASE | re.DOTALL,
    )
    return [match.group("body") for match in clause_pattern.finditer(cleaned_sql)]


def _select_aliases(sql: str) -> set[str]:
    cleaned_sql = _COMMENT_RE.sub(" ", _STRING_LITERAL_RE.sub(" ", sql))
    return {
        _normalize_identifier(match.group("alias"))
        for match in re.finditer(
            rf"\bAS\s+(?P<alias>{_IDENTIFIER_ATOM_PATTERN})\b",
            cleaned_sql,
            re.IGNORECASE,
        )
    }


def _unqualified_clause_identifiers(sql: str) -> set[str]:
    identifiers: set[str] = set()
    aliases = _select_aliases(sql)

    for clause in _clause_texts(sql):
        for match in re.finditer(_IDENTIFIER_ATOM_PATTERN, clause):
            name = _strip_identifier_quotes(match.group(0))
            upper_name = name.upper()
            if upper_name in _SQL_STOP_WORDS or name.lower() in aliases:
                continue

            previous_char = clause[match.start() - 1] if match.start() > 0 else ""
            next_char = clause[match.end()] if match.end() < len(clause) else ""
            if previous_char == "." or next_char in ".(":
                continue

            identifiers.add(name)

    return identifiers


def _format_schema_validation_error(
    unknown_tables: list[str], unknown_columns: list[str]
) -> str:
    parts = [
        "Generated SQL references identifiers that are not present in the retrieved DATABASE SCHEMA.",
    ]

    if unknown_tables:
        parts.append(f"Unknown table identifiers: {', '.join(sorted(set(unknown_tables)))}.")

    if unknown_columns:
        parts.append(f"Unknown column identifiers: {', '.join(sorted(set(unknown_columns)))}.")

    parts.append(
        "Use only exact table and column identifiers from the retrieved CREATE TABLE/CREATE VIEW statements; do not use physical schema prefixes, display labels, examples, or names from the user question unless they appear in the schema."
    )
    return " ".join(parts)


def _validate_sql_against_schema_contexts(
    sql: str, schema_contexts: list[Any] | None
) -> str | None:
    catalog = _schema_catalog_from_contexts(schema_contexts)
    if not catalog:
        return None

    catalog_by_name = {table.lower(): table for table in catalog}
    catalog_by_name.update({table.split(".")[-1].lower(): table for table in catalog})

    referenced_tables, qualifiers, unknown_tables = _referenced_tables(
        sql, catalog_by_name, _cte_names(sql)
    )

    if unknown_tables:
        return _format_schema_validation_error(unknown_tables, [])

    if not referenced_tables:
        return None

    columns_by_qualifier = {
        qualifier: {column.lower() for column in catalog[table_name]}
        for qualifier, table_name in qualifiers.items()
        if table_name in catalog
    }
    columns_in_referenced_tables = {
        column.lower()
        for table_name in referenced_tables
        for column in catalog[table_name]
    }

    unknown_columns: list[str] = []
    for match in _QUALIFIED_COLUMN_RE.finditer(sql):
        qualifier = _normalize_identifier(match.group("qualifier"))
        column = _strip_identifier_quotes(match.group("column"))
        if qualifier not in columns_by_qualifier:
            continue

        if column.lower() not in columns_by_qualifier[qualifier]:
            unknown_columns.append(f"{match.group('qualifier')}.{column}")

    has_cte_reference = any(table_name is None for table_name in qualifiers.values())
    if not has_cte_reference:
        for column in _unqualified_clause_identifiers(sql):
            if column.lower() not in columns_in_referenced_tables:
                unknown_columns.append(column)

    if unknown_columns:
        return _format_schema_validation_error([], unknown_columns)

    return None


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
        allow_dry_plan_fallback: bool = True,
        data_source: str = "",
        allow_data_preview: bool = False,
        schema_contexts: list[Any] | None = None,
    ) -> dict:
        try:
            cleaned_generation_result = clean_generation_result(replies[0])

            # test if cleaned_generation_result in string format is actually a dictionary with key 'sql'
            if cleaned_generation_result.startswith("{"):
                cleaned_generation_result = orjson.loads(cleaned_generation_result)[
                    "sql"
                ]

            schema_validation_error = _validate_sql_against_schema_contexts(
                cleaned_generation_result,
                schema_contexts,
            )
            if schema_validation_error:
                return {
                    "valid_generation_result": {},
                    "invalid_generation_result": {
                        "sql": cleaned_generation_result,
                        "original_sql": cleaned_generation_result,
                        "type": "SCHEMA_VALIDATION",
                        "error": schema_validation_error,
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
        generation_result: str,
        project_id: str | None = None,
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
                        "original_sql": generation_result,
                        "type": "TIME_OUT"
                        if error_message.startswith("Request timed out")
                        else "DRY_PLAN",
                        "error": error_message,
                        "correlation_id": "",
                    }
            elif use_dry_run:
                success, _, addition = await self._engine.execute_sql(
                    generation_result,
                    session,
                    project_id=project_id,
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
                    invalid_generation_result = {
                        "sql": addition.get("error_sql", generation_result),
                        "original_sql": generation_result,
                        "type": "TIME_OUT"
                        if error_message.startswith("Request timed out")
                        else "DRY_RUN",
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
                        "sql": addition.get("error_sql", generation_result),
                        "original_sql": generation_result,
                        "type": "TIME_OUT"
                        if error_message.startswith("Request timed out")
                        else preview_data_status,
                        "error": error_message,
                        "correlation_id": addition.get("correlation_id", ""),
                    }

        return valid_generation_result, invalid_generation_result


_DEFAULT_TEXT_TO_SQL_RULES = """
### SQL RULES ###
- ONLY USE SELECT statements, NO DELETE, UPDATE OR INSERT etc. statements that might change the data in the database.
- ONLY USE the tables and columns mentioned in the database schema.
- ONLY USE "*" if the user query asks for all the columns of a table.
- ONLY CHOOSE columns belong to the tables mentioned in the database schema.
- DON'T INCLUDE comments in the generated SQL query.
- YOU MUST USE "JOIN" if you choose columns from multiple tables!
- PREFER USING CTEs over subqueries.
- When generating SQL query, always:
    - Put double quotes around column and table names.
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
- Schema comments are metadata for understanding the data. They are not SQL syntax.
- The DATABASE SCHEMA section is the complete and only source of executable table and column identifiers.
- MUST NOT introduce, infer, copy, or repair any table or column identifier unless the exact identifier appears in the DATABASE SCHEMA.
- Do not copy identifiers from the user question, prompt examples, SQL samples, reasoning plan, previous SQL, or error messages unless the exact identifier appears in the DATABASE SCHEMA.
- Identifiers shown in prompt examples are illustrative only and are not available for generated SQL unless they also appear in the DATABASE SCHEMA.
- In schema comments, `identifier` is the executable table or column name, and `display_label`/`description` are context only.
- Never use a `display_label`, alias, or description as an executable table or column identifier.
- Use `display_label` and `description` only to understand which executable `identifier` matches the user's business term.
- When a schema comment contains an `identifier`, generated SQL must use that exact identifier for the table or column.
- Use only table and column names from the CREATE TABLE statements as identifiers in SELECT, FROM, JOIN, WHERE, GROUP BY, HAVING, ORDER BY, and expressions.
- You may use `display_label` or alias values from schema comments only after AS in the final SELECT clause.
- If the DATABASE SCHEMA does not contain the table or column needed for the user's request, do not substitute a similar, generic, or commonly known identifier.
- Only apply numeric aggregate functions such as SUM or AVG to numeric columns or measures from the DATABASE SCHEMA. If a column is not numeric in the schema, do not aggregate it directly unless the provided SQL FUNCTIONS and database dialect support the explicit cast you use.
- DON'T USE '.' in column/table alias, replace '.' with '_' in column/table alias.
- DON'T USE "FILTER(WHERE <expression>)" clause in the generated SQL query.
- DON'T USE "EXTRACT(EPOCH FROM <expression>)" clause in the generated SQL query.
- DON'T USE "EXTRACT()" function with INTERVAL data types as arguments
- DON'T USE INTERVAL or generate INTERVAL-like expression in the generated SQL query.
- DON'T USE "TO_CHAR" function in the generated SQL query.
- Aggregate functions are not allowed in the WHERE clause. Instead, they belong in the HAVING clause, which is used to filter after aggregation.
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
- ONLY USE JSON_QUERY_ARRAY for querying "json_type":"JSON_ARRAY" is identified in the comment of the column, NOT the deprecated JSON_EXTRACT_ARRAY.
    - USE UNNEST to analysis each item individually in the ARRAY. YOU MUST SELECT FROM the parent table ahead of the UNNEST ARRAY.
    - The alias of the UNNEST(ARRAY) should be in the format `unnest_table_alias(individual_item_alias)`
      - For Example: `SELECT item FROM UNNEST(ARRAY[1,2,3]) as my_unnested_table(item)`
    - If the items in the ARRAY are JSON objects, use JSON_QUERY to query the fields inside each JSON item.
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
1. Think deeply and reason about the user's question, the database schema, and the user's query history if provided.
2. Explicitly state the following information in the reasoning plan: 
if the user puts any specific timeframe(e.g. YYYY-MM-DD) in the user's question(excluding the value of the current time), you will put the absolute time frame in the SQL query; 
otherwise, you will put the relative timeframe in the SQL query.
3. For the ranking problem(e.g. "top x", "bottom x", "first x", "last x"), you must use the ranking function, `DENSE_RANK()` to rank the results and then use `WHERE` clause to filter the results.
4. For the ranking problem(e.g. "top x", "bottom x", "first x", "last x"), you must add the ranking column to the final SELECT clause.
5. If USER INSTRUCTIONS section is provided, make sure to consider them in the reasoning plan.
6. If SQL SAMPLES section is provided, make sure to consider them in the reasoning plan.
7. Give a step by step reasoning plan in order to answer user's question.
8. The reasoning plan should be in the language same as the language user provided in the input.
9. Don't include SQL in the reasoning plan.
10. Each step in the reasoning plan must start with a number, a title(in bold format in markdown), and a reasoning for the step.
11. Do not include ```markdown or ``` in the answer.
12. A table name in the reasoning plan must be in this format: `table: <table_name>`.
13. A column name in the reasoning plan must be in this format: `column: <table_name>.<column_name>`.
14. Use only table and column names that appear as identifiers in the DATABASE SCHEMA when writing `table:` and `column:` references.
15. Schema comments, display labels, aliases, and descriptions are context only. Do not use them as executable table or column names in the reasoning plan.
16. Do not create table or column names from words in the user's question. If a requested concept is available only through schema metadata, refer to the corresponding schema identifier.
17. If the DATABASE SCHEMA does not contain an identifier needed for the request, state that the schema context is insufficient instead of naming a substitute table or column.
18. ONLY SHOWING the reasoning plan in bullet points.

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
        return _extract_from_sql_knowledge(
            sql_knowledge, "text_to_sql_rule", _DEFAULT_TEXT_TO_SQL_RULES
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
    sql: str


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
    messages = []
    for history in histories:
        messages.append(
            ChatMessage.from_user(
                history.question
                if hasattr(history, "question")
                else history["question"]
            )
        )
        messages.append(
            ChatMessage.from_assistant(
                history.sql if hasattr(history, "sql") else history["sql"]
            )
        )
    return messages
