import pytest

from src.pipelines.generation.utils.sql import SQLGenPostProcessor

PROJECT_ID = "project-id"
MDL_HASH = "deployment-hash"
TABLE_A = "model_a"
TABLE_B = "model_b"
TABLE_SPECIAL = "model-with-special-name"
TABLE_UNKNOWN = "model_unknown"
COLUMN_ID = "id"
COLUMN_TEXT = "text_value"
COLUMN_STATUS = "status_value"
COLUMN_DATE = "date_value"
COLUMN_AMOUNT = "amount_value"
COLUMN_RANK = "rank_value"
COLUMN_RESERVED = "order"
COLUMN_SPECIAL = "line-item"
COLUMN_UNKNOWN = "missing_value"
AGGREGATE_ALIAS = "aggregate_value"
DATE_LITERAL = "2026-01-01 00:00:00"
STRING_LITERAL = "literal_value"
INVALID_ENGINE_SQL = f"SELECT * FROM {TABLE_A}"
ORIGINAL_SQL = f"SELECT * FROM {TABLE_B}"
INVALID_OBJECT_ERROR = f"Invalid object name '{TABLE_A}'."


class _NoopEngine:
    async def execute_sql(self, *_, **__):
        raise AssertionError("execute_sql should not run for malformed output")


class _CapturingEngine:
    def __init__(self):
        self.execute_kwargs = None
        self.dry_plan_kwargs = None
        self.executed_sql = None
        self.dry_planned_sql = None

    async def execute_sql(self, *args, **kwargs):
        self.executed_sql = args[0]
        self.execute_kwargs = kwargs
        return True, {}, {"correlation_id": ""}

    async def dry_plan(self, *args, **kwargs):
        self.dry_planned_sql = args[1]
        self.dry_plan_kwargs = kwargs
        return True, ""


class _FailingEngine:
    async def execute_sql(self, *_, **__):
        return (
            False,
            {},
            {
                "error_message": INVALID_OBJECT_ERROR,
                "error_sql": INVALID_ENGINE_SQL,
                "correlation_id": "cid",
            },
        )

    async def dry_plan(self, *_, **__):
        return True, ""


def schema_context(table_name=TABLE_A, columns=None):
    columns = columns or [COLUMN_ID, COLUMN_TEXT, COLUMN_AMOUNT]
    return [
        (
            f"CREATE TABLE {table_name} (\n  "
            + ",\n  ".join(f"{column} VARCHAR" for column in columns)
            + "\n);"
        )
    ]


@pytest.mark.asyncio
async def test_post_processor_returns_empty_invalid_result_for_truncated_json():
    processor = SQLGenPostProcessor(engine=_NoopEngine())

    result = await processor.run(
        ['{"sql": "SELECT'],
    )

    assert result["valid_generation_result"] == {}
    assert result["invalid_generation_result"] == {}


@pytest.mark.asyncio
async def test_post_processor_returns_empty_invalid_result_for_null_sql():
    processor = SQLGenPostProcessor(engine=_NoopEngine())

    result = await processor.run(
        ['{"sql": null}'],
    )

    assert result["valid_generation_result"] == {}
    assert result["invalid_generation_result"] == {}


@pytest.mark.asyncio
async def test_post_processor_returns_empty_invalid_result_for_null_sql_without_meta():
    processor = SQLGenPostProcessor(engine=_NoopEngine())

    result = await processor.run(['{"sql": null}'])

    assert result["valid_generation_result"] == {}
    assert result["invalid_generation_result"] == {}


@pytest.mark.asyncio
async def test_post_processor_returns_empty_invalid_result_for_missing_sql_key():
    processor = SQLGenPostProcessor(engine=_NoopEngine())

    result = await processor.run(['{"message": "done"}'])

    assert result["valid_generation_result"] == {}
    assert result["invalid_generation_result"] == {}


