import os

from dotenv import load_dotenv

from src.pipelines.ask import (
    generation_pipeline as ask_generation_pipeline,
)
from src.pipelines.ask import (
    indexing_pipeline as ask_indexing_pipeline,
)
from src.pipelines.ask import (
    retrieval_pipeline as ask_retrieval_pipeline,
)
from src.pipelines.ask.components.document_store import init_document_store
from src.pipelines.ask.components.embedder import init_embedder
from src.pipelines.ask.components.generator import init_generator
from src.pipelines.ask.components.retriever import init_retriever
from src.pipelines.ask_details import (
    generation_pipeline as ask_details_generation_pipeline,
)
from src.pipelines.ask_details.components.generator import (
    init_generator as init_ask_details_generator,
)
from src.pipelines.semantics import description
from src.web.v1.services.ask import AskService
from src.web.v1.services.ask_details import AskDetailsService
from src.web.v1.services.semantics import SemanticsService

load_dotenv()

SEMANTIC_SERVICE = None
ASK_SERVICE = None
ASK_DETAILS_SERVICE = None


def init_globals():
    global SEMANTIC_SERVICE, ASK_SERVICE, ASK_DETAILS_SERVICE

    with_trace = os.getenv("ENABLE_TRACE", default=False)

    document_store = init_document_store()
    embedder = init_embedder(with_trace=with_trace)
    retriever = init_retriever(
        document_store=document_store,
        with_trace=with_trace,
    )
    ask_text_to_sql_generator = init_generator(with_trace=with_trace)
    ask_sql_correction_generator = init_generator(with_trace=with_trace)
    ask_details_generator = init_ask_details_generator(with_trace=with_trace)

    SEMANTIC_SERVICE = SemanticsService(
        pipelines={
            "generate_description": description.Generation(),
        }
    )
    ASK_SERVICE = AskService(
        pipelines={
            "indexing": ask_indexing_pipeline.Indexing(
                document_store=document_store,
            ),
            "retrieval": ask_retrieval_pipeline.Retrieval(
                embedder=embedder,
                retriever=retriever,
                with_trace=with_trace,
            ),
            "generation": ask_generation_pipeline.Generation(
                text_to_sql_generator=ask_text_to_sql_generator,
                sql_correction_generator=ask_sql_correction_generator,
                with_trace=with_trace,
            ),
        }
    )
    ASK_DETAILS_SERVICE = AskDetailsService(
        pipelines={
            "generation": ask_details_generation_pipeline.Generation(
                generator=ask_details_generator,
                with_trace=with_trace,
            ),
        }
    )
