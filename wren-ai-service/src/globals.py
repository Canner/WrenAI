import logging
from dataclasses import asdict, dataclass

import toml

from src.config import Settings
from src.core.pipeline import PipelineComponent
from src.core.provider import EmbedderProvider, LLMProvider
from src.pipelines import generation, indexing, retrieval
from src.web.v1.services.ask import AskService
from src.web.v1.services.ask_details import AskDetailsService
from src.web.v1.services.chart import ChartService
from src.web.v1.services.chart_adjustment import ChartAdjustmentService
from src.web.v1.services.question_recommendation import QuestionRecommendation
from src.web.v1.services.relationship_recommendation import RelationshipRecommendation
from src.web.v1.services.semantics_description import SemanticsDescription
from src.web.v1.services.semantics_preparation import SemanticsPreparationService
from src.web.v1.services.sql_answer import SqlAnswerService
from src.web.v1.services.sql_expansion import SqlExpansionService
from src.web.v1.services.sql_explanation import SqlExplanationService
from src.web.v1.services.sql_pairs_preparation import SqlPairsPreparationService
from src.web.v1.services.sql_question import SqlQuestionService
from src.web.v1.services.sql_regeneration import SqlRegenerationService

logger = logging.getLogger("wren-ai-service")


@dataclass
class ServiceContainer:
    ask_service: AskService
    ask_details_service: AskDetailsService
    question_recommendation: QuestionRecommendation
    relationship_recommendation: RelationshipRecommendation
    semantics_description: SemanticsDescription
    semantics_preparation_service: SemanticsPreparationService
    chart_service: ChartService
    chart_adjustment_service: ChartAdjustmentService
    sql_answer_service: SqlAnswerService
    sql_expansion_service: SqlExpansionService
    sql_explanation_service: SqlExplanationService
    sql_regeneration_service: SqlRegenerationService
    sql_pairs_preparation_service: SqlPairsPreparationService
    sql_question_service: SqlQuestionService


@dataclass
class ServiceMetadata:
    pipes_metadata: dict
    service_version: str


