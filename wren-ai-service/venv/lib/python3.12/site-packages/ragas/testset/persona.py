import logging
import typing as t

import numpy as np
from langchain_core.callbacks import Callbacks
from pydantic import BaseModel

from ragas.executor import run_async_batch
from ragas.llms.base import BaseRagasLLM
from ragas.prompt import PydanticPrompt, StringIO
from ragas.testset.graph import KnowledgeGraph, Node

logger = logging.getLogger(__name__)


def default_filter(node: Node) -> bool:
    if (
        node.type.name == "DOCUMENT"
        and node.properties.get("summary_embedding") is not None
    ):
        return True
    else:
        return False


class Persona(BaseModel):
    name: str
    role_description: str


class PersonaGenerationPrompt(PydanticPrompt[StringIO, Persona]):
    instruction: str = (
        "Using the provided summary, generate a single persona who would likely "
        "interact with or benefit from the content. Include a unique name and a "
        "concise role description of who they are."
    )
    input_model: t.Type[StringIO] = StringIO
    output_model: t.Type[Persona] = Persona
    examples: t.List[t.Tuple[StringIO, Persona]] = [
        (
            StringIO(
                text="Guide to Digital Marketing explains strategies for engaging audiences across various online platforms."
            ),
            Persona(
                name="Digital Marketing Specialist",
                role_description="Focuses on engaging audiences and growing the brand online.",
            ),
        )
    ]


class PersonaList(BaseModel):
    personas: t.List[Persona]

    def __getitem__(self, key: str) -> Persona:
        for persona in self.personas:
            if persona.name == key:
                return persona
        raise KeyError(f"No persona found with name '{key}'")


def generate_personas_from_kg(
    kg: KnowledgeGraph,
    llm: BaseRagasLLM,
    persona_generation_prompt: PersonaGenerationPrompt = PersonaGenerationPrompt(),
    num_personas: int = 3,
    filter_fn: t.Callable[[Node], bool] = default_filter,
    callbacks: Callbacks = [],
) -> t.List[Persona]:
    """
    Generate personas from a knowledge graph based on cluster of similar document summaries.

    parameters:
        kg: KnowledgeGraph
            The knowledge graph to generate personas from.
        llm: BaseRagasLLM
            The LLM to use for generating the persona.
        persona_generation_prompt: PersonaGenerationPrompt
            The prompt to use for generating the persona.
        num_personas: int
            The maximum number of personas to generate.
        filter_fn: Callable[[Node], bool]
            A function to filter nodes in the knowledge graph.
        callbacks: Callbacks
            The callbacks to use for the generation process.


    returns:
        t.List[Persona]
            The list of generated personas.
    """

    nodes = [node for node in kg.nodes if filter_fn(node)]
    if len(nodes) == 0:
        raise ValueError(
            "No nodes that satisfied the given filer. Try changing the filter."
        )

    summaries = [node.properties.get("summary") for node in nodes]
    summaries = [summary for summary in summaries if isinstance(summary, str)]
    num_personas = min(num_personas, len(summaries))

    embeddings = []
    for node in nodes:
        embeddings.append(node.properties.get("summary_embedding"))

    embeddings = np.array(embeddings)
    cosine_similarities = np.dot(embeddings, embeddings.T)

    groups = []
    visited = set()
    threshold = 0.75

    for i, _ in enumerate(summaries):
        if i in visited:
            continue
        group = [i]
        visited.add(i)
        for j in range(i + 1, len(summaries)):
            if cosine_similarities[i, j] > threshold:
                group.append(j)
                visited.add(j)
        groups.append(group)

    top_summaries = []
    for group in groups:
        representative_summary = max([summaries[i] for i in group], key=len)
        top_summaries.append(representative_summary)

    if len(top_summaries) <= num_personas:
        top_summaries.extend(
            np.random.choice(top_summaries, num_personas - len(top_summaries))
        )

    # use run_async_batch to generate personas in parallel
    kwargs_list = [
        {
            "llm": llm,
            "data": StringIO(text=summary),
            "callbacks": callbacks,
            "temperature": 1.0,
        }
        for summary in top_summaries[:num_personas]
    ]
    persona_list = run_async_batch(
        desc="Generating personas",
        func=persona_generation_prompt.generate,
        kwargs_list=kwargs_list,
    )

    return persona_list
