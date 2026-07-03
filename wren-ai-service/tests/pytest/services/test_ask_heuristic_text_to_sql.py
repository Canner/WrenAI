import asyncio

from src.web.v1.services.ask import AskHistory, AskService


class _FakeSchemaRetrievalPipeline:
    def __init__(self):
        self.calls = []

    async def run(self, **kwargs):
        self.calls.append(kwargs)
        return {
            "construct_retrieval_results": {
                "retrieval_results": [
                    {
                        "table_name": "dbo_orders",
                        "table_ddl": (
                            "CREATE TABLE dbo_orders ("
                            "OrderId INT, CustomerId INT, OrderDate TIMESTAMP"
                            ")"
                        ),
                    }
                ],
                "has_calculated_field": False,
                "has_metric": False,
                "has_json_field": False,
            }
        }


def test_independent_question_does_not_reuse_historical_sql():
    service = AskService(pipelines={})

    assert not service._should_reuse_historical_question_sql(
        "Show monthly order count by market.",
        [],
    )
    assert not service._should_reuse_historical_question_sql(
        "Show monthly order count by market.",
        [AskHistory(question="previous", sql="SELECT 1")],
    )


def test_contextual_followup_can_reuse_historical_sql():
    service = AskService(pipelines={})

    assert service._should_reuse_historical_question_sql(
        "Use the same table and show it by month.",
        [AskHistory(question="previous", sql="SELECT 1")],
    )


def test_metadata_table_question_is_not_sql_or_chart_intent():
    service = AskService(pipelines={})

    assert service._get_metadata_question_kind(
        "What tables are there in this datasource?"
    ) == "tables"
    assert service._get_metadata_question_kind(
        "List the available models in the semantic layer"
    ) == "tables"
    assert service._get_metadata_question_kind(
        "Create a bar chart of orders by table category"
    ) is None


def test_metadata_column_question_is_not_sql_or_chart_intent():
    service = AskService(pipelines={})

    assert service._get_metadata_question_kind(
        "What columns are available in dbo_orders?"
    ) == "columns"
    assert service._get_metadata_question_kind(
        "Show fields in the CustomerMaster table"
    ) == "columns"
    assert service._get_metadata_question_kind(
        "Show schema for CustomerMaster"
    ) == "schema"
    assert service._get_metadata_question_kind(
        "Show a line chart of monthly order count by customer field"
    ) is None
    assert service._get_metadata_question_kind(
        "What is the row count for dbo_orders?"
    ) is None


def test_metadata_relationship_and_count_questions_have_specific_intents():
    service = AskService(pipelines={})

    assert service._get_metadata_question_kind(
        "What relationships exist between tables?"
    ) == "relationships"
    assert service._get_metadata_question_kind(
        "How many tables are in this datasource?"
    ) == "table_count"
    assert service._get_metadata_question_kind(
        "How many columns are in dbo_orders?"
    ) == "column_count"


def test_metadata_table_answer_lists_deployed_tables():
    service = AskService(pipelines={})
    answer = service._build_metadata_response(
        "What tables are there in this datasource?",
        [
            """
            CREATE TABLE dbo_orders (
              OrderId INT,
              CustomerName VARCHAR
            );
            """,
            """
            CREATE TABLE dbo_customers (
              CustomerId INT,
              Region VARCHAR
            );
            """,
        ],
        [],
    )

    assert "active datasource has 2 deployed tables" in answer
    assert "- dbo_orders" in answer
    assert "- dbo_customers" in answer


def test_metadata_column_answer_lists_matching_table_columns():
    service = AskService(pipelines={})
    answer = service._build_metadata_response(
        "What columns are available in dbo_orders?",
        [
            """
            CREATE TABLE dbo_orders (
              OrderId INT,
              CustomerName VARCHAR,
              OrderDate TIMESTAMP
            );
            """,
            """
            CREATE TABLE dbo_customers (
              CustomerId INT,
              Region VARCHAR
            );
            """,
        ],
        [],
    )

    assert "dbo_orders" in answer
    assert "OrderId (INT)" in answer
    assert "CustomerName (VARCHAR)" in answer
    assert "OrderDate (TIMESTAMP)" in answer
    assert "dbo_customers" not in answer