@pytest.mark.asyncio
async def test_post_processor_returns_empty_invalid_result_for_structured_sql_object():
    processor = SQLGenPostProcessor(engine=_NoopEngine())

    result = await processor.run(
        [f'{{"sql": {{"select": ["{COLUMN_TEXT}"], "from": "{TABLE_A}"}}}}'],
    )

    assert result["valid_generation_result"] == {}
    assert result["invalid_generation_result"] == {}


@pytest.mark.asyncio
async def test_post_processor_passes_deployment_hash_to_dry_run_validation():
    engine = _CapturingEngine()
    processor = SQLGenPostProcessor(engine=engine)

    result = await processor.run(
        ['{"sql": "SELECT 1"}'],
        project_id=PROJECT_ID,
        mdl_hash=MDL_HASH,
    )

    assert result["invalid_generation_result"] == {}
    assert engine.execute_kwargs["project_id"] == PROJECT_ID
    assert engine.execute_kwargs["mdl_hash"] == MDL_HASH


@pytest.mark.asyncio
async def test_post_processor_passes_deployment_hash_to_dry_plan_validation():
    engine = _CapturingEngine()
    processor = SQLGenPostProcessor(engine=engine)

    result = await processor.run(
        ['{"sql": "SELECT 1"}'],
        project_id=PROJECT_ID,
        mdl_hash=MDL_HASH,
        use_dry_plan=True,
    )

    assert result["invalid_generation_result"] == {}
    assert engine.dry_plan_kwargs["project_id"] == PROJECT_ID
    assert engine.dry_plan_kwargs["mdl_hash"] == MDL_HASH


@pytest.mark.asyncio
async def test_post_processor_allows_cte_alias_when_underlying_table_is_grounded():
    engine = _CapturingEngine()
    processor = SQLGenPostProcessor(engine=engine)

    result = await processor.run(
        [
            (
                f'{{"sql": "WITH recent AS (SELECT * FROM \\"{TABLE_A}\\") '
                'SELECT * FROM recent"}'
            )
        ],
    )

    assert result["invalid_generation_result"] == {}
    assert engine.execute_kwargs is not None


@pytest.mark.asyncio
async def test_post_processor_allows_qualified_column_on_grounded_alias():
    engine = _CapturingEngine()
    processor = SQLGenPostProcessor(engine=engine)

    result = await processor.run(
        [
            (
                f'{{"sql": "SELECT o.\\"{COLUMN_DATE}\\" '
                f'FROM \\"{TABLE_A}\\" AS o"}}'
            )
        ],
    )

    assert result["invalid_generation_result"] == {}
    assert engine.execute_kwargs is not None


@pytest.mark.asyncio
async def test_post_processor_allows_join_with_retrieved_relationship():
    engine = _CapturingEngine()
    processor = SQLGenPostProcessor(engine=engine)

    result = await processor.run(
        [
            (
                f'{{"sql": "SELECT a.\\"{COLUMN_ID}\\", b.\\"{COLUMN_TEXT}\\" '
                f'FROM \\"{TABLE_A}\\" a JOIN \\"{TABLE_B}\\" b '
                f'ON a.\\"{COLUMN_ID}\\" = b.\\"{COLUMN_ID}\\""}}'
            )
        ],
    )

    assert result["invalid_generation_result"] == {}
    assert engine.execute_kwargs is not None


@pytest.mark.asyncio
async def test_post_processor_allows_output_aliases_in_order_by():
    engine = _CapturingEngine()
    processor = SQLGenPostProcessor(engine=engine)

    result = await processor.run(
        [
            (
                f'{{"sql": "SELECT COUNT(*) AS \\"{AGGREGATE_ALIAS}\\" '
                f'FROM \\"{TABLE_A}\\" ORDER BY \\"{AGGREGATE_ALIAS}\\" DESC"}}'
            )
        ],
    )

    assert result["invalid_generation_result"] == {}
    assert engine.execute_kwargs is not None


