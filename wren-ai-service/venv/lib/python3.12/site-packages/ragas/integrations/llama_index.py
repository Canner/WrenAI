from __future__ import annotations

import logging
import typing as t

from ragas.dataset_schema import EvaluationDataset, SingleTurnSample
from ragas.embeddings import LlamaIndexEmbeddingsWrapper
from ragas.evaluation import evaluate as ragas_evaluate
from ragas.executor import Executor
from ragas.llms import LlamaIndexLLMWrapper
from ragas.run_config import RunConfig

if t.TYPE_CHECKING:
    from langchain_core.callbacks import Callbacks
    from llama_index.core.base.embeddings.base import (
        BaseEmbedding as LlamaIndexEmbeddings,
    )
    from llama_index.core.base.llms.base import BaseLLM as LlamaindexLLM

    from ragas.cost import TokenUsageParser
    from ragas.evaluation import EvaluationResult
    from ragas.metrics.base import Metric


logger = logging.getLogger(__name__)


def evaluate(
    query_engine,
    dataset: EvaluationDataset,
    metrics: list[Metric],
    llm: t.Optional[LlamaindexLLM] = None,
    embeddings: t.Optional[LlamaIndexEmbeddings] = None,
    callbacks: t.Optional[Callbacks] = None,
    in_ci: bool = False,
    run_config: t.Optional[RunConfig] = None,
    batch_size: t.Optional[int] = None,
    token_usage_parser: t.Optional[TokenUsageParser] = None,
    raise_exceptions: bool = False,
    column_map: t.Optional[t.Dict[str, str]] = None,
    show_progress: bool = True,
) -> EvaluationResult:
    column_map = column_map or {}

    # wrap llms and embeddings
    li_llm = None
    if llm is not None:
        li_llm = LlamaIndexLLMWrapper(llm, run_config=run_config)
    li_embeddings = None
    if embeddings is not None:
        li_embeddings = LlamaIndexEmbeddingsWrapper(embeddings, run_config=run_config)

    # validate and transform dataset
    if dataset is None or not isinstance(dataset, EvaluationDataset):
        raise ValueError("Please provide a dataset that is of type EvaluationDataset")

    exec = Executor(
        desc="Running Query Engine",
        keep_progress_bar=True,
        show_progress=show_progress,
        raise_exceptions=raise_exceptions,
        run_config=run_config,
        batch_size=batch_size,
    )

    # check if multi-turn
    if dataset.is_multi_turn():
        raise NotImplementedError(
            "Multi-turn evaluation is not implemented yet. Please do raise an issue on GitHub if you need this feature and we will prioritize it"
        )
    samples = t.cast(t.List[SingleTurnSample], dataset.samples)

    # get query and make jobs
    queries = [sample.user_input for sample in samples]
    for i, q in enumerate(queries):
        exec.submit(query_engine.aquery, q, name=f"query-{i}")

    # get responses and retrieved contexts
    responses: t.List[str] = []
    retrieved_contexts: t.List[t.List[str]] = []
    results = exec.results()
    for r in results:
        responses.append(r.response)
        retrieved_contexts.append([n.node.text for n in r.source_nodes])

    # append the extra information to the dataset
    for i, sample in enumerate(samples):
        sample.response = responses[i]
        sample.retrieved_contexts = retrieved_contexts[i]

    results = ragas_evaluate(
        dataset=dataset,
        metrics=metrics,
        llm=li_llm,
        embeddings=li_embeddings,
        raise_exceptions=raise_exceptions,
        callbacks=callbacks,
        show_progress=show_progress,
        run_config=run_config or RunConfig(),
        token_usage_parser=token_usage_parser,
    )

    return results
