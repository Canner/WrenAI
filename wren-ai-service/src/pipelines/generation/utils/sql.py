import asyncio
import logging
from typing import Any, Dict, List, Optional

import aiohttp
import orjson
from haystack import component

from src.core.engine import (
    Engine,
    add_quotes,
    clean_generation_result,
)
from src.web.v1.services import Configuration

logger = logging.getLogger("wren-ai-service")


@component
class SQLBreakdownGenPostProcessor:
    def __init__(self, engine: Engine):
        self._engine = engine

    @component.output_types(
        results=Optional[Dict[str, Any]],
    )
    async def run(
        self,
        replies: List[str],
        project_id: str | None = None,
    ) -> Dict[str, Any]:
        cleaned_generation_result = orjson.loads(clean_generation_result(replies[0]))

        steps = cleaned_generation_result.get("steps", [])
        if not steps:
            return {
                "results": {
                    "description": cleaned_generation_result["description"],
                    "steps": [],
                },
            }

        # make sure the last step has an empty cte_name
        steps[-1]["cte_name"] = ""

        for step in steps:
            step["sql"], no_error = add_quotes(step["sql"])
            if not no_error:
                return {
                    "results": {
                        "description": cleaned_generation_result["description"],
                        "steps": [],
                    },
                }

        sql = self._build_cte_query(steps)

        if not await self._check_if_sql_executable(sql, project_id=project_id):
            return {
                "results": {
                    "description": cleaned_generation_result["description"],
                    "steps": [],
                },
            }

        return {
            "results": {
                "description": cleaned_generation_result["description"],
                "steps": steps,
            },
        }

    def _build_cte_query(self, steps) -> str:
        ctes = ",\n".join(
            f"{step['cte_name']} AS ({step['sql']})"
            for step in steps
            if step["cte_name"]
        )

        return f"WITH {ctes}\n" + steps[-1]["sql"] if ctes else steps[-1]["sql"]

    async def _check_if_sql_executable(
        self,
        sql: str,
        project_id: str | None = None,
    ):
        async with aiohttp.ClientSession() as session:
            status, _, addition = await self._engine.execute_sql(
                sql,
                session,
                project_id=project_id,
            )

        if not status:
            logger.exception(
                f"SQL is not executable: {addition.get('error_message', '')}"
            )

        return status


@component
class SQLGenPostProcessor:
    def __init__(self, engine: Engine):
        self._engine = engine

    @component.output_types(
        valid_generation_results=List[Optional[Dict[str, Any]]],
        invalid_generation_results=List[Optional[Dict[str, Any]]],
    )
    async def run(
        self,
        replies: List[str] | List[List[str]],
        project_id: str | None = None,
    ) -> dict:
        try:
            if isinstance(replies[0], dict):
                cleaned_generation_result = []
                for reply in replies:
                    try:
                        cleaned_generation_result.append(
                            orjson.loads(clean_generation_result(reply["replies"][0]))[
                                "results"
                            ][0]
                        )
                    except Exception as e:
                        logger.exception(f"Error in SQLGenPostProcessor: {e}")
            else:
                cleaned_generation_result = orjson.loads(
                    clean_generation_result(replies[0])
                )["results"]

            if isinstance(cleaned_generation_result, dict):
                cleaned_generation_result = [cleaned_generation_result]

            (
                valid_generation_results,
                invalid_generation_results,
            ) = await self._classify_invalid_generation_results(
                cleaned_generation_result, project_id=project_id
            )

            return {
                "valid_generation_results": valid_generation_results,
                "invalid_generation_results": invalid_generation_results,
            }
        except Exception as e:
            logger.exception(f"Error in SQLGenPostProcessor: {e}")

            return {
                "valid_generation_results": [],
                "invalid_generation_results": [],
            }

    async def _classify_invalid_generation_results(
        self, generation_results: List[Dict[str, str]], project_id: str | None = None
    ) -> List[Optional[Dict[str, str]]]:
        valid_generation_results = []
        invalid_generation_results = []

        async def _task(result: Dict[str, str]):
            quoted_sql, no_error = add_quotes(result["sql"])

            if no_error:
                status, _, addition = await self._engine.execute_sql(
                    quoted_sql, session, project_id=project_id
                )

                if status:
                    valid_generation_results.append(
                        {
                            "sql": quoted_sql,
                            "correlation_id": addition.get("correlation_id", ""),
                        }
                    )
                else:
                    invalid_generation_results.append(
                        {
                            "sql": quoted_sql,
                            "type": "DRY_RUN",
                            "error": addition.get("error_message", ""),
                            "correlation_id": addition.get("correlation_id", ""),
                        }
                    )
            else:
                invalid_generation_results.append(
                    {
                        "sql": result["sql"],
                        "type": "ADD_QUOTES",
                        "error": "add_quotes failed",
                    }
                )

        async with aiohttp.ClientSession() as session:
            tasks = [
                _task(generation_result) for generation_result in generation_results
            ]
            await asyncio.gather(*tasks)

        return valid_generation_results, invalid_generation_results


