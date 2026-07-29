import logging
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
    ) -> dict:
        try:
            cleaned_generation_result = clean_generation_result(replies[0])

            # test if cleaned_generation_result in string format is actually a dictionary with key 'sql'
            if cleaned_generation_result.startswith("{"):
                cleaned_generation_result = orjson.loads(cleaned_generation_result).get(
                    "sql"
                )

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
        allow_dry_plan_fallback: bool = True,
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
                    invalid_generation_result = {
                        "sql": generation_result,
                        "original_sql": generation_result,
                        "type": "TIME_OUT"
                        if error_message.startswith("Request timed out")
                        else "DRY_PLAN",
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
                addition = addition if isinstance(addition, dict) else {}

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


_MANDATORY_SQL_GROUNDING_RULES = """
### MANDATORY SQL GROUNDING RULES ###
- Treat the DATABASE SCHEMA section as the only source of executable table and column identifiers.
- Every table and column referenced in SELECT, FROM, JOIN, WHERE, GROUP BY, HAVING, and ORDER BY must appear exactly in the CREATE TABLE, CREATE VIEW, or metric schema text provided in DATABASE SCHEMA.
- Comments, aliases, display labels, descriptions, reasoning text, SQL samples, and user wording are semantic hints only. They are never source table or source column identifiers.
- Physical datasource names, source database names, source schema names, source table names, source column names, lineage names, and names embedded inside descriptions or comments are semantic context only. Never use them as executable Wren table or column identifiers unless the exact same identifier is declared in DATABASE SCHEMA.
- Interpret the user's intent from the question wording, schema descriptions, aliases, display labels, calculated fields, metrics, and relationships, then express that intent with exact executable identifiers from DATABASE SCHEMA.
- When DATABASE SCHEMA contains WREN RETRIEVED SEMANTIC CONTEXT blocks, first use those blocks to understand each retrieved object's exact SQL identifier contract, semantic meaning, relationships, views, metrics, and calculated fields.
- When DATABASE SCHEMA contains WREN SQL IDENTIFIER CONTRACT sections, treat them as the compact authoritative list of executable identifiers for each retrieved object before reading semantic descriptions.
- In WREN RETRIEVED SEMANTIC CONTEXT, copy executable identifiers only from sql_table_name_use_exactly, sql_column_name_use_exactly, sql_column_names_use_exactly, relationship_constraints_use_exactly, or the following DDL declarations.
- In sql_column_semantic_context, each semantic_context_not_sql_identifier describes the meaning of the paired sql_column_name_use_exactly. When answering a requested business concept, use the paired sql_column_name_use_exactly for that concept.
- Values under semantic_context_not_sql_identifiers and semantic_context_not_sql_identifier are meaning only. Do not combine words, labels, ordinals, prefixes, suffixes, abbreviations, comments, or descriptions from those values into a table or column identifier.
- When a business term is represented by a column alias, display label, or description, use the corresponding real table and column name from DATABASE SCHEMA in the SQL, not the display text.
- The executable identifier is the name in the CREATE TABLE, CREATE VIEW, or metric field declaration. Do not derive executable identifiers by rewriting, translating, singularizing, pluralizing, spacing, casing, or abbreviating natural language, comments, aliases, display labels, or descriptions.
- Never generate SQL from assumptions such as "assuming the table contains", "assuming this column exists", or "a possible table/column". Use only schema-confirmed identifiers.
- Never generate placeholder identifiers, placeholder table names, or template markers in the SQL. If the retrieved metadata does not contain an executable object or column for a requested concept, use the closest executable object and column whose semantic metadata supports the intent, or omit that unsupported concept.
- If a requested concept, filter, sort, join, or time field is not represented by an exact table or column in DATABASE SCHEMA, do not invent a field for it. Generate the closest valid SQL using only available schema fields.
- When a dry run error reports an invalid object name or invalid column name, remove that identifier unless it appears exactly in DATABASE SCHEMA. Correct it only to an exact schema identifier.
- Do not replace an invalid identifier with a similar-looking physical, source, lineage, alias, display, description, sample, or error-message name. Regenerate from the user's intent and the current DATABASE SCHEMA, and omit unsupported parts instead of substituting non-schema identifiers.
- When using multiple tables to combine fields into the same output row, join only through the FOREIGN KEY relationships shown in DATABASE SCHEMA. If no relationship is shown for the needed tables, prefer a single table, view, or metric that already contains the requested fields.
- When the same requested result can be answered from multiple schema objects with compatible columns or metrics, include all relevant schema objects by combining separate result rows with UNION ALL instead of choosing only one object.
- Use UNION ALL only when each SELECT branch is independently valid from DATABASE SCHEMA and returns the same result shape. Do not use UNION ALL to combine unrelated concepts or to compensate for missing columns.
- If the question requires fields that are spread across multiple schema objects, use all required related tables, views, or metrics only when the DATABASE SCHEMA provides the needed columns and relationship path.
- Do not query INFORMATION_SCHEMA, system catalogs, metadata tables, or table-existence checks to answer the user. Query only the business tables, views, and metrics in DATABASE SCHEMA.
- SQL samples and query history are examples of intent and style only. Never copy a table name, column name, alias, literal value, or function from them unless it is also valid for the current DATABASE SCHEMA and SQL FUNCTIONS.
- Generate Wren SQL only. Do not use warehouse-specific functions unless they are explicitly listed in SQL FUNCTIONS for this request.
- Apply relative date or time filters only when DATABASE SCHEMA contains an exact date/time field for the requested time concept and SQL FUNCTIONS contains the exact date/time operation needed. Do not compare text fields to date functions.
- Treat reasoning plans, correction notes, and error messages as non-executable context. Never copy SQL fragments, inferred identifiers, placeholder names, template markers, literal values, or unsupported functions from them.
- If a column comment, alias, display label, or description names a business concept, first locate the exact declared source column for that concept in DATABASE SCHEMA. If no exact declared source column exists, omit that concept.
- For aggregate sorting, select the aggregate with an alias and order by that alias instead of ordering directly by an aggregate expression.
- Before returning the final SQL, silently check that each identifier and function in the SQL is grounded in DATABASE SCHEMA or SQL FUNCTIONS. If any identifier or function is ungrounded, remove that part or answer with the closest valid SQL over grounded fields only.
- If the retrieved DATABASE SCHEMA does not contain a table, column, relationship, or supported function needed for part of the user's request, leave that part out instead of inventing a replacement.
- If a requested noun, grouping, filter, or measure appears only in the user's wording and not in DATABASE SCHEMA, do not translate it into a generic object name. Use only schema-supported concepts and omit unsupported parts.
"""


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
    - Use Wren SQL identifier quoting with double quotes only; the engine rewrite step converts grounded Wren SQL to the active connector dialect.
    - Put single quotes around string literals.
    - Never quote numeric literals.
- For case-insensitive comparisons, use only functions or operators that are supported by SQL FUNCTIONS for this request. If SQL FUNCTIONS does not provide a safe case-insensitive function, use a normal equality or LIKE comparison on an exact schema column.
- For date/time questions, first choose an exact schema column whose type or metadata clearly represents the requested time concept. Use only date/time functions and casts whose exact syntax is provided in SQL FUNCTIONS for this request.
- If the question asks for a specific or relative date, generate a bounded date/time filter only when both the exact date/time schema column and required SQL FUNCTIONS-supported operation are available. If either is missing, do not invent a field or function.
- USE THE VIEW TO SIMPLIFY THE QUERY.
- DON'T MISUSE THE VIEW NAME. THE ACTUAL NAME IS FOLLOWING THE CREATE VIEW STATEMENT.
- Output aliases may be used only to name expressions in the final SELECT list. Output aliases are labels for result columns only; they are not source identifiers.
- Comments, aliases, display labels, and descriptions from DATABASE SCHEMA may guide which exact source column to select, but they must not be copied into FROM, JOIN, WHERE, GROUP BY, HAVING, or ORDER BY as table or column names.
- Physical/source/lineage names from metadata may guide meaning, but generated SQL must use only the declared Wren model, view, metric, and column identifiers from DATABASE SCHEMA.
- DON'T USE '.' in output aliases, replace '.' with '_' in output aliases.
- DON'T USE "FILTER(WHERE <expression>)" clause in the generated SQL query.
- DON'T USE "EXTRACT(EPOCH FROM <expression>)" clause in the generated SQL query.
- DON'T USE "EXTRACT()" function with INTERVAL data types as arguments
- DON'T USE INTERVAL or generate INTERVAL-like expression in the generated SQL query.
- DON'T USE "TO_CHAR" function in the generated SQL query.
- DON'T USE unsupported statistical, date/time, or formatting functions. If SQL FUNCTIONS does not list a function needed by the intent, answer with the closest supported aggregation/filter over exact schema fields.
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
7. YOU MUST treat sql_column_semantic_context entries as column meaning mappings: semantic_context_not_sql_identifier explains the paired sql_column_name_use_exactly. Use that paired exact column when it represents the requested business concept.
8. If the user asks for fields that exist across multiple related schema objects, include those objects only when DATABASE SCHEMA shows the exact columns and relationship path needed to join them.
9. If the user asks for a result that is represented in multiple schema objects with compatible fields, include all relevant objects using independently valid SELECT branches combined with UNION ALL. Use joins only for relationship-backed row-level combinations.
10. Before finalizing the JSON response, YOU MUST perform a silent grounding check: every table, column, join key, filter field, grouping field, ordering field, and function in the SQL must be present in DATABASE SCHEMA or SQL FUNCTIONS. If a planned element is not grounded, omit that element or use the closest grounded expression.
11. YOU MUST treat source database/schema/table names, physical datasource names, lineage names, comments, aliases, and display labels as semantic context only. Never use them as executable identifiers unless the exact same identifier appears in DATABASE SCHEMA.
12. If an identifier, literal value, placeholder, template marker, or function appears only in SQL samples, failed SQL, descriptions, lineage, reasoning text, or error messages, it is not executable for this request; ignore those parts when generating executable SQL.
13. YOU MUST FOLLOW SQL Rules if they are not contradicted with instructions.

{text_to_sql_rules}

### FINAL ANSWER FORMAT ###
The final answer must be JSON. Return a SQL string only when it is fully grounded in DATABASE SCHEMA and SQL FUNCTIONS. If no fully grounded SQL can be generated, return null for sql.

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
