from eval import EvalSettings
from eval.evaluation import prepare_spider_benchmark_target
from eval.prediction import generate_meta


POSTGRES_TARGET = (
    "postgresql://postgres:postgres@localhost:5432/{db_name}?schema=analytics"
)


def test_generate_meta_records_eval_source_path_and_postgres_backend(
    monkeypatch, mocker
):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    mocker.patch("eval.prediction.obtain_commit_hash", return_value="test-commit@main")

    settings = EvalSettings()
    settings.datasource = "postgres"
    settings.eval_data_db_path = "etc/spider1.0/database"
    settings.spider_benchmark_db_target = POSTGRES_TARGET

    dataset = {
        "dataset_id": "dataset-1",
        "mdl": {"catalog": "test_catalog"},
        "eval_dataset": [{"question": "q", "sql": "select 1"}],
    }

    meta = generate_meta(
        path="eval/dataset/spider_concert_singer_eval_dataset.toml",
        dataset=dataset,
        pipe="ask",
        settings=settings,
    )

    assert meta["eval_data_db_path"] == "etc/spider1.0/database"
    assert meta["spider_benchmark_db_target"] == POSTGRES_TARGET
    assert meta["spider_benchmark_backend"] == "postgres"


def test_prepare_spider_benchmark_target_restores_source_path_and_loads_postgres(
    monkeypatch, mocker
):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    load_to_postgres = mocker.patch("eval.evaluation.load_eval_data_db_to_postgres")

    settings = EvalSettings()
    prepare_spider_benchmark_target(
        meta={
            "evaluation_dataset": "eval/dataset/spider_concert_singer_eval_dataset.toml",
            "eval_data_db_path": "etc/spider1.0/database",
            "spider_benchmark_db_target": POSTGRES_TARGET,
        },
        settings=settings,
    )

    assert settings.eval_data_db_path == "etc/spider1.0/database"
    assert settings.spider_benchmark_db_target == POSTGRES_TARGET
    load_to_postgres.assert_called_once_with(
        "concert_singer",
        "etc/spider1.0/database",
        POSTGRES_TARGET,
    )


def test_prepare_spider_benchmark_target_infers_source_path_for_legacy_prediction_files(
    monkeypatch, mocker
):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    load_to_postgres = mocker.patch("eval.evaluation.load_eval_data_db_to_postgres")

    settings = EvalSettings()
    prepare_spider_benchmark_target(
        meta={
            "evaluation_dataset": "eval/dataset/spider_concert_singer_eval_dataset.toml",
            "spider_benchmark_db_target": POSTGRES_TARGET,
        },
        settings=settings,
    )

    assert settings.eval_data_db_path == "etc/spider1.0/database"
    load_to_postgres.assert_called_once_with(
        "concert_singer",
        "etc/spider1.0/database",
        POSTGRES_TARGET,
    )


def test_prepare_spider_benchmark_target_skips_reload_for_file_targets(
    monkeypatch, mocker
):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    load_to_postgres = mocker.patch("eval.evaluation.load_eval_data_db_to_postgres")

    settings = EvalSettings()
    prepare_spider_benchmark_target(
        meta={
            "evaluation_dataset": "eval/dataset/spider_concert_singer_eval_dataset.toml",
            "eval_data_db_path": "etc/spider1.0/database",
            "spider_benchmark_db_target": "./tools/dev/etc/spider1.0/database",
        },
        settings=settings,
    )

    assert settings.eval_data_db_path == "etc/spider1.0/database"
    load_to_postgres.assert_not_called()