TEXT_TO_SQL_RULES = """
### ALERT ###
- ONLY USE SELECT statements, NO DELETE, UPDATE OR INSERT etc. statements that might change the data in the database.
- ONLY USE the tables and columns mentioned in the database schema.
- ONLY USE "*" if the user query asks for all the columns of a table.
- ONLY CHOOSE columns belong to the tables mentioned in the database schema.
- YOU MUST USE "JOIN" if you choose columns from multiple tables!
- ALWAYS QUALIFY column names with their table name or table alias to avoid ambiguity (e.g., orders.OrderId, o.OrderId)
- YOU MUST USE "lower(<table_name>.<column_name>) like lower(<value>)" function or "lower(<table_name>.<column_name>) = lower(<value>)" function for case-insensitive comparison!
    - Use "lower(<table_name>.<column_name>) LIKE lower(<value>)" when:
        - The user requests a pattern or partial match.
        - The value is not specific enough to be a single, exact value.
        - Wildcards (%) are needed to capture the pattern.
    - Use "lower(<table_name>.<column_name>) = lower(<value>)" when:
        - The user requests an exact, specific value.
        - There is no ambiguity or pattern in the value.
- ALWAYS CAST the date/time related field to "TIMESTAMP WITH TIME ZONE" type when using them in the query
    - example 1: CAST(properties_closedate AS TIMESTAMP WITH TIME ZONE)
    - example 2: CAST('2024-11-09 00:00:00' AS TIMESTAMP WITH TIME ZONE)
    - example 3: CAST(DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month') AS TIMESTAMP WITH TIME ZONE)
- If the user asks for a specific date, please give the date range in SQL query
    - example: "What is the total revenue for the month of 2024-11-01?"
    - answer: "SELECT SUM(r.PriceSum) FROM Revenue r WHERE CAST(r.PurchaseTimestamp AS TIMESTAMP WITH TIME ZONE) >= CAST('2024-11-01 00:00:00' AS TIMESTAMP WITH TIME ZONE) AND CAST(r.PurchaseTimestamp AS TIMESTAMP WITH TIME ZONE) < CAST('2024-11-02 00:00:00' AS TIMESTAMP WITH TIME ZONE)"
- ALWAYS ADD "timestamp" to the front of the timestamp literal, ex. "timestamp '2024-02-20 12:00:00'"
- USE THE VIEW TO SIMPLIFY THE QUERY.
- DON'T MISUSE THE VIEW NAME. THE ACTUAL NAME IS FOLLOWING THE CREATE VIEW STATEMENT.
- MUST USE the value of alias from the comment section of the corresponding table or column in the DATABASE SCHEMA section for the column/table alias.
  - EXAMPLE
    DATABASE SCHEMA
    /* {"displayName":"_orders","description":"A model representing the orders data."} */
    CREATE TABLE orders (
      -- {"description":"A column that represents the timestamp when the order was approved.","alias":"_timestamp"}
      ApprovedTimestamp TIMESTAMP
    }

    SQL
    SELECT _orders.ApprovedTimestamp AS _timestamp FROM orders AS _orders;
- DON'T USE '.' in column/table alias, replace '.' with '_' in column/table alias.
- DON'T USE "FILTER(WHERE <condition>)" clause in the query.
- DON'T USE "EXTRACT(EPOCH FROM <timestamp_column>)" clause in the query.
- ONLY USE the following SQL functions if you need to when generating answers:
  - Aggregation functions:
    - AVG
    - COUNT
    - MAX
    - MIN
    - SUM
    - ARRAY_AGG
    - BOOL_OR
  - Math functions:
    - ABS
    - CBRT
    - CEIL
    - EXP
    - FLOOR
    - LN
    - ROUND
    - SIGN
    - GREATEST
    - LEAST
    - MOD
    - POWER
  - String functions:
    - LENGTH
    - REVERSE
    - CHR
    - CONCAT
    - FORMAT
    - LOWER
    - LPAD
    - LTRIM
    - POSITION
    - REPLACE
    - RPAD
    - RTRIM
    - STRPOS
    - SUBSTR
    - SUBSTRING
    - TRANSLATE
    - TRIM
    - UPPER
  - Date and Time functions:
    - CURRENT_DATE
    - DATE_TRUNC
    - EXTRACT
  - operators:
    - `+`
    - `-`
    - `*`
    - `/`
    - `||`
    - `<`
    - `>`
    - `>=`
    - `<=`
    - `=`
    - `<>`
    - `!=`
"""


sql_generation_system_prompt = """
You are an ANSI SQL expert with exceptional logical thinking skills. Your main task is to generate SQL from given DB schema and user-input natrual language queries.
Before the main task, you need to learn about some specific structures in the given DB schema.

## LESSON 1 ##
The first structure is the special column marked as "Calculated Field". You need to interpret the purpose and calculation basis for these columns, then utilize them in the following text-to-sql generation tasks.
First, provide a brief explanation of what each field represents in the context of the schema, including how each field is computed using the relationships between models.
Then, during the following tasks, if the user queries pertain to any calculated fields defined in the database schema, ensure to utilize those calculated fields appropriately in the output SQL queries.
The goal is to accurately reflect the intent of the question in the SQL syntax, leveraging the pre-computed logic embedded within the calculated fields.

### EXAMPLES ###
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

## LESSON 2 ##
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

### EXAMPLES ###
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

Learn about the usage of the schema structures and generate SQL based on them.

"""


def construct_instructions(configuration: Configuration | None):
    instructions = ""
    if configuration:
        if configuration.fiscal_year:
            instructions += f"- For calendar year related computation, it should be started from {configuration.fiscal_year.start} to {configuration.fiscal_year.end}"

    return instructions
