from __future__ import annotations

import logging
import typing as t
from dataclasses import dataclass

import numpy as np

from ragas.prompt import PydanticPrompt
from ragas.testset.graph import KnowledgeGraph, Node
from ragas.testset.graph_queries import get_child_nodes
from ragas.testset.persona import Persona
from ragas.testset.synthesizers.multi_hop.base import (
    MultiHopQuerySynthesizer,
    MultiHopScenario,
)
from ragas.testset.synthesizers.multi_hop.prompts import (
    ConceptCombinationPrompt,
    ConceptsList,
)
from ragas.testset.synthesizers.prompts import (
    ThemesPersonasInput,
    ThemesPersonasMatchingPrompt,
)

if t.TYPE_CHECKING:
    from langchain_core.callbacks import Callbacks

logger = logging.getLogger(__name__)


@dataclass
class MultiHopAbstractQuerySynthesizer(MultiHopQuerySynthesizer):
    """
    Synthesizes abstract multi-hop queries from given knowledge graph.

    Attributes
    ----------
    """

    name: str = "multi_hop_abstract_query_synthesizer"
    concept_combination_prompt: PydanticPrompt = ConceptCombinationPrompt()
    theme_persona_matching_prompt: PydanticPrompt = ThemesPersonasMatchingPrompt()

    def get_node_clusters(self, knowledge_graph: KnowledgeGraph) -> t.List[t.Set[Node]]:

        node_clusters = knowledge_graph.find_indirect_clusters(
            relationship_condition=lambda rel: (
                True if rel.get_property("summary_similarity") else False
            ),
            depth_limit=3,
        )
        logger.info("found %d clusters", len(node_clusters))
        return node_clusters

    async def _generate_scenarios(
        self,
        n: int,
        knowledge_graph: KnowledgeGraph,
        persona_list: t.List[Persona],
        callbacks: Callbacks,
    ) -> t.List[MultiHopScenario]:
        """
        Generates a list of scenarios on type MultiHopAbstractQuerySynthesizer
        Steps to generate scenarios:
        1. Find indirect clusters of nodes based on relationship condition
        2. Calculate the number of samples that should be created per cluster to get n samples in total
        3. For each cluster of nodes
            a. Find the child nodes of the cluster nodes
            b. Find list of personas that can be associated with the entities to create query
            c. Create all possible combinations of (nodes, entities, personas, style, length) as scenarios
        4. Sample diverse combinations of scenarios to get n samples
        """

        node_clusters = self.get_node_clusters(knowledge_graph)
        scenarios = []

        if len(node_clusters) == 0:
            raise ValueError(
                "No clusters found in the knowledge graph. Try changing the relationship condition."
            )
        num_sample_per_cluster = int(np.ceil(n / len(node_clusters)))

        for cluster in node_clusters:
            if len(scenarios) >= n:
                break
            nodes = []
            for node in cluster:
                child_nodes = get_child_nodes(node, knowledge_graph, level=1)
                if child_nodes:
                    nodes.extend(child_nodes)
                else:
                    nodes.append(node)

            base_scenarios = []
            node_themes = [node.properties.get("themes", []) for node in nodes]
            prompt_input = ConceptsList(
                lists_of_concepts=node_themes, max_combinations=num_sample_per_cluster
            )
            concept_combination = await self.concept_combination_prompt.generate(
                data=prompt_input, llm=self.llm, callbacks=callbacks
            )
            flattened_themes = [
                theme
                for sublist in concept_combination.combinations
                for theme in sublist
            ]
            prompt_input = ThemesPersonasInput(
                themes=flattened_themes, personas=persona_list
            )
            persona_concepts = await self.theme_persona_matching_prompt.generate(
                data=prompt_input, llm=self.llm, callbacks=callbacks
            )

            base_scenarios = self.prepare_combinations(
                nodes,
                concept_combination.combinations,
                personas=persona_list,
                persona_item_mapping=persona_concepts.mapping,
                property_name="themes",
            )
            base_scenarios = self.sample_diverse_combinations(
                base_scenarios, num_sample_per_cluster
            )
            scenarios.extend(base_scenarios)

        return scenarios
