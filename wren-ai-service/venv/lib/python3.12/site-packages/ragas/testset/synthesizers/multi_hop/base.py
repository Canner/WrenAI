from __future__ import annotations

import logging
import random
import typing as t
from collections import defaultdict
from dataclasses import dataclass

from ragas import SingleTurnSample
from ragas.prompt import PydanticPrompt
from ragas.testset.persona import Persona, PersonaList
from ragas.testset.synthesizers.base import (
    BaseScenario,
    BaseSynthesizer,
    QueryLength,
    QueryStyle,
    Scenario,
)
from ragas.testset.synthesizers.multi_hop.prompts import (
    QueryAnswerGenerationPrompt,
    QueryConditions,
)

if t.TYPE_CHECKING:
    from langchain_core.callbacks import Callbacks

logger = logging.getLogger(__name__)


class MultiHopScenario(BaseScenario):
    """
    Scenario for multi-hop queries.

    Attributes
    ----------
    combinations: str
        The theme of the query.
    style: QueryStyle
        The style of the query.
    length: QueryLength
        The length of the query.
    """

    combinations: t.List[str]

    def __repr__(self) -> str:
        return f"MultiHopScenario(\nnodes={len(self.nodes)}\ncombinations={self.combinations}\nstyle={self.style}\nlength={self.length}\npersona={self.persona})"


@dataclass
class MultiHopQuerySynthesizer(BaseSynthesizer[Scenario]):

    generate_query_reference_prompt: PydanticPrompt = QueryAnswerGenerationPrompt()

    def prepare_combinations(
        self,
        nodes,
        combinations: t.List[t.List[str]],
        personas: t.List[Persona],
        persona_item_mapping: t.Dict[str, t.List[str]],
        property_name: str,
    ) -> t.List[t.Dict[str, t.Any]]:

        persona_list = PersonaList(personas=personas)
        possible_combinations = []
        for combination in combinations:
            dict = {"combination": combination}
            valid_personas = []
            for persona, concept_list in persona_item_mapping.items():
                concept_list = [c.lower() for c in concept_list]
                if (
                    any(concept.lower() in concept_list for concept in combination)
                    and persona_list[persona]
                ):
                    valid_personas.append(persona_list[persona])
            dict["personas"] = valid_personas
            valid_nodes = []
            for node in nodes:
                node_themes = [
                    theme.lower() for theme in node.properties.get(property_name, [])
                ]
                if node.get_property(property_name) and any(
                    concept.lower() in node_themes for concept in combination
                ):
                    valid_nodes.append(node)

            dict["nodes"] = valid_nodes
            dict["styles"] = list(QueryStyle)
            dict["lengths"] = list(QueryLength)

            possible_combinations.append(dict)
        return possible_combinations

    def sample_diverse_combinations(
        self, data: t.List[t.Dict[str, t.Any]], num_samples: int
    ) -> t.List[MultiHopScenario]:

        if num_samples < 1:
            raise ValueError("number of samples to generate should be greater than 0")

        selected_samples = []
        combination_persona_count = defaultdict(set)
        style_count = defaultdict(int)
        length_count = defaultdict(int)

        all_possible_samples = []

        for entry in data:
            combination = tuple(entry["combination"])
            nodes = entry["nodes"]

            for persona in entry["personas"]:
                for style in entry["styles"]:
                    for length in entry["lengths"]:
                        all_possible_samples.append(
                            {
                                "combination": combination,
                                "persona": persona,
                                "nodes": nodes,
                                "style": style,
                                "length": length,
                            }
                        )

        random.shuffle(all_possible_samples)

        for sample in all_possible_samples:
            if len(selected_samples) >= num_samples:
                break

            combination = sample["combination"]
            persona = sample["persona"]
            style = sample["style"]
            length = sample["length"]

            if persona.name not in combination_persona_count[combination]:
                selected_samples.append(sample)
                combination_persona_count[combination].add(persona.name)

            elif style_count[style] < max(style_count.values(), default=0) + 1:
                selected_samples.append(sample)
                style_count[style] += 1

            elif length_count[length] < max(length_count.values(), default=0) + 1:
                selected_samples.append(sample)
                length_count[length] += 1

        return [self.convert_to_scenario(sample) for sample in selected_samples]

    def convert_to_scenario(self, data: t.Dict[str, t.Any]) -> MultiHopScenario:

        return MultiHopScenario(
            nodes=data["nodes"],
            combinations=data["combination"],
            style=data["style"],
            length=data["length"],
            persona=data["persona"],
        )

    async def _generate_sample(
        self, scenario: MultiHopScenario, callbacks: Callbacks
    ) -> SingleTurnSample:

        reference_context = self.make_contexts(scenario)
        prompt_input = QueryConditions(
            persona=scenario.persona,
            themes=scenario.combinations,
            context=reference_context,
            query_length=scenario.length.name,
            query_style=scenario.style.name,
        )
        response = await self.generate_query_reference_prompt.generate(
            data=prompt_input, llm=self.llm, callbacks=callbacks
        )
        return SingleTurnSample(
            user_input=response.query,
            reference=response.answer,
            reference_contexts=reference_context,
        )

    def make_contexts(self, scenario: MultiHopScenario) -> t.List[str]:

        contexts = []
        for i, node in enumerate(scenario.nodes):
            context = f"<{i+1}-hop>" + "\n\n" + node.properties.get("page_content", "")
            contexts.append(context)

        return contexts