def create_service_container(
    pipe_components: dict[str, PipelineComponent],
    settings: Settings,
) -> ServiceContainer:
    query_cache = {
        "maxsize": settings.query_cache_maxsize,
        "ttl": settings.query_cache_ttl,
    }
    return ServiceContainer(
        semantics_description=SemanticsDescription(
            pipelines={
                "semantics_description": generation.SemanticsDescription(
                    **pipe_components["semantics_description"],
                )
            },
            **query_cache,
        ),
        semantics_preparation_service=SemanticsPreparationService(
            pipelines={
                "db_schema": indexing.DBSchema(
                    **pipe_components["db_schema_indexing"],
                    column_batch_size=settings.column_indexing_batch_size,
                ),
                "historical_question": indexing.HistoricalQuestion(
                    **pipe_components["historical_question_indexing"],
                ),
                "table_description": indexing.TableDescription(
                    **pipe_components["table_description_indexing"],
                ),
                "sql_pairs": indexing.SqlPairs(
                    **pipe_components["sql_pairs_indexing"],
                    sql_pairs_path=settings.sql_pairs_path,
                ),
            },
            **query_cache,
        ),
        ask_service=AskService(
            pipelines={
                "intent_classification": generation.IntentClassification(
                    **pipe_components["intent_classification"],
                ),
                "data_assistance": generation.DataAssistance(
                    **pipe_components["data_assistance"]
                ),
                "retrieval": retrieval.Retrieval(
                    **pipe_components["db_schema_retrieval"],
                    table_retrieval_size=settings.table_retrieval_size,
                    table_column_retrieval_size=settings.table_column_retrieval_size,
                    allow_using_db_schemas_without_pruning=settings.allow_using_db_schemas_without_pruning,
                ),
                "historical_question": retrieval.HistoricalQuestionRetrieval(
                    **pipe_components["historical_question_retrieval"],
                ),
                "sql_pairs_retrieval": retrieval.SqlPairsRetrieval(
                    **pipe_components["sql_pairs_retrieval"],
                ),
                "sql_generation": generation.SQLGeneration(
                    **pipe_components["sql_generation"],
                ),
                "sql_generation_reasoning": generation.SQLGenerationReasoning(
                    **pipe_components["sql_generation_reasoning"],
                ),
                "sql_correction": generation.SQLCorrection(
                    **pipe_components["sql_correction"],
                ),
                "followup_sql_generation": generation.FollowUpSQLGeneration(
                    **pipe_components["followup_sql_generation"],
                ),
                "sql_summary": generation.SQLSummary(
                    **pipe_components["sql_summary"],
                ),
            },
            **query_cache,
        ),
        chart_service=ChartService(
            pipelines={
                "sql_executor": retrieval.SQLExecutor(
                    **pipe_components["sql_executor"],
                ),
                "chart_generation": generation.ChartGeneration(
                    **pipe_components["chart_generation"],
                ),
            },
            **query_cache,
        ),
        chart_adjustment_service=ChartAdjustmentService(
            pipelines={
                "sql_executor": retrieval.SQLExecutor(
                    **pipe_components["sql_executor"],
                ),
                "chart_adjustment": generation.ChartAdjustment(
                    **pipe_components["chart_adjustment"],
                ),
            },
            **query_cache,
        ),
        sql_answer_service=SqlAnswerService(
            pipelines={
                "preprocess_sql_data": retrieval.PreprocessSqlData(
                    **pipe_components["preprocess_sql_data"],
                ),
                "sql_answer": generation.SQLAnswer(
                    **pipe_components["sql_answer"],
                ),
            },
            **query_cache,
        ),
        ask_details_service=AskDetailsService(
            pipelines={
                "sql_breakdown": generation.SQLBreakdown(
                    **pipe_components["sql_breakdown"],
                ),
                "sql_summary": generation.SQLSummary(
                    **pipe_components["sql_summary"],
                ),
            },
            **query_cache,
        ),
        sql_expansion_service=SqlExpansionService(
            pipelines={
                "retrieval": retrieval.Retrieval(
                    **pipe_components["db_schema_retrieval"],
                    table_retrieval_size=settings.table_retrieval_size,
                    table_column_retrieval_size=settings.table_column_retrieval_size,
                ),
                "sql_expansion": generation.SQLExpansion(
                    **pipe_components["sql_expansion"],
                ),
                "sql_correction": generation.SQLCorrection(
                    **pipe_components["sql_correction"],
                ),
                "sql_summary": generation.SQLSummary(
                    **pipe_components["sql_summary"],
                ),
            },
            **query_cache,
        ),
        sql_explanation_service=SqlExplanationService(
            pipelines={
                "sql_explanation": generation.SQLExplanation(
                    **pipe_components["sql_explanation"],
                )
            },
            **query_cache,
        ),
        sql_regeneration_service=SqlRegenerationService(
            pipelines={
                "sql_regeneration": generation.SQLRegeneration(
                    **pipe_components["sql_regeneration"],
                )
            },
            **query_cache,
        ),
        relationship_recommendation=RelationshipRecommendation(
            pipelines={
                "relationship_recommendation": generation.RelationshipRecommendation(
                    **pipe_components["relationship_recommendation"],
                )
            },
            **query_cache,
        ),
        question_recommendation=QuestionRecommendation(
            pipelines={
                "question_recommendation": generation.QuestionRecommendation(
                    **pipe_components["question_recommendation"],
                ),
                "retrieval": retrieval.Retrieval(
                    **pipe_components["question_recommendation_db_schema_retrieval"],
                    table_retrieval_size=settings.table_retrieval_size,
                    table_column_retrieval_size=settings.table_column_retrieval_size,
                    allow_using_db_schemas_without_pruning=settings.allow_using_db_schemas_without_pruning,
                ),
                "sql_generation": generation.SQLGeneration(
                    **pipe_components["question_recommendation_sql_generation"],
                ),
                "sql_generation_reasoning": generation.SQLGenerationReasoning(
                    **pipe_components["sql_generation_reasoning"],
                ),
            },
            **query_cache,
        ),
        sql_pairs_preparation_service=SqlPairsPreparationService(
            pipelines={
                "sql_pairs_preparation": indexing.SqlPairs(
                    **pipe_components["sql_pairs_indexing"],
                ),
                "sql_pairs_deletion": indexing.SqlPairsDeletion(
                    **pipe_components["sql_pairs_deletion"],
                ),
            },
            **query_cache,
        ),
        sql_question_service=SqlQuestionService(
            pipelines={
                "sql_question_generation": generation.SQLQuestion(
                    **pipe_components["sql_question_generation"],
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
    """
    This service metadata is used for logging purposes and will be sent to Langfuse.
    """

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
