from eval import EvalSettings, resolve_host_eval_data_db_path
import eval.pipelines as pipelines
from src.core.pipeline import PipelineComponent


def test_eval_settings_prefers_explicit_spider_benchmark_target(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    settings = EvalSettings()
    settings.eval_data_db_path = "etc/spider1.0/database"
    settings.spider_benchmark_db_target = (
        "postgresql://postgres:postgres@localhost:5432/{db_name}?schema=public"
    )

    assert (
        settings.effective_spider_benchmark_db_target
        == "postgresql://postgres:postgres@localhost:5432/{db_name}?schema=public"
    )


def test_eval_settings_normalizes_eval_data_db_path_for_host_side_metrics(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    settings = EvalSettings()
    settings.eval_data_db_path = "etc/spider1.0/database"

    assert (
        settings.effective_spider_benchmark_db_target
        == "postgresql://postgres:postgres@postgres:5432/test?schema=public"
    )


def test_resolve_host_eval_data_db_path_is_idempotent_for_tools_dev_paths():
    assert (
        resolve_host_eval_data_db_path("tools/dev/etc/spider1.0/database")
        == "tools/dev/etc/spider1.0/database"
    )


def test_eval_settings_can_build_default_postgres_benchmark_target(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    settings = EvalSettings()
    settings.postgres_host = "localhost"
    settings.postgres_port = "5432"
    settings.postgres_user = "postgres"
    settings.postgres_database = "benchmark"
    settings.spider_benchmark_postgres_schema = "analytics"

    assert (
        settings.effective_spider_benchmark_db_target
        == "postgresql://postgres:postgres@localhost:5432/benchmark?schema=analytics"
    )


def test_generation_pipeline_metrics_pass_spider_benchmark_target(mocker):
    for name in (
        "AccuracyMetric",
        "AnswerRelevancyMetric",
        "FaithfulnessMetric",
        "QuestionToReasoningJudge",
        "ReasoningToSqlJudge",
        "SqlSemanticsJudge",
    ):
        mocker.patch.object(pipelines, name, side_effect=lambda *args, **kwargs: object())

    target = "postgresql://postgres:postgres@localhost:5432/{db_name}?schema=public"
    result = pipelines.GenerationPipeline.metrics(
        engine_info={"api_endpoint": "http://localhost:8080"},
        enable_semantics_comparison=False,
        component=PipelineComponent(),
        spider_benchmark_db_target=target,
    )

    metric_db_dirs = [
        metric.db_dir for metric in result["metrics"] if hasattr(metric, "db_dir")
    ]
    assert metric_db_dirs == [target, target]


def test_ask_pipeline_metrics_pass_spider_benchmark_target(mocker):
    for name in (
        "AccuracyMetric",
        "AnswerRelevancyMetric",
        "FaithfulnessMetric",
        "ContextualRecallMetric",
        "ContextualRelevancyMetric",
        "ContextualPrecisionMetric",
        "QuestionToReasoningJudge",
        "ReasoningToSqlJudge",
        "SqlSemanticsJudge",
    ):
        mocker.patch.object(pipelines, name, side_effect=lambda *args, **kwargs: object())

    target = "postgresql://postgres:postgres@localhost:5432/{db_name}?schema=public"
    result = pipelines.AskPipeline.metrics(
        engine_info={"api_endpoint": "http://localhost:8080"},
        enable_semantics_comparison=False,
        component=PipelineComponent(),
        spider_benchmark_db_target=target,
    )

    metric_db_dirs = [
        metric.db_dir for metric in result["metrics"] if hasattr(metric, "db_dir")
    ]
    assert metric_db_dirs == [target, target]
