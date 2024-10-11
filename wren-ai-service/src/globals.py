import logging
from dataclasses import asdict, dataclass
from typing import Optional

import toml

from src.core.pipeline import PipelineComponent
from src.core.provider import EmbedderProvider, LLMProvider
from src.pipelines.generation import (
    followup_sql_generation,
    relationship_recommendation,
    semantics_description,
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
from src.web.v1.services.relationship_recommendation import RelationshipRecommendation
from src.web.v1.services.semantics_description import SemanticsDescription
from src.web.v1.services.semantics_preparation import SemanticsPreparationService
from src.web.v1.services.sql_answer import SqlAnswerService
from src.web.v1.services.sql_expansion import SqlExpansionService
from src.web.v1.services.sql_explanation import SQLExplanationService
from src.web.v1.services.sql_regeneration import SQLRegenerationService

logger = logging.getLogger("wren-ai-service")


@dataclass
class ServiceContainer:
    relationship_recommendation: RelationshipRecommendation
    semantics_description: SemanticsDescription
    semantics_preparation_service: SemanticsPreparationService
    ask_service: AskService
    sql_answer_service: SqlAnswerService
    sql_expansion_service: SqlExpansionService
    ask_details_service: AskDetailsService
    sql_explanation_service: SQLExplanationService
    sql_regeneration_service: SQLRegenerationService


@dataclass
class ServiceMetadata:
    pipes_metadata: dict
    service_version: str


def create_service_container(
    pipe_components: dict[str, PipelineComponent],
    column_indexing_batch_size: Optional[int] = 50,
    table_retrieval_size: Optional[int] = 10,
    table_column_retrieval_size: Optional[int] = 1000,
    query_cache: Optional[dict] = {},
) -> ServiceContainer:
    return ServiceContainer(
        semantics_description=SemanticsDescription(
            pipelines={
                "semantics_description": semantics_description.SemanticsDescription(
                    **pipe_components["semantics_description"],
                )
            },
            **query_cache,
        ),
        semantics_preparation_service=SemanticsPreparationService(
            pipelines={
                "indexing": indexing.Indexing(
                    **pipe_components["indexing"],
                    column_indexing_batch_size=column_indexing_batch_size,
                ),
            },
            **query_cache,
        ),
        ask_service=AskService(
            pipelines={
                "retrieval": retrieval.Retrieval(
                    **pipe_components["retrieval"],
                    table_retrieval_size=table_retrieval_size,
                    table_column_retrieval_size=table_column_retrieval_size,
                ),
                "historical_question": historical_question.HistoricalQuestion(
                    **pipe_components["historical_question"],
                ),
                "sql_generation": sql_generation.SQLGeneration(
                    **pipe_components["sql_generation"],
                ),
                "sql_correction": sql_correction.SQLCorrection(
                    **pipe_components["sql_correction"],
                ),
                "followup_sql_generation": followup_sql_generation.FollowUpSQLGeneration(
                    **pipe_components["followup_sql_generation"],
                ),
                "sql_summary": sql_summary.SQLSummary(
                    **pipe_components["sql_summary"],
                ),
            },
            **query_cache,
        ),
        sql_answer_service=SqlAnswerService(
            pipelines={
                "sql_answer": sql_answer.SQLAnswer(
                    **pipe_components["sql_answer"],
                )
            },
            **query_cache,
        ),
        ask_details_service=AskDetailsService(
            pipelines={
                "sql_breakdown": sql_breakdown.SQLBreakdown(
                    **pipe_components["sql_breakdown"],
                ),
            },
            **query_cache,
        ),
        sql_expansion_service=SqlExpansionService(
            pipelines={
                "retrieval": retrieval.Retrieval(
                    **pipe_components["retrieval"],
                    table_retrieval_size=table_retrieval_size,
                    table_column_retrieval_size=table_column_retrieval_size,
                ),
                "sql_expansion": sql_expansion.SQLExpansion(
                    **pipe_components["sql_expansion"],
                ),
                "sql_correction": sql_correction.SQLCorrection(
                    **pipe_components["sql_correction"],
                ),
                "sql_summary": sql_summary.SQLSummary(
                    **pipe_components["sql_summary"],
                ),
            },
            **query_cache,
        ),
        sql_explanation_service=SQLExplanationService(
            pipelines={
                "sql_explanation": sql_explanation.SQLExplanation(
                    **pipe_components["sql_explanation"],
                )
            },
            **query_cache,
        ),
        sql_regeneration_service=SQLRegenerationService(
            pipelines={
                "sql_regeneration": sql_regeneration.SQLRegeneration(
                    **pipe_components["sql_regeneration"],
                )
            },
            **query_cache,
        ),
        relationship_recommendation=RelationshipRecommendation(
            pipelines={
                "relationship_recommendation": relationship_recommendation.RelationshipRecommendation(
                    **pipe_components["relationship_recommendation"],
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
    pipe_components: dict[str, PipelineComponent],
    pyproject_path: str = "pyproject.toml",
) -> ServiceMetadata:
    def _get_version_from_pyproject() -> str:
        with open(pyproject_path, "r") as f:
            pyproject = toml.load(f)
            return pyproject["tool"]["poetry"]["version"]

    def _convert_pipe_metadata(
        llm_provider: LLMProvider,
        embedder_provider: EmbedderProvider,
        **_,
    ) -> dict:
        llm_metadata = (
            {
                "llm_model": llm_provider.get_model(),
                "llm_model_kwargs": llm_provider.get_model_kwargs(),
            }
            if llm_provider
            else {}
        )

        embedding_metadata = (
            {
                "embedding_model": embedder_provider.get_model(),
                "embedding_model_dim": embedder_provider.get_dimensions(),
            }
            if embedder_provider
            else {}
        )
        return {**llm_metadata, **embedding_metadata}

    pipes_metadata = {
        pipe_name: _convert_pipe_metadata(**asdict(component))
        for pipe_name, component in pipe_components.items()
    }

    service_version = _get_version_from_pyproject()

    logger.info(f"Service version: {service_version}")

    return ServiceMetadata(pipes_metadata, service_version)


# Create a dependency that will be used to access the ServiceMetadata
def get_service_metadata():
    from src.__main__ import app

    return app.state.service_metadata
