import typing as t
from collections import Counter
from dataclasses import dataclass

from ragas.metrics._string import DistanceMeasure
from ragas.testset.graph import KnowledgeGraph, Node, Relationship
from ragas.testset.transforms.base import RelationshipBuilder


@dataclass
class JaccardSimilarityBuilder(RelationshipBuilder):
    property_name: str = "entities"
    key_name: t.Optional[str] = None
    new_property_name: str = "jaccard_similarity"
    threshold: float = 0.5

    def _jaccard_similarity(self, set1: t.Set[str], set2: t.Set[str]) -> float:
        intersection = len(set1.intersection(set2))
        union = len(set1.union(set2))
        return intersection / union if union > 0 else 0.0

    async def transform(self, kg: KnowledgeGraph) -> t.List[Relationship]:
        if self.property_name is None:
            self.property_name

        similar_pairs = []
        for i, node1 in enumerate(kg.nodes):
            for j, node2 in enumerate(kg.nodes):
                if i >= j:
                    continue
                items1 = node1.get_property(self.property_name)
                items2 = node2.get_property(self.property_name)
                if items1 is None or items2 is None:
                    raise ValueError(
                        f"Node {node1.id} or {node2.id} has no {self.property_name}"
                    )
                if self.key_name is not None:
                    items1 = items1.get(self.key_name, [])
                    items2 = items2.get(self.key_name, [])
                similarity = self._jaccard_similarity(set(items1), set(items2))
                if similarity >= self.threshold:
                    similar_pairs.append((i, j, similarity))

        return [
            Relationship(
                source=kg.nodes[i],
                target=kg.nodes[j],
                type="jaccard_similarity",
                properties={self.new_property_name: similarity_float},
                bidirectional=True,
            )
            for i, j, similarity_float in similar_pairs
        ]


@dataclass
class OverlapScoreBuilder(RelationshipBuilder):
    property_name: str = "entities"
    key_name: t.Optional[str] = None
    new_property_name: str = "overlap_score"
    distance_measure: DistanceMeasure = DistanceMeasure.JARO_WINKLER
    distance_threshold: float = 0.9
    threshold: float = 0.01

    def __post_init__(self):
        try:
            from rapidfuzz import distance
        except ImportError:
            raise ImportError(
                "rapidfuzz is required for string distance. Please install it using `pip install rapidfuzz`"
            )

        self.distance_measure_map = {
            DistanceMeasure.LEVENSHTEIN: distance.Levenshtein,
            DistanceMeasure.HAMMING: distance.Hamming,
            DistanceMeasure.JARO: distance.Jaro,
            DistanceMeasure.JARO_WINKLER: distance.JaroWinkler,
        }

    def _overlap_score(self, overlaps: t.List[bool]) -> float:

        return sum(overlaps) / len(overlaps) if len(overlaps) > 0 else 0.0

    def _get_noisy_items(
        self, nodes: t.List[Node], property_name: str, percent_cut_off: float = 0.05
    ) -> t.List[str]:

        all_items = []
        for node in nodes:
            items = node.get_property(property_name)
            if items is not None:
                if isinstance(items, str):
                    all_items.append(items)
                elif isinstance(items, list):
                    all_items.extend(items)
                else:
                    pass

        num_unique_items = len(set(all_items))
        num_noisy_items = max(1, int(num_unique_items * percent_cut_off))
        noisy_list = list(dict(Counter(all_items).most_common()).keys())[
            :num_noisy_items
        ]
        return noisy_list

    async def transform(self, kg: KnowledgeGraph) -> t.List[Relationship]:
        if self.property_name is None:
            self.property_name

        distance_measure = self.distance_measure_map[self.distance_measure]
        noisy_items = self._get_noisy_items(kg.nodes, self.property_name)
        relationships = []
        for i, node_x in enumerate(kg.nodes):
            for j, node_y in enumerate(kg.nodes):
                if i >= j:
                    continue
                node_x_items = node_x.get_property(self.property_name)
                node_y_items = node_y.get_property(self.property_name)
                if node_x_items is None or node_y_items is None:
                    raise ValueError(
                        f"Node {node_x.id} or {node_y.id} has no {self.property_name}"
                    )
                if self.key_name is not None:
                    node_x_items = node_x_items.get(self.key_name, [])
                    node_y_items = node_y_items.get(self.key_name, [])

                overlaps = []
                overlapped_items = []
                for x in node_x_items:
                    if x not in noisy_items:
                        for y in node_y_items:
                            if y not in noisy_items:
                                similarity = 1 - distance_measure.distance(
                                    x.lower(), y.lower()
                                )
                                verdict = similarity >= self.distance_threshold
                                overlaps.append(verdict)
                                if verdict:
                                    overlapped_items.append((x, y))

                similarity = self._overlap_score(overlaps)
                if similarity >= self.threshold:
                    relationships.append(
                        Relationship(
                            source=node_x,
                            target=node_y,
                            type=f"{self.property_name}_overlap",
                            properties={
                                f"{self.property_name}_{self.new_property_name}": similarity,
                                "overlapped_items": overlapped_items,
                            },
                        )
                    )

        return relationships
