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
    query_understanding as ask_query_understanding,
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
from src.pipelines.semantics import description
from src.utils import init_providers
from src.web.v1.services.ask import AskService
from src.web.v1.services.ask_details import AskDetailsService
from src.web.v1.services.semantics import SemanticsService

SEMANTIC_SERVICE = None
ASK_SERVICE = None
ASK_DETAILS_SERVICE = None


def init_globals():
    global SEMANTIC_SERVICE, ASK_SERVICE, ASK_DETAILS_SERVICE

    llm_provider, document_store_provider, engine = init_providers()

    # Recreate the document store to ensure a clean slate
    # TODO: for SaaS, we need to use a flag to prevent this collection_recreation
    document_store_provider.get_store(recreate_index=True)
    document_store_provider.get_store(
        dataset_name="view_questions", recreate_index=True
    )

    SEMANTIC_SERVICE = SemanticsService(
        pipelines={
            "generate_description": description.Generation(
                llm_provider=llm_provider,
                document_store_provider=document_store_provider,
            ),
        },
    )

    ASK_SERVICE = AskService(
        pipelines={
            "indexing": indexing.Indexing(
                llm_provider=llm_provider,
                document_store_provider=document_store_provider,
            ),
            "query_understanding": ask_query_understanding.QueryUnderstanding(
                llm_provider=llm_provider,
            ),
            "retrieval": ask_retrieval.Retrieval(
                llm_provider=llm_provider,
                document_store_provider=document_store_provider,
            ),
            "historical_question": historical_question.HistoricalQuestion(
                llm_provider=llm_provider,
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
