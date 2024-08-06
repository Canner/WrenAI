from src.core.engine import Engine
from src.core.provider import DocumentStoreProvider, EmbedderProvider, LLMProvider
from src.pipelines.ask import (
    followup_generation as ask_followup_generation,
)
from src.pipelines.ask import (
    generation as ask_generation,
)
from src.pipelines.ask import (
    historical_question,
)
from src.pipelines.ask import (
    retrieval as ask_retrieval,
)
from src.pipelines.ask import (
    sql_correction as ask_sql_correction,
)
from src.pipelines.ask_details import (
    generation as ask_details_generation,
)
from src.pipelines.indexing import (
    indexing,
)
from src.pipelines.sql_explanation import (
    generation as sql_explanation_generation,
)
from src.pipelines.sql_regeneration import (
    generation as sql_regeneration,
)
from src.web.v1.services.ask import AskService
from src.web.v1.services.ask_details import AskDetailsService
from src.web.v1.services.indexing import IndexingService
from src.web.v1.services.sql_explanation import SQLExplanationService
from src.web.v1.services.sql_regeneration import SQLRegenerationService

INDEXING_SERVICE = None
ASK_SERVICE = None
ASK_DETAILS_SERVICE = None
SQL_EXPLANATION_SERVICE = None
SQL_REGENERATION_SERVICE = None


def init_globals(
    llm_provider: LLMProvider,
    embedder_provider: EmbedderProvider,
    document_store_provider: DocumentStoreProvider,
    engine: Engine,
):
    global \
        INDEXING_SERVICE, \
        ASK_SERVICE, \
        ASK_DETAILS_SERVICE, \
        SQL_EXPLANATION_SERVICE, \
        SQL_REGENERATION_SERVICE

    # Recreate the document store to ensure a clean slate
    # TODO: for SaaS, we need to use a flag to prevent this collection_recreation
    document_store_provider.get_store(recreate_index=True)
    document_store_provider.get_store(
        dataset_name="view_questions", recreate_index=True
    )

    INDEXING_SERVICE = IndexingService(
        pipelines={
            "indexing": indexing.Indexing(
                embedder_provider=embedder_provider,
                document_store_provider=document_store_provider,
            ),
        },
    )

    ASK_SERVICE = AskService(
        pipelines={
            "retrieval": ask_retrieval.Retrieval(
                embedder_provider=embedder_provider,
                document_store_provider=document_store_provider,
            ),
            "historical_question": historical_question.HistoricalQuestion(
                embedder_provider=embedder_provider,
                store_provider=document_store_provider,
            ),
            "generation": ask_generation.Generation(
                llm_provider=llm_provider,
                engine=engine,
            ),
            "sql_correction": ask_sql_correction.SQLCorrection(
                llm_provider=llm_provider,
                engine=engine,
            ),
            "followup_generation": ask_followup_generation.FollowUpGeneration(
                llm_provider=llm_provider,
                engine=engine,
            ),
        },
    )

    ASK_DETAILS_SERVICE = AskDetailsService(
        pipelines={
            "generation": ask_details_generation.Generation(
                llm_provider=llm_provider,
                engine=engine,
            ),
        },
    )

    SQL_EXPLANATION_SERVICE = SQLExplanationService(
        pipelines={
            "generation": sql_explanation_generation.Generation(
                llm_provider=llm_provider,
            )
        }
    )

    SQL_REGENERATION_SERVICE = SQLRegenerationService(
        pipelines={
            "generation": sql_regeneration.Generation(
                llm_provider=llm_provider,
                engine=engine,
            )
        }
    )
