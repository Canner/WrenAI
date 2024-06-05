import os
from typing import Callable, Tuple

from redislite import StrictRedis

from src.core.provider import DocumentStoreProvider, LLMProvider
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
    indexing as ask_indexing,
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
from src.pipelines.semantics import description
from src.utils import init_providers
from src.web.v1.services.ask import AskService
from src.web.v1.services.ask_details import AskDetailsService
from src.web.v1.services.semantics import SemanticsService

SEMANTIC_SERVICE = None
ASK_SERVICE = None
ASK_DETAILS_SERVICE = None
SQL_EXPLANATION_SERVICE = None
SQL_REGENERATION_SERVICE = None

REDIS_DB = None


def init_globals(
    init_providers: Callable[
        [], Tuple[LLMProvider, DocumentStoreProvider]
    ] = init_providers,
):
    global \
        SEMANTIC_SERVICE, \
        ASK_SERVICE, \
        ASK_DETAILS_SERVICE, \
        SQL_EXPLANATION_SERVICE, \
        SQL_REGENERATION_SERVICE, \
        REDIS_DB

    REDIS_DB = (
        StrictRedis(
            host=os.getenv("REDIS_HOST", "redis"),
            port=int(os.getenv("REDIS_PORT", 6379)),
        )
        if int(os.getenv("WORKERS")) > 1
        else StrictRedis(
            "./redis.db",
        )
    )

    llm_provider, document_store_provider = init_providers()

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
            "indexing": ask_indexing.Indexing(
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
            ),
            "sql_correction": ask_sql_correction.SQLCorrection(
                llm_provider=llm_provider,
            ),
            "followup_generation": ask_followup_generation.FollowUpGeneration(
                llm_provider=llm_provider,
            ),
        },
        redis_db=REDIS_DB,
    )

    ASK_DETAILS_SERVICE = AskDetailsService(
        pipelines={
            "generation": ask_details_generation.Generation(
                llm_provider=llm_provider,
            ),
        },
        redis_db=REDIS_DB,
    )
