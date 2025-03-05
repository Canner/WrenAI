import typing as t
from dataclasses import dataclass

import numpy as np

from ragas.testset.graph import KnowledgeGraph, NodeType, Relationship
from ragas.testset.transforms.base import RelationshipBuilder


@dataclass
class CosineSimilarityBuilder(RelationshipBuilder):
    property_name: str = "embedding"
    new_property_name: str = "cosine_similarity"
    threshold: float = 0.9

    def _find_similar_embedding_pairs(
        self, embeddings: np.ndarray, threshold: float
    ) -> t.List[t.Tuple[int, int, float]]:
        # Normalize the embeddings
        normalized = embeddings / np.linalg.norm(embeddings, axis=1)[:, np.newaxis]

        # Calculate cosine similarity matrix
        similarity_matrix = np.dot(normalized, normalized.T)
        # Find pairs with similarity >= threshold
        similar_pairs = np.argwhere(similarity_matrix >= threshold)

        # Filter out self-comparisons and duplicate pairs
        return [
            (pair[0], pair[1], similarity_matrix[pair[0], pair[1]])
            for pair in similar_pairs
            if pair[0] < pair[1]
        ]

    async def transform(self, kg: KnowledgeGraph) -> t.List[Relationship]:
        if self.property_name is None:
            self.property_name = "embedding"

        embeddings = []
        for node in kg.nodes:
            embedding = node.get_property(self.property_name)
            if embedding is None:
                raise ValueError(f"Node {node.id} has no {self.property_name}")
            embeddings.append(embedding)

        similar_pairs = self._find_similar_embedding_pairs(
            np.array(embeddings), self.threshold
        )

        return [
            Relationship(
                source=kg.nodes[i],
                target=kg.nodes[j],
                type="cosine_similarity",
                properties={self.new_property_name: similarity_float},
                bidirectional=True,
            )
            for i, j, similarity_float in similar_pairs
        ]


@dataclass
class SummaryCosineSimilarityBuilder(CosineSimilarityBuilder):
    property_name: str = "summary_embedding"
    new_property_name: str = "summary_cosine_similarity"
    threshold: float = 0.1

    def filter(self, kg: KnowledgeGraph) -> KnowledgeGraph:
        """
        Filters the knowledge graph to only include nodes with a summary embedding.
        """
        nodes = []
        for node in kg.nodes:
            if node.type == NodeType.DOCUMENT:
                emb = node.get_property(self.property_name)
                if emb is None:
                    raise ValueError(f"Node {node.id} has no {self.property_name}")
                nodes.append(node)
        return KnowledgeGraph(nodes=nodes)

    async def transform(self, kg: KnowledgeGraph) -> t.List[Relationship]:
        embeddings = [
            node.get_property(self.property_name)
            for node in kg.nodes
            if node.get_property(self.property_name) is not None
        ]
        if not embeddings:
            raise ValueError(f"No nodes have a valid {self.property_name}")
        similar_pairs = self._find_similar_embedding_pairs(
            np.array(embeddings), self.threshold
        )
        return [
            Relationship(
                source=kg.nodes[i],
                target=kg.nodes[j],
                type="summary_cosine_similarity",
                properties={self.new_property_name: similarity_float},
                bidirectional=True,
            )
            for i, j, similarity_float in similar_pairs
        ]
