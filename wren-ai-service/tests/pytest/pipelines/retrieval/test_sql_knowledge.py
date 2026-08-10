from src.pipelines.retrieval.sql_knowledge import SqlKnowledge


def test_sql_knowledge_exposes_legacy_structured_instructions():
    sql_knowledge = SqlKnowledge(
        {
            "text_to_sql_rule": "Use Wren SQL.",
            "instructions": {
                "date_and_time_functionality": "Use CURRENT_DATE.",
                "bigquery": "Use BigQuery-specific guidance.",
                "calculated_field_instructions": "Calculated field guidance.",
                "metric_instructions": "Metric guidance.",
                "json_field_instructions": "JSON guidance.",
            },
        }
    )

    assert sql_knowledge.text_to_sql_rule == "Use Wren SQL."
    assert sql_knowledge.calculated_field_instructions == "Calculated field guidance."
    assert sql_knowledge.metric_instructions == "Metric guidance."
    assert sql_knowledge.json_field_instructions == "JSON guidance."