@pytest.mark.asyncio
async def test_post_processor_allows_string_literals_in_filters():
    engine = _CapturingEngine()
    processor = SQLGenPostProcessor(engine=engine)

    result = await processor.run(
        [
            (
                f'{{"sql": "SELECT \\"{COLUMN_TEXT}\\" FROM \\"{TABLE_A}\\" '
                f'WHERE \\"{COLUMN_TEXT}\\" = '
                f"'{STRING_LITERAL}'\"}}"
            )
        ],
    )

    assert result["invalid_generation_result"] == {}
    assert engine.execute_kwargs is not None


@pytest.mark.asyncio
async def test_post_processor_uses_engine_error_sql_for_correction_like_legacy():
    processor = SQLGenPostProcessor(engine=_FailingEngine())

    result = await processor.run(
        [f'{{"sql": "{ORIGINAL_SQL}"}}'],
    )

    invalid = result["invalid_generation_result"]
    assert invalid["sql"] == INVALID_ENGINE_SQL
    assert invalid["original_sql"] == ORIGINAL_SQL
    assert invalid["error"] == INVALID_OBJECT_ERROR


@pytest.mark.asyncio
async def test_post_processor_allows_raw_sql_when_grounded():
    engine = _CapturingEngine()
    processor = SQLGenPostProcessor(engine=engine)

    result = await processor.run(
        [f'SELECT "{COLUMN_DATE}" FROM "{TABLE_A}"'],
    )

    assert result["invalid_generation_result"] == {}
    assert result["valid_generation_result"] != {}
    assert engine.execute_kwargs is not None


@pytest.mark.asyncio
async def test_post_processor_removes_semicolon_inside_json_sql_like_legacy():
    engine = _CapturingEngine()
    processor = SQLGenPostProcessor(engine=engine)

    result = await processor.run(
        [f'{{"sql": "SELECT COUNT(*) AS {AGGREGATE_ALIAS} FROM {TABLE_A};"}}'],
    )

    assert result["invalid_generation_result"] == {}
    assert engine.executed_sql == f"SELECT COUNT(*) AS {AGGREGATE_ALIAS} FROM {TABLE_A}"


@pytest.mark.asyncio
async def test_post_processor_quotes_schema_identifiers_before_validation():
    engine = _CapturingEngine()
    processor = SQLGenPostProcessor(engine=engine)
    contexts = [
        (
            f"CREATE TABLE {TABLE_SPECIAL} (\n"
            f"  {COLUMN_RESERVED} INTEGER,\n"
            f"  {COLUMN_SPECIAL} VARCHAR\n"
            ");"
        )
    ]

    result = await processor.run(
        [
            (
                f'{{"sql": "SELECT {COLUMN_SPECIAL}, COUNT(t.{COLUMN_RESERVED}) '
                f'FROM {TABLE_SPECIAL} AS t GROUP BY {COLUMN_SPECIAL}"}}'
            )
        ],
        contexts=contexts,
    )

    expected_sql = (
        f'SELECT "{COLUMN_SPECIAL}", COUNT(t."{COLUMN_RESERVED}") '
        f'FROM "{TABLE_SPECIAL}" AS t GROUP BY "{COLUMN_SPECIAL}"'
    )
    assert result["invalid_generation_result"] == {}
    assert result["valid_generation_result"]["sql"] == expected_sql
    assert engine.executed_sql == expected_sql


@pytest.mark.asyncio
async def test_post_processor_does_not_quote_schema_identifiers_inside_literals():
    engine = _CapturingEngine()
    processor = SQLGenPostProcessor(engine=engine)
    contexts = [
        (
            f"CREATE TABLE {TABLE_SPECIAL} (\n"
            f"  {COLUMN_STATUS} VARCHAR,\n"
            f"  {COLUMN_SPECIAL} VARCHAR\n"
            ");"
        )
    ]

    result = await processor.run(
        [
            (
                f'{{"sql": "SELECT {COLUMN_SPECIAL} FROM {TABLE_SPECIAL} '
                f"WHERE {COLUMN_STATUS} = '{TABLE_SPECIAL}'\"}}"
            )
        ],
        contexts=contexts,
    )

    expected_sql = (
        f'SELECT "{COLUMN_SPECIAL}" FROM "{TABLE_SPECIAL}" '
        f"WHERE {COLUMN_STATUS} = '{TABLE_SPECIAL}'"
    )
    assert result["invalid_generation_result"] == {}
    assert engine.executed_sql == expected_sql


