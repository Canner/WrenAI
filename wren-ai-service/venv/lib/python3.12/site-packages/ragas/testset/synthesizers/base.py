from __future__ import annotations

import typing as t
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum

from pydantic import BaseModel

from ragas.callbacks import new_group
from ragas.llms import BaseRagasLLM, llm_factory
from ragas.prompt import PromptMixin
from ragas.testset.graph import KnowledgeGraph, Node
from ragas.testset.persona import Persona

if t.TYPE_CHECKING:
    from langchain_core.callbacks import Callbacks

    from ragas.dataset_schema import BaseSample


class QueryLength(str, Enum):
    """
    Enumeration of query lengths. Available options are: LONG, MEDIUM, SHORT
    """

    LONG = "long"
    MEDIUM = "medium"
    SHORT = "short"


class QueryStyle(str, Enum):
    """
    Enumeration of query styles. Available options are: MISSPELLED, PERFECT_GRAMMAR, POOR_GRAMMAR, WEB_SEARCH_LIKE
    """

    MISSPELLED = "Misspelled queries"
    PERFECT_GRAMMAR = "Perfect grammar"
    POOR_GRAMMAR = "Poor grammar"
    WEB_SEARCH_LIKE = "Web search like queries"


class BaseScenario(BaseModel):
    """
    Base class for representing a scenario for generating test samples.

    Attributes
    ----------
    nodes : List[Node]
        List of nodes involved in the scenario.
    style : QueryStyle
        The style of the query.
    length : QueryLength
        The length of the query.
    persona : Persona
        A persona associated with the scenario.
    """

    nodes: t.List[Node]
    style: QueryStyle
    length: QueryLength
    persona: Persona


Scenario = t.TypeVar("Scenario", bound=BaseScenario)


@dataclass
class BaseSynthesizer(ABC, t.Generic[Scenario], PromptMixin):
    """
    Base class for synthesizing scenarios and samples.
    """

    name: str = ""
    llm: BaseRagasLLM = field(default_factory=llm_factory)

    def __post_init__(self):
        if not self.name:
            self.name = self.__class__.__name__

    async def generate_scenarios(
        self,
        n: int,
        knowledge_graph: KnowledgeGraph,
        persona_list: t.List[Persona],
        callbacks: t.Optional[Callbacks] = None,
    ) -> t.List[Scenario]:
        callbacks = callbacks or []
        scenario_generation_rm, scenario_generation_group = new_group(
            name=self.name,
            inputs={"n": n, "knowledge_graph": str(knowledge_graph)},
            callbacks=callbacks,
        )
        scenarios = await self._generate_scenarios(
            n, knowledge_graph, persona_list, scenario_generation_group
        )
        scenario_generation_rm.on_chain_end(outputs={"scenarios": scenarios})
        return scenarios

    @abstractmethod
    async def _generate_scenarios(
        self,
        n: int,
        knowledge_graph: KnowledgeGraph,
        persona_list: t.List[Persona],
        callbacks: Callbacks,
    ) -> t.List[Scenario]:
        pass

    async def generate_sample(
        self, scenario: Scenario, callbacks: t.Optional[Callbacks] = None
    ) -> BaseSample:
        callbacks = callbacks or []

        # new group for Sample Generation
        sample_generation_rm, sample_generation_grp = new_group(
            name=self.name,
            inputs={"scenario": scenario},
            callbacks=callbacks,
        )
        sample = await self._generate_sample(scenario, sample_generation_grp)
        sample_generation_rm.on_chain_end(outputs={"sample": sample})

        return sample

    @abstractmethod
    async def _generate_sample(
        self, scenario: Scenario, callbacks: Callbacks
    ) -> BaseSample:
        pass
