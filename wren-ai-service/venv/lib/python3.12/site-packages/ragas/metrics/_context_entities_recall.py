from __future__ import annotations

import logging
import typing as t
from dataclasses import dataclass, field
from typing import Dict

from pydantic import BaseModel

from ragas.dataset_schema import SingleTurnSample
from ragas.metrics.base import (
    MetricOutputType,
    MetricType,
    MetricWithLLM,
    SingleTurnMetric,
)
from ragas.prompt import PydanticPrompt, StringIO

if t.TYPE_CHECKING:
    from langchain.callbacks.base import Callbacks

logger = logging.getLogger(__name__)


class EntitiesList(BaseModel):
    entities: t.List[str]


class ExtractEntitiesPrompt(PydanticPrompt[StringIO, EntitiesList]):
    name: str = "text_entity_extraction"
    instruction: str = (
        "Given a text, extract unique entities without repetition. Ensure you consider different forms or mentions of the same entity as a single entity."
    )
    input_model = StringIO
    output_model = EntitiesList
    examples = [
        (
            StringIO(
                text="The Eiffel Tower, located in Paris, France, is one of the most iconic landmarks globally. Millions of visitors are attracted to it each year for its breathtaking views of the city. Completed in 1889, it was constructed in time for the 1889 World's Fair."
            ),
            EntitiesList(
                entities=["Eiffel Tower", "Paris", "France", "1889", "World's Fair"]
            ),
        ),
        (
            StringIO(
                text="The Colosseum in Rome, also known as the Flavian Amphitheatre, stands as a monument to Roman architectural and engineering achievement. Construction began under Emperor Vespasian in AD 70 and was completed by his son Titus in AD 80. It could hold between 50,000 and 80,000 spectators who watched gladiatorial contests and public spectacles."
            ),
            EntitiesList(
                entities=[
                    "Colosseum",
                    "Rome",
                    "Flavian Amphitheatre",
                    "Vespasian",
                    "AD 70",
                    "Titus",
                    "AD 80",
                ]
            ),
        ),
        (
            StringIO(
                text="The Great Wall of China, stretching over 21,196 kilometers from east to west, is a marvel of ancient defensive architecture. Built to protect against invasions from the north, its construction started as early as the 7th century BC. Today, it is a UNESCO World Heritage Site and a major tourist attraction."
            ),
            EntitiesList(
                entities=[
                    "Great Wall of China",
                    "21,196 kilometers",
                    "7th century BC",
                    "UNESCO World Heritage Site",
                ]
            ),
        ),
        (
            StringIO(
                text="The Apollo 11 mission, which launched on July 16, 1969, marked the first time humans landed on the Moon. Astronauts Neil Armstrong, Buzz Aldrin, and Michael Collins made history, with Armstrong being the first man to step on the lunar surface. This event was a significant milestone in space exploration."
            ),
            EntitiesList(
                entities=[
                    "Apollo 11 mission",
                    "July 16, 1969",
                    "Moon",
                    "Neil Armstrong",
                    "Buzz Aldrin",
                    "Michael Collins",
                ]
            ),
        ),
    ]


@dataclass
class ContextEntityRecall(MetricWithLLM, SingleTurnMetric):
    """
    Calculates recall based on entities present in ground truth and context.
    Let CN be the set of entities present in context,
    GN be the set of entities present in the ground truth.

    Then we define can the context entity recall as follows:
    Context Entity recall = | CN ∩ GN | / | GN |

    If this quantity is 1, we can say that the retrieval mechanism has
    retrieved context which covers all entities present in the ground truth,
    thus being a useful retrieval. Thus this can be used to evaluate retrieval
    mechanisms in specific use cases where entities matter, for example, a
    tourism help chatbot.

    Attributes
    ----------
    name : str
    batch_size : int
        Batch size for openai completion.
    """

    name: str = "context_entity_recall"
    _required_columns: t.Dict[MetricType, t.Set[str]] = field(
        default_factory=lambda: {
            MetricType.SINGLE_TURN: {"reference", "retrieved_contexts"}
        }
    )
    output_type = MetricOutputType.CONTINUOUS
    context_entity_recall_prompt: PydanticPrompt = field(
        default_factory=ExtractEntitiesPrompt
    )
    max_retries: int = 1

    def _compute_score(
        self, ground_truth_entities: t.Sequence[str], context_entities: t.Sequence[str]
    ) -> float:
        num_entities_in_both = len(
            set(context_entities).intersection(set(ground_truth_entities))
        )
        return num_entities_in_both / (len(ground_truth_entities) + 1e-8)

    async def get_entities(
        self,
        text: str,
        callbacks: Callbacks,
    ) -> EntitiesList:
        assert self.llm is not None, "LLM is not initialized"

        entities = await self.context_entity_recall_prompt.generate(
            llm=self.llm,
            data=StringIO(text=text),
            callbacks=callbacks,
        )

        return entities

    async def _single_turn_ascore(
        self, sample: SingleTurnSample, callbacks: Callbacks
    ) -> float:
        row = sample.to_dict()
        return await self._ascore(row, callbacks)

    async def _ascore(
        self,
        row: Dict,
        callbacks: Callbacks,
    ) -> float:
        ground_truth, contexts = row["reference"], row["retrieved_contexts"]
        ground_truth = await self.get_entities(ground_truth, callbacks=callbacks)
        contexts = await self.get_entities("\n".join(contexts), callbacks=callbacks)
        return self._compute_score(ground_truth.entities, contexts.entities)


context_entity_recall = ContextEntityRecall()