def test_metadata_schema_answer_includes_columns_and_relationships():
    service = AskService(pipelines={})
    answer = service._build_metadata_response(
        "Show schema for dbo_orders",
        [
            """
            CREATE TABLE dbo_orders (
              OrderId INT,
              CustomerId INT,
              CONSTRAINT fk_customer FOREIGN KEY (CustomerId)
                REFERENCES dbo_customers(CustomerId)
            );
            """,
            """
            CREATE TABLE dbo_customers (
              CustomerId INT,
              Region VARCHAR
            );
            """,
        ],
        [],
    )

    assert "Schema details from the active datasource metadata" in answer
    assert "- dbo_orders" in answer
    assert "OrderId (INT)" in answer
    assert "Relationships:" in answer
    assert "dbo_orders(CustomerId) -> dbo_customers(CustomerId)" in answer


def test_metadata_relationship_answer_lists_foreign_keys():
    service = AskService(pipelines={})
    answer = service._build_metadata_response(
        "What relationships exist between tables?",
        [
            """
            CREATE TABLE dbo_orders (
              OrderId INT,
              CustomerId INT,
              FOREIGN KEY (CustomerId) REFERENCES dbo_customers(CustomerId)
            );
            """,
        ],
        [],
    )

    assert "active datasource metadata has 1 relationship" in answer
    assert "dbo_orders(CustomerId) -> dbo_customers(CustomerId)" in answer


def test_metadata_count_answers_are_intent_specific():
    service = AskService(pipelines={})
    table_ddls = [
        """
        CREATE TABLE dbo_orders (
          OrderId INT,
          CustomerId INT
        );
        """,
        """
        CREATE TABLE dbo_customers (
          CustomerId INT,
          Region VARCHAR,
          Segment VARCHAR
        );
        """,
    ]

    table_count = service._build_metadata_response(
        "How many tables are in this datasource?",
        table_ddls,
        [],
    )
    column_count = service._build_metadata_response(
        "How many columns are in dbo_customers?",
        table_ddls,
        [],
    )

    assert table_count == "The active datasource has 2 deployed tables."
    assert column_count == "dbo_customers has 3 deployed columns."


def test_manufacturing_throughput_trend_uses_debug_entry_business_unit():
    service = AskService(pipelines={})
    table_ddls = [
        """
        CREATE TABLE dbo_DebugEntries (
          DebugEntryId VARCHAR,
          BusinessUnit VARCHAR,
          DateIn TIMESTAMP
        );
        """,
        """
        CREATE TABLE dbo_batch_records (
          id VARCHAR,
          board_model VARCHAR,
          production_date TIMESTAMP
        );
        """,
    ]

    sql = service._build_manufacturing_throughput_sql(
        "Show throughput trends across different manufacturing units.",
        table_ddls,
        table_names=["dbo_DebugEntries", "dbo_batch_records"],
    )

    assert sql
    assert '"dbo_DebugEntries"."BusinessUnit"' in sql
    assert '"dbo_DebugEntries"."DateIn"' in sql
    assert "dbo_batch_records" not in sql
    assert 'COUNT(*) AS "throughput"' in sql
    assert "DATEPART(MONTH" in sql


def test_manufacturing_throughput_fallback_requires_business_unit_column():
    service = AskService(pipelines={})
    table_ddls = [
        """
        CREATE TABLE dbo_batch_records (
          id VARCHAR,
          board_model VARCHAR,
          production_date TIMESTAMP
        );
        """
    ]

    assert (
        service._build_manufacturing_throughput_sql(
            "Show throughput trends across different manufacturing units.",
            table_ddls,
            table_names=["dbo_batch_records"],
        )
        is None
    )


