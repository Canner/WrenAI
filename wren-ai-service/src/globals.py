import logging
from dataclasses import dataclass
from typing import Optional

import toml

from src.core.engine import Engine
from src.core.provider import DocumentStoreProvider, EmbedderProvider, LLMProvider
from src.pipelines.generation import (
    followup_sql_generation,
    sql_answer,
    sql_breakdown,
    sql_correction,
    sql_expansion,
    sql_explanation,
    sql_generation,
    sql_regeneration,
    sql_summary,
)
from src.pipelines.indexing import indexing
from src.pipelines.retrieval import historical_question, retrieval
from src.web.v1.services.ask import AskService
from src.web.v1.services.ask_details import AskDetailsService
from src.web.v1.services.semantics_preparation import SemanticsPreparationService
from src.web.v1.services.sql_answer import SqlAnswerService
from src.web.v1.services.sql_expansion import SqlExpansionService
from src.web.v1.services.sql_explanation import SQLExplanationService
from src.web.v1.services.sql_regeneration import SQLRegenerationService

logger = logging.getLogger("wren-ai-service")


@dataclass
class ServiceContainer:
    semantics_preparation_service: SemanticsPreparationService
    ask_service: AskService
    sql_answer_service: SqlAnswerService
    sql_expansion_service: SqlExpansionService
    ask_details_service: AskDetailsService
    sql_explanation_service: SQLExplanationService
    sql_regeneration_service: SQLRegenerationService


@dataclass
class ServiceMetadata:
    models_metadata: dict
    service_version: str


def create_service_container(
    llm_provider: LLMProvider,
    embedder_provider: EmbedderProvider,
    document_store_provider: DocumentStoreProvider,
    engine: Engine,
    should_force_deploy: Optional[str] = None,
    column_indexing_batch_size: Optional[int] = 50,
    table_retrieval_size: Optional[int] = 10,
    table_column_retrieval_size: Optional[int] = 1000,
    query_cache: Optional[dict] = {},
) -> ServiceContainer:
    if should_force_deploy:
        document_store_provider.get_store(recreate_index=True)
        document_store_provider.get_store(
            dataset_name="table_descriptions", recreate_index=True
        )
        document_store_provider.get_store(
            dataset_name="view_questions", recreate_index=True
        )

    return ServiceContainer(
        semantics_preparation_service=SemanticsPreparationService(
            pipelines={
                "indexing": indexing.Indexing(
                    embedder_provider=embedder_provider,
                    document_store_provider=document_store_provider,
                    column_indexing_batch_size=column_indexing_batch_size,
                ),
            },
            **query_cache,
        ),
        ask_service=AskService(
            pipelines={
                "retrieval": retrieval.Retrieval(
                    llm_provider=llm_provider,
                    embedder_provider=embedder_provider,
                    document_store_provider=document_store_provider,
                    table_retrieval_size=table_retrieval_size,
                    table_column_retrieval_size=table_column_retrieval_size,
                ),
                "historical_question": historical_question.HistoricalQuestion(
                    embedder_provider=embedder_provider,
                    store_provider=document_store_provider,
                ),
                "sql_generation": sql_generation.SQLGeneration(
                    llm_provider=llm_provider,
                    engine=engine,
                ),
                "sql_correction": sql_correction.SQLCorrection(
                    llm_provider=llm_provider,
                    engine=engine,
                ),
                "followup_sql_generation": followup_sql_generation.FollowUpSQLGeneration(
                    llm_provider=llm_provider,
                    engine=engine,
                ),
                "sql_summary": sql_summary.SQLSummary(
                    llm_provider=llm_provider,
                ),
            },
            **query_cache,
        ),
        sql_answer_service=SqlAnswerService(
            pipelines={
                "sql_answer": sql_answer.SQLAnswer(
                    llm_provider=llm_provider,
                    engine=engine,
                )
            },
            **query_cache,
        ),
        ask_details_service=AskDetailsService(
            pipelines={
                "sql_breakdown": sql_breakdown.SQLBreakdown(
                    llm_provider=llm_provider,
                    engine=engine,
                ),
            },
            **query_cache,
        ),
        sql_expansion_service=SqlExpansionService(
            pipelines={
                "retrieval": retrieval.Retrieval(
                    llm_provider=llm_provider,
                    embedder_provider=embedder_provider,
                    document_store_provider=document_store_provider,
                    table_retrieval_size=table_retrieval_size,
                    table_column_retrieval_size=table_column_retrieval_size,
                ),
                "sql_expansion": sql_expansion.SQLExpansion(
                    llm_provider=llm_provider,
                    engine=engine,
                ),
                "sql_correction": sql_correction.SQLCorrection(
                    llm_provider=llm_provider,
                    engine=engine,
                ),
                "sql_summary": sql_summary.SQLSummary(
                    llm_provider=llm_provider,
                ),
            },
            **query_cache,
        ),
        sql_explanation_service=SQLExplanationService(
            pipelines={
                "sql_explanation": sql_explanation.SQLExplanation(
                    llm_provider=llm_provider,
                )
            },
            **query_cache,
        ),
        sql_regeneration_service=SQLRegenerationService(
            pipelines={
                "sql_regeneration": sql_regeneration.SQLRegeneration(
                    llm_provider=llm_provider,
                    engine=engine,
                )
            },
            **query_cache,
        ),
    )


# Create a dependency that will be used to access the ServiceContainer
def get_service_container():
    from src.__main__ import app

    return app.state.service_container


def create_service_metadata(
    llm_provider: LLMProvider,
    embedder_provider: EmbedderProvider,
    *_,
    pyproject_path: str = "pyproject.toml",
) -> ServiceMetadata:
    def _get_version_from_pyproject() -> str:
        with open(pyproject_path, "r") as f:
            pyproject = toml.load(f)
            return pyproject["tool"]["poetry"]["version"]

    models_metadata = {
        "generation_model": llm_provider.get_model(),
        "generation_model_kwargs": llm_provider.get_model_kwargs(),
        "embedding_model": embedder_provider.get_model(),
        "embedding_model_dim": embedder_provider.get_dimensions(),
    }
    service_version = _get_version_from_pyproject()

    logger.info(f"Service version: {service_version}")

    return ServiceMetadata(models_metadata, service_version)


# Create a dependency that will be used to access the ServiceMetadata
def get_service_metadata():
    from src.__main__ import app

    return app.state.service_metadata
