from dotenv import load_dotenv

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
    retrieval_pipeline as ask_retrieval_pipeline,
)
from src.pipelines.ask import (
    sql_correction_pipeline as ask_sql_correction_pipeline,
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

    document_store = init_document_store()
    embedder = init_embedder()
    retriever = init_retriever(
        document_store=document_store,
    )
    text_to_sql_generator = init_generator()
    text_to_sql_with_followup_generator = init_generator()
    sql_correction_generator = init_generator()
    sql_details_generator = init_ask_details_generator()

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