def test_repair_failure_count_uses_repair_log_failure_code():
    service = AskService(pipelines={})
    table_ddls = [
        """
        CREATE TABLE dbo_repair_logs (
          id VARCHAR,
          board_model VARCHAR,
          failure_code VARCHAR,
          status VARCHAR,
          created_at TIMESTAMP
        );
        """,
        """
        CREATE TABLE dbo_reports (
          id VARCHAR,
          name VARCHAR
        );
        """,
    ]

    sql = service._build_repair_failure_count_sql(
        "Create a bar chart of repair counts grouped by failure category.",
        table_ddls,
        table_names=["dbo_repair_logs", "dbo_reports"],
    )

    assert sql
    assert '"dbo_repair_logs"."failure_code" AS "failure_category"' in sql
    assert 'COUNT(*) AS "repair_count"' in sql
    assert "Failure Category" not in sql
    assert "dbo_reports" not in sql


def test_repair_failure_count_prefers_debug_fix_description_when_available():
    service = AskService(pipelines={})
    table_ddls = [
        """
        CREATE TABLE dbo_DebugEntries (
          DebugEntryId VARCHAR,
          FailureSys VARCHAR
        );
        """,
        """
        CREATE TABLE dbo_DebugFixLogs (
          DebugEntryId VARCHAR,
          FixId VARCHAR
        );
        """,
        """
        CREATE TABLE dbo_DebugFixes (
          Id VARCHAR,
          Description VARCHAR
        );
        """,
        """
        CREATE TABLE dbo_repair_logs (
          id VARCHAR,
          failure_code VARCHAR
        );
        """,
    ]

    sql = service._build_repair_failure_count_sql(
        "Create a bar chart of repair counts grouped by failure category.",
        table_ddls,
        table_names=[
            "dbo_DebugEntries",
            "dbo_DebugFixLogs",
            "dbo_DebugFixes",
            "dbo_repair_logs",
        ],
    )

    assert sql
    assert '"dbo_DebugFixes"."Description" AS "failure_category"' in sql
    assert '"dbo_DebugFixLogs"."FixId" = "dbo_DebugFixes"."Id"' in sql
    assert '"dbo_repair_logs"."failure_code"' not in sql
    assert "FailurePatternID" not in sql


def test_common_pcb_failures_uses_repair_log_failure_code():
    service = AskService(pipelines={})
    table_ddls = [
        """
        CREATE TABLE dbo_repair_logs (
          id VARCHAR,
          board_model VARCHAR,
          failure_code VARCHAR,
          status VARCHAR,
          created_at TIMESTAMP
        );
        """,
        """
        CREATE TABLE dbo_DebugEntries (
          DebugEntryId VARCHAR,
          FailureSys VARCHAR
        );
        """,
    ]

    sql = service._build_repair_failure_count_sql(
        "Show top 10 most common PCB failures in a bar chart.",
        table_ddls,
        table_names=["dbo_repair_logs", "dbo_DebugEntries"],
    )

    assert sql
    assert sql.startswith('SELECT "dbo_repair_logs"."failure_code"')
    assert '"dbo_repair_logs"."failure_code" AS "failure_category"' in sql
    assert 'COUNT(*) AS "repair_count"' in sql
    assert "FailureSys" not in sql
    assert "TOP 10" not in sql
    assert sql.endswith("LIMIT 10")


def test_common_pcb_failures_uses_direct_heuristic_route():
    service = AskService(pipelines={})

    assert service._is_direct_heuristic_sql_query(
        "Show top 10 most common PCB failures in a bar chart."
    )


def test_repair_sla_compliance_uses_status_when_no_sla_duration_field():
    service = AskService(pipelines={})
    table_ddls = [
        """
        CREATE TABLE dbo_repair_logs (
          id VARCHAR,
          board_model VARCHAR,
          failure_code VARCHAR,
          status VARCHAR,
          priority VARCHAR,
          created_at TIMESTAMP,
          updated_at TIMESTAMP,
          data VARCHAR
        );
        """
    ]

    sql = service._build_repair_sla_compliance_sql(
        "Generate a dashboard chart for repair SLA compliance.",
        table_ddls,
        table_names=["dbo_repair_logs"],
    )

    assert sql
    assert '"dbo_repair_logs"."status" AS "sla_status"' in sql
    assert 'COUNT(*) AS "repair_count"' in sql
    assert '"dbo_repair_logs"."turnaround_time"' not in sql
    assert '"DAY"' not in sql
    assert '"MONTH"' not in sql
    assert "DATEDIFF" not in sql.upper()