@pytest.mark.asyncio
async def test_post_processor_rejects_table_not_in_retrieved_schema():
    engine = _CapturingEngine()
    processor = SQLGenPostProcessor(engine=engine)

    result = await processor.run(
        [f'SELECT "{COLUMN_ID}" FROM "{TABLE_UNKNOWN}"'],
        contexts=schema_context(TABLE_A),
    )

    invalid = result["invalid_generation_result"]
    assert result["valid_generation_result"] == {}
    assert invalid["type"] == "SCHEMA_GROUNDING"
    assert TABLE_UNKNOWN in invalid["error"]
    assert engine.execute_kwargs is None


@pytest.mark.asyncio
async def test_post_processor_rejects_qualified_column_not_in_retrieved_schema():
    engine = _CapturingEngine()
    processor = SQLGenPostProcessor(engine=engine)

    result = await processor.run(
        [f'SELECT t."{COLUMN_UNKNOWN}" FROM "{TABLE_A}" AS t'],
        contexts=schema_context(TABLE_A, [COLUMN_ID, COLUMN_TEXT]),
    )

    invalid = result["invalid_generation_result"]
    assert result["valid_generation_result"] == {}
    assert invalid["type"] == "SCHEMA_GROUNDING"
    assert f"t.{COLUMN_UNKNOWN}" in invalid["error"]
    assert engine.execute_kwargs is None


@pytest.mark.asyncio
async def test_post_processor_validates_columns_after_schema_comments():
    engine = _CapturingEngine()
    processor = SQLGenPostProcessor(engine=engine)
    contexts = [
        (
            f"CREATE TABLE {TABLE_A} (\n"
            f'  -- {{"description":"identifier"}}\n'
            f"  {COLUMN_ID} VARCHAR,\n"
            f'  -- {{"description":"text"}}\n'
            f"  {COLUMN_TEXT} VARCHAR\n"
            ");"
        )
    ]

    result = await processor.run(
        [f'SELECT t."{COLUMN_ID}" FROM "{TABLE_A}" AS t'],
        contexts=contexts,
    )

    assert result["invalid_generation_result"] == {}
    assert engine.execute_kwargs is not None


@pytest.mark.asyncio
async def test_post_processor_rejects_dummy_cte_for_schema_object():
    engine = _CapturingEngine()
    processor = SQLGenPostProcessor(engine=engine)

    result = await processor.run(
        [
            (
                f'WITH "{TABLE_A}" AS (SELECT 1) '
                f'SELECT "{COLUMN_ID}" FROM "{TABLE_A}"'
            )
        ],
        contexts=schema_context(TABLE_A),
    )

    invalid = result["invalid_generation_result"]
    assert result["valid_generation_result"] == {}
    assert invalid["type"] == "SCHEMA_GROUNDING"
    assert "dummy CTEs" in invalid["error"]
    assert engine.execute_kwargs is None


@pytest.mark.asyncio
async def test_post_processor_converts_bracket_quoted_schema_identifiers():
    engine = _CapturingEngine()
    processor = SQLGenPostProcessor(engine=engine)

    result = await processor.run(
        [f"SELECT [{COLUMN_SPECIAL}] FROM [{TABLE_SPECIAL}]"],
        contexts=schema_context(TABLE_SPECIAL, [COLUMN_SPECIAL]),
    )

    expected_sql = f'SELECT "{COLUMN_SPECIAL}" FROM "{TABLE_SPECIAL}"'
    assert result["invalid_generation_result"] == {}
    assert result["valid_generation_result"]["sql"] == expected_sql
    assert engine.executed_sql == expected_sql


