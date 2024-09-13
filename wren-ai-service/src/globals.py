from typing import Optional

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

SEMANTICS_PREPARATION_SERVICE = None
ASK_SERVICE = None
SQL_ANSWER_SERVICE = None
SQL_EXPANSION_SERVICE = None
ASK_DETAILS_SERVICE = None
SQL_EXPLANATION_SERVICE = None
SQL_REGENERATION_SERVICE = None


def init_globals(
    llm_provider: LLMProvider,
    embedder_provider: EmbedderProvider,
    document_store_provider: DocumentStoreProvider,
    engine: Engine,
    should_force_deploy: Optional[str] = None,
    column_indexing_batch_size: Optional[int] = 50,
    table_retrieval_size: Optional[int] = 10,
    table_column_retrieval_size: Optional[int] = 1000,
    query_cache: Optional[dict] = {},
):
    global \
        SEMANTICS_PREPARATION_SERVICE, \
        ASK_SERVICE, \
        SQL_ANSWER_SERVICE, \
        SQL_EXPANSION_SERVICE, \
        ASK_DETAILS_SERVICE, \
        SQL_EXPLANATION_SERVICE, \
        SQL_REGENERATION_SERVICE

    if should_force_deploy:
        document_store_provider.get_store(recreate_index=True)
        document_store_provider.get_store(
            dataset_name="table_descriptions", recreate_index=True
        )
        document_store_provider.get_store(
            dataset_name="view_questions", recreate_index=True
        )

    SEMANTICS_PREPARATION_SERVICE = SemanticsPreparationService(
        pipelines={
            "indexing": indexing.Indexing(
                embedder_provider=embedder_provider,
                document_store_provider=document_store_provider,
                column_indexing_batch_size=column_indexing_batch_size,
            ),
        },
        **query_cache,
    )

    ASK_SERVICE = AskService(
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
    )

    SQL_ANSWER_SERVICE = SqlAnswerService(
        pipelines={
            "sql_answer": sql_answer.SQLAnswer(
                llm_provider=llm_provider,
                engine=engine,
            )
        },
        **query_cache,
    )

    ASK_DETAILS_SERVICE = AskDetailsService(
        pipelines={
            "sql_breakdown": sql_breakdown.SQLBreakdown(
                llm_provider=llm_provider,
                engine=engine,
            ),
        },
        **query_cache,
    )

    SQL_EXPANSION_SERVICE = SqlExpansionService(
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
    )

    SQL_EXPLANATION_SERVICE = SQLExplanationService(
        pipelines={
            "sql_explanation": sql_explanation.SQLExplanation(
                llm_provider=llm_provider,
            )
        },
        **query_cache,
    )

    SQL_REGENERATION_SERVICE = SQLRegenerationService(
        pipelines={
            "sql_regeneration": sql_regeneration.SQLRegeneration(
                llm_provider=llm_provider,
                engine=engine,
            )
        },
        **query_cache,
    )