def test_repair_sla_compliance_uses_direct_heuristic_route():
    service = AskService(pipelines={})

    assert service._is_direct_heuristic_sql_query(
        "Generate a dashboard chart for repair SLA compliance."
    )


def test_monthly_repair_volume_uses_created_at_bucket():
    service = AskService(pipelines={})
    table_ddls = [
        """
        CREATE TABLE dbo_repair_logs (
          id VARCHAR,
          board_model VARCHAR,
          failure_code VARCHAR,
          status VARCHAR,
          priority VARCHAR,
          created_at TIMESTAMP,
          updated_at TIMESTAMP,
          data VARCHAR
        );
        """
    ]

    sql = service._build_monthly_repair_volume_sql(
        "Generate a line chart showing monthly repair volume for the last 12 months.",
        table_ddls,
        table_names=["dbo_repair_logs"],
    )

    assert sql
    assert 'DATEPART(YEAR, "dbo_repair_logs"."created_at") AS "year"' in sql
    assert 'DATEPART(MONTH, "dbo_repair_logs"."created_at") AS "month"' in sql
    assert 'COUNT(*) AS "repair_count"' in sql
    assert '"dbo_repair_logs"."MONTH"' not in sql
    assert '"MONTH"' not in sql
    assert "DATEADD" not in sql.upper()
    assert "GETDATE" not in sql.upper()


def test_monthly_repair_volume_uses_direct_heuristic_route():
    service = AskService(pipelines={})

    assert service._is_direct_heuristic_sql_query(
        "Generate a line chart showing monthly repair volume for the last 12 months."
    )


def test_repair_failure_count_requires_schema_backed_failure_dimension():
    service = AskService(pipelines={})
    table_ddls = [
        """
        CREATE TABLE dbo_repair_logs (
          id VARCHAR,
          board_model VARCHAR,
          status VARCHAR,
          created_at TIMESTAMP
        );
        """
    ]

    assert (
        service._build_repair_failure_count_sql(
            "Create a bar chart of repair counts grouped by failure category.",
            table_ddls,
            table_names=["dbo_repair_logs"],
        )
        is None
    )


def test_ask_result_validation_requires_select_sql():
    service = AskService(pipelines={})

    assert service._build_ask_result_from_sql("SELECT 1")
    assert service._build_ask_result_from_sql("WITH rows AS (SELECT 1) SELECT * FROM rows")
    assert service._build_ask_result_from_sql("") is None
    assert service._build_ask_result_from_sql("DELETE FROM dbo_repair_logs") is None
    assert service._build_ask_result_from_sql(None) is None


def test_retrieval_metadata_ignores_malformed_documents():
    service = AskService(pipelines={})

    documents, table_names, table_ddls = service._extract_retrieval_metadata(
        {
            "construct_retrieval_results": {
                "retrieval_results": [
                    {"table_name": "dbo_repair_logs", "table_ddl": "CREATE TABLE dbo_repair_logs (id varchar)"},
                    {},
                    "bad-document",
                ]
            }
        }
    )

    assert len(documents) == 1
    assert table_names == ["dbo_repair_logs"]
    assert table_ddls == ["CREATE TABLE dbo_repair_logs (id varchar)"]


def test_explicit_table_filter_matches_dot_and_underscore_variants():
    service = AskService(pipelines={})
    assert service._extract_explicit_table_names_from_query(
        "Which name values have the highest occurrences in dbo.failure_patterns?"
    ) == ["dbo.failure_patterns"]
    documents = [
        {
            "table_name": "dbo_failure_patterns",
            "table_ddl": "CREATE TABLE dbo_failure_patterns (name varchar)",
        },
        {
            "table_name": "dbo_DebugEntries_Staging",
            "table_ddl": "CREATE TABLE dbo_DebugEntries_Staging (Priority varchar)",
        },
    ]

    filtered_documents, filtered_table_names, filtered_table_ddls = (
        service._filter_context_to_explicit_tables(
            "Which name values have the highest occurrences in dbo.failure_patterns?",
            documents,
            [document["table_name"] for document in documents],
            [document["table_ddl"] for document in documents],
        )
    )

    assert filtered_documents == [documents[0]]
    assert filtered_table_names == ["dbo_failure_patterns"]
    assert filtered_table_ddls == [
        "CREATE TABLE dbo_failure_patterns (name varchar)"
    ]


