import typing as t

from ragas.llms import BaseRagasLLM
from ragas.testset.graph import KnowledgeGraph
from ragas.testset.synthesizers.multi_hop import (
    MultiHopAbstractQuerySynthesizer,
    MultiHopSpecificQuerySynthesizer,
)
from ragas.testset.synthesizers.single_hop.specific import (
    SingleHopSpecificQuerySynthesizer,
)

from .base import BaseSynthesizer

QueryDistribution = t.List[t.Tuple[BaseSynthesizer, float]]


def default_query_distribution(
    llm: BaseRagasLLM, kg: t.Optional[KnowledgeGraph] = None
) -> QueryDistribution:
    """ """
    default_queries = [
        SingleHopSpecificQuerySynthesizer(llm=llm),
        MultiHopAbstractQuerySynthesizer(llm=llm),
        MultiHopSpecificQuerySynthesizer(llm=llm),
    ]
    if kg is not None:
        available_queries = []
        for query in default_queries:
            if query.get_node_clusters(kg):
                available_queries.append(query)
    else:
        available_queries = default_queries

    return [(query, 1 / len(available_queries)) for query in available_queries]


__all__ = [
    "BaseSynthesizer",
    "default_query_distribution",
]
