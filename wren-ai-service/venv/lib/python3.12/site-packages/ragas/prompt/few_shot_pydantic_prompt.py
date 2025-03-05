from __future__ import annotations

import typing as t
from abc import ABC, abstractmethod
from dataclasses import dataclass, field

import numpy as np
from pydantic import BaseModel

from ragas.llms.base import BaseRagasLLM
from ragas.prompt.pydantic_prompt import PydanticPrompt

if t.TYPE_CHECKING:
    from langchain_core.callbacks import Callbacks

    from ragas.embeddings.base import BaseRagasEmbeddings
    from ragas.llms.base import BaseRagasLLM

# type variables for input and output models
InputModel = t.TypeVar("InputModel", bound=BaseModel)
OutputModel = t.TypeVar("OutputModel", bound=BaseModel)


class ExampleStore(ABC):
    @abstractmethod
    def get_examples(
        self, data: BaseModel, top_k: int = 5
    ) -> t.Sequence[t.Tuple[BaseModel, BaseModel]]:
        pass

    @abstractmethod
    def add_example(self, input: BaseModel, output: BaseModel):
        pass


@dataclass
class InMemoryExampleStore(ExampleStore):
    embeddings: BaseRagasEmbeddings
    _examples_list: t.List[t.Tuple[BaseModel, BaseModel]] = field(
        default_factory=list, repr=False
    )
    _embeddings_of_examples: t.List[t.List[float]] = field(
        default_factory=list, repr=False
    )

    def add_example(self, input: BaseModel, output: BaseModel):
        # get json string for input
        input_json = input.model_dump_json()
        self._embeddings_of_examples.append(self.embeddings.embed_query(input_json))
        self._examples_list.append((input, output))

    def get_examples(
        self, data: BaseModel, top_k: int = 5, threshold: float = 0.7
    ) -> t.Sequence[t.Tuple[BaseModel, BaseModel]]:
        data_embedding = self.embeddings.embed_query(data.model_dump_json())
        return [
            self._examples_list[i]
            for i in self.get_nearest_examples(
                data_embedding, self._embeddings_of_examples, top_k, threshold
            )
        ]

    @staticmethod
    def get_nearest_examples(
        query_embedding: t.List[float],
        embeddings: t.List[t.List[float]],
        top_k: int = 3,
        threshold: float = 0.7,
    ) -> t.List[int]:
        # Convert to numpy arrays for efficient computation
        query = np.array(query_embedding)
        embed_matrix = np.array(embeddings)

        # Calculate cosine similarity
        similarities = np.dot(embed_matrix, query) / (
            np.linalg.norm(embed_matrix, axis=1) * np.linalg.norm(query) + 1e-8
        )

        # Get indices of similarities above threshold
        valid_indices = np.where(similarities >= threshold)[0]

        # Sort by similarity and get top-k
        top_indices = valid_indices[np.argsort(similarities[valid_indices])[-top_k:]]

        return top_indices.tolist()

    def __repr__(self):
        return f"InMemoryExampleStore(n_examples={len(self._examples_list)})"


@dataclass
class FewShotPydanticPrompt(PydanticPrompt, t.Generic[InputModel, OutputModel]):
    example_store: ExampleStore
    top_k_for_examples: int = 5
    threshold_for_examples: float = 0.7

    def __post_init__(self):
        self.examples: t.Sequence[t.Tuple[InputModel, OutputModel]] = []

    def add_example(self, input: InputModel, output: OutputModel):
        self.example_store.add_example(input, output)

    async def generate_multiple(
        self,
        llm: BaseRagasLLM,
        data: InputModel,
        n: int = 1,
        temperature: t.Optional[float] = None,
        stop: t.Optional[t.List[str]] = None,
        callbacks: t.Optional[Callbacks] = None,
        retries_left: int = 3,
    ) -> t.List[OutputModel]:
        # Ensure get_examples returns a sequence of tuples (InputModel, OutputModel)
        self.examples = self.example_store.get_examples(data, self.top_k_for_examples)  # type: ignore
        return await super().generate_multiple(
            llm, data, n, temperature, stop, callbacks, retries_left
        )

    @classmethod
    def from_pydantic_prompt(
        cls,
        pydantic_prompt: PydanticPrompt[InputModel, OutputModel],
        embeddings: BaseRagasEmbeddings,
    ) -> FewShotPydanticPrompt[InputModel, OutputModel]:
        # add examples to the example store
        example_store = InMemoryExampleStore(embeddings=embeddings)
        for example in pydantic_prompt.examples:
            example_store.add_example(example[0], example[1])
        few_shot_prompt = cls(
            example_store=example_store,
        )
        few_shot_prompt.name = pydantic_prompt.name
        few_shot_prompt.language = pydantic_prompt.language
        few_shot_prompt.instruction = pydantic_prompt.instruction
        few_shot_prompt.input_model = pydantic_prompt.input_model
        few_shot_prompt.output_model = pydantic_prompt.output_model
        return few_shot_prompt
