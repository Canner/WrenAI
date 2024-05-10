from typing import Callable, Tuple

from dotenv import load_dotenv

from src.core.document_store_provider import DocumentStoreProvider
from src.core.llm_provider import LLMProvider
from src.pipelines.ask import (
    followup_generation_pipeline as ask_followup_generation_pipeline,
)
from src.pipelines.ask import (
    generation_pipeline as ask_generation_pipeline,
)
from src.pipelines.ask import (
    indexing_pipeline as ask_indexing_pipeline,
)
from src.pipelines.ask import (
    query_understanding_pipeline as ask_query_understanding_pipeline,
)
from src.pipelines.ask import (
    retrieval_pipeline as ask_retrieval_pipeline,
)
from src.pipelines.ask import (
    sql_correction_pipeline as ask_sql_correction_pipeline,
)
from src.pipelines.ask.components.prompts import text_to_sql_system_prompt
from src.pipelines.ask_details import (
    generation_pipeline as ask_details_generation_pipeline,
)
from src.pipelines.ask_details.components.prompts import ask_details_system_prompt
from src.pipelines.semantics import description
from src.utils import init_providers
from src.web.v1.services.ask import AskService
from src.web.v1.services.ask_details import AskDetailsService
from src.web.v1.services.semantics import SemanticsService

load_dotenv()

SEMANTIC_SERVICE = None
ASK_SERVICE = None
ASK_DETAILS_SERVICE = None


def init_globals(
    init_providers: Callable[
        [], Tuple[LLMProvider, DocumentStoreProvider]
    ] = init_providers,
):
    global SEMANTIC_SERVICE, ASK_SERVICE, ASK_DETAILS_SERVICE

    llm_provider, document_store_provider = init_providers()

    document_store = document_store_provider.get_store()
    view_store = document_store_provider.get_store(dataset_name="view_questions")
    embedder = llm_provider.get_embedder()
    retriever = document_store_provider.get_retriever(document_store=document_store)
    query_understanding_generator = llm_provider.get_generator()
    text_to_sql_generator = llm_provider.get_generator(
        system_prompt=text_to_sql_system_prompt
    )
    text_to_sql_with_followup_generator = llm_provider.get_generator(
        system_prompt=text_to_sql_system_prompt
    )
    sql_correction_generator = llm_provider.get_generator(
        system_prompt=text_to_sql_system_prompt
    )
    sql_details_generator = llm_provider.get_generator(
        system_prompt=ask_details_system_prompt
    )

    SEMANTIC_SERVICE = SemanticsService(
        pipelines={
            "generate_description": description.Generation(),
        }
    )
    ASK_SERVICE = AskService(
        pipelines={
            "indexing": ask_indexing_pipeline.Indexing(
                ddl_store=document_store,
                view_store=view_store,
            ),
            "query_understanding": ask_query_understanding_pipeline.QueryUnderstanding(
                generator=query_understanding_generator,
            ),
            "retrieval": ask_retrieval_pipeline.Retrieval(
                embedder=embedder,
                retriever=retriever,
            ),
            "generation": ask_generation_pipeline.Generation(
                generator=text_to_sql_generator,
            ),
            "sql_correction": ask_sql_correction_pipeline.SQLCorrection(
                generator=sql_correction_generator,
            ),
            "followup_generation": ask_followup_generation_pipeline.FollowUpGeneration(
                generator=text_to_sql_with_followup_generator,
            ),
        }
    )
    ASK_DETAILS_SERVICE = AskDetailsService(
        pipelines={
            "generation": ask_details_generation_pipeline.Generation(
                generator=sql_details_generator,
            ),
        }
    )