def test_explicit_metadata_object_extraction_avoids_plain_language_prepositions():
    service = AskService(pipelines={})

    assert service._extract_explicit_table_names_from_query(
        "Show total sales in each market"
    ) == []
    assert service._extract_explicit_table_names_from_query(
        "Show the first 10 rows from CustomerMaster"
    ) == ["CustomerMaster"]
    assert service._extract_explicit_table_names_from_query(
        "Create a chart on dbo.ticket_cycles by status"
    ) == ["dbo.ticket_cycles"]


def test_explicit_table_filter_includes_relationship_dependencies():
    service = AskService(pipelines={})
    documents = [
        {
            "table_name": "dbo_orders",
            "table_ddl": (
                "CREATE TABLE dbo_orders ("
                "OrderId INT, CustomerId INT, "
                "FOREIGN KEY (CustomerId) REFERENCES dbo_customers(CustomerId)"
                ")"
            ),
        },
        {
            "table_name": "dbo_customers",
            "table_ddl": "CREATE TABLE dbo_customers (CustomerId INT, Region varchar)",
        },
        {
            "table_name": "dbo_inventory",
            "table_ddl": "CREATE TABLE dbo_inventory (Sku varchar)",
        },
    ]

    _, filtered_table_names, _ = service._filter_context_to_explicit_tables(
        "Show orders from dbo.orders by customer region",
        documents,
        [document["table_name"] for document in documents],
        [document["table_ddl"] for document in documents],
    )

    assert filtered_table_names == ["dbo_orders", "dbo_customers"]


def test_prune_sql_generation_context_prioritizes_explicit_table_variant():
    service = AskService(pipelines={})
    table_ddls = [
        "CREATE TABLE dbo_DebugEntries_Staging (Priority varchar)",
        "CREATE TABLE dbo_failure_patterns (name varchar, occurrences int)",
    ]
    documents = [
        {"table_name": "dbo_DebugEntries_Staging", "table_ddl": table_ddls[0]},
        {"table_name": "dbo_failure_patterns", "table_ddl": table_ddls[1]},
    ]

    _, table_names, pruned_ddls = service._prune_sql_generation_context(
        "Which name values have the highest occurrences in dbo.failure_patterns?",
        documents,
        [document["table_name"] for document in documents],
        table_ddls,
        max_tables=1,
    )

    assert table_names == ["dbo_failure_patterns"]
    assert pruned_ddls == [table_ddls[1]]


def test_complete_sql_generation_context_refetches_full_selected_schema():
    pipeline = _FakeSchemaRetrievalPipeline()
    service = AskService(
        pipelines={"db_schema_retrieval": pipeline},
        schema_retrieval_timeout_seconds=180,
    )

    documents, table_names, table_ddls, retrieval_result = asyncio.run(
        service._complete_sql_generation_context(
            query="Show monthly orders by customer.",
            project_id="project-1",
            documents=[
                {
                    "table_name": "dbo_orders",
                    "table_ddl": "CREATE TABLE dbo_orders (OrderId INT)",
                }
            ],
            table_names=["dbo_orders"],
            table_ddls=["CREATE TABLE dbo_orders (OrderId INT)"],
        )
    )

    assert table_names == ["dbo_orders"]
    assert table_ddls == [
        "CREATE TABLE dbo_orders (OrderId INT, CustomerId INT, OrderDate TIMESTAMP)"
    ]
    assert documents == [
        {
            "table_name": "dbo_orders",
            "table_ddl": (
                "CREATE TABLE dbo_orders ("
                "OrderId INT, CustomerId INT, OrderDate TIMESTAMP"
                ")"
            ),
        }
    ]
    assert retrieval_result["retrieval_results"] == documents
    assert pipeline.calls == [
        {
            "query": "Show monthly orders by customer.",
            "tables": ["dbo_orders"],
            "project_id": "project-1",
            "histories": [],
            "enable_column_pruning": False,
        }
    ]