@pytest.mark.asyncio
async def test_post_processor_allows_non_schema_cte_built_from_verified_table():
    engine = _CapturingEngine()
    processor = SQLGenPostProcessor(engine=engine)

    result = await processor.run(
        [
            (
                f'WITH totals AS (SELECT "{COLUMN_ID}" FROM "{TABLE_A}") '
                f'SELECT "{COLUMN_ID}" FROM totals'
            )
        ],
        contexts=schema_context(TABLE_A),
    )

    assert result["invalid_generation_result"] == {}
    assert engine.execute_kwargs is not None


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "sql",
    [
        f'SELECT "{COLUMN_ID}" FROM "{TABLE_A}" WHERE "{COLUMN_STATUS}" = \'{STRING_LITERAL}\'',
        (
            f'SELECT a."{COLUMN_ID}", b."{COLUMN_TEXT}" FROM "{TABLE_A}" a '
            f'JOIN "{TABLE_B}" b ON a."{COLUMN_ID}" = b."{COLUMN_ID}"'
        ),
        f'SELECT "{COLUMN_ID}", COUNT(*) AS "{AGGREGATE_ALIAS}" FROM "{TABLE_A}" GROUP BY "{COLUMN_ID}"',
        (
            f'SELECT "{COLUMN_ID}", COUNT(*) AS "{AGGREGATE_ALIAS}" FROM "{TABLE_A}" '
            f'GROUP BY "{COLUMN_ID}" HAVING COUNT(*) > 1'
        ),
        f'SELECT "{COLUMN_ID}", "{COLUMN_DATE}" FROM "{TABLE_A}" ORDER BY "{COLUMN_DATE}" DESC',
        (
            f'SELECT "{COLUMN_ID}", SUM("{COLUMN_AMOUNT}") AS "{AGGREGATE_ALIAS}", '
            f'DENSE_RANK() OVER (ORDER BY SUM("{COLUMN_AMOUNT}") DESC) AS "{COLUMN_RANK}" '
            f'FROM "{TABLE_A}" GROUP BY "{COLUMN_ID}"'
        ),
        (
            f'WITH totals AS (SELECT "{COLUMN_ID}", SUM("{COLUMN_AMOUNT}") AS "{COLUMN_AMOUNT}" '
            f'FROM "{TABLE_A}" GROUP BY "{COLUMN_ID}") SELECT * FROM totals'
        ),
        f'SELECT DISTINCT "{COLUMN_ID}" FROM "{TABLE_A}"',
        (
            f'SELECT CASE WHEN "{COLUMN_AMOUNT}" > 0 THEN \'{STRING_LITERAL}\' '
            f'ELSE \'empty_value\' END AS "{COLUMN_STATUS}" FROM "{TABLE_A}"'
        ),
        (
            f'SELECT "{COLUMN_ID}" FROM "{TABLE_A}" WHERE "{COLUMN_DATE}" >= '
            f"CAST('{DATE_LITERAL}' AS TIMESTAMP WITH TIME ZONE)"
        ),
        (
            f'SELECT "{COLUMN_ID}" FROM "{TABLE_A}" WHERE "{COLUMN_ID}" IN '
            f'(SELECT "{COLUMN_ID}" FROM "{TABLE_B}" WHERE "{COLUMN_TEXT}" = \'{STRING_LITERAL}\')'
        ),
    ],
)
async def test_post_processor_sends_common_sql_patterns_to_engine_validation(sql):
    engine = _CapturingEngine()
    processor = SQLGenPostProcessor(engine=engine)

    result = await processor.run([sql])

    assert result["invalid_generation_result"] == {}
    assert result["valid_generation_result"]["sql"] == sql
    assert engine.executed_sql == sql
