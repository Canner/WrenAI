import typing as t

from pydantic import BaseModel, Field

from ragas.prompt import PydanticPrompt
from ragas.testset.persona import Persona


class ConceptsList(BaseModel):
    lists_of_concepts: t.List[t.List[str]] = Field(
        description="A list containing lists of concepts from each node"
    )
    max_combinations: int = Field(
        description="The maximum number of concept combinations to generate", default=5
    )


class ConceptCombinations(BaseModel):
    combinations: t.List[t.List[str]]


class ConceptCombinationPrompt(PydanticPrompt[ConceptsList, ConceptCombinations]):
    instruction: str = (
        "Form combinations by pairing concepts from at least two different lists.\n"
        "**Instructions:**\n"
        "- Review the concepts from each node.\n"
        "- Identify concepts that can logically be connected or contrasted.\n"
        "- Form combinations that involve concepts from different nodes.\n"
        "- Each combination should include at least one concept from two or more nodes.\n"
        "- List the combinations clearly and concisely.\n"
        "- Do not repeat the same combination more than once."
    )
    input_model: t.Type[ConceptsList] = (
        ConceptsList  # Contains lists of concepts from each node
    )
    output_model: t.Type[ConceptCombinations] = (
        ConceptCombinations  # Contains list of concept combinations
    )
    examples: t.List[t.Tuple[ConceptsList, ConceptCombinations]] = [
        (
            ConceptsList(
                lists_of_concepts=[
                    ["Artificial intelligence", "Automation"],  # Concepts from Node 1
                    ["Healthcare", "Data privacy"],  # Concepts from Node 2
                ],
                max_combinations=2,
            ),
            ConceptCombinations(
                combinations=[
                    ["Artificial intelligence", "Healthcare"],
                    ["Automation", "Data privacy"],
                ]
            ),
        )
    ]


class QueryConditions(BaseModel):
    persona: Persona
    themes: t.List[str]
    query_style: str
    query_length: str
    context: t.List[str]


class GeneratedQueryAnswer(BaseModel):
    query: str
    answer: str


class QueryAnswerGenerationPrompt(
    PydanticPrompt[QueryConditions, GeneratedQueryAnswer]
):
    instruction: str = (
        "Generate a multi-hop query and answer based on the specified conditions (persona, themes, style, length) "
        "and the provided context. The themes represent a set of phrases either extracted or generated from the "
        "context, which highlight the suitability of the selected context for multi-hop query creation. Ensure the query "
        "explicitly incorporates these themes."
        "### Instructions:\n"
        "1. **Generate a Multi-Hop Query**: Use the provided context segments and themes to form a query that requires combining "
        "information from multiple segments (e.g., `<1-hop>` and `<2-hop>`). Ensure the query explicitly incorporates one or more "
        "themes and reflects their relevance to the context.\n"
        "2. **Generate an Answer**: Use only the content from the provided context to create a detailed and faithful answer to "
        "the query. Avoid adding information that is not directly present or inferable from the given context.\n"
        "3. **Multi-Hop Context Tags**:\n"
        "   - Each context segment is tagged as `<1-hop>`, `<2-hop>`, etc.\n"
        "   - Ensure the query uses information from at least two segments and connects them meaningfully."
    )
    input_model: t.Type[QueryConditions] = QueryConditions
    output_model: t.Type[GeneratedQueryAnswer] = GeneratedQueryAnswer
    examples: t.List[t.Tuple[QueryConditions, GeneratedQueryAnswer]] = [
        (
            QueryConditions(
                persona=Persona(
                    name="Historian",
                    role_description="Focuses on major scientific milestones and their global impact.",
                ),
                themes=["Theory of Relativity", "Experimental Validation"],
                query_style="Formal",
                query_length="Medium",
                context=[
                    "<1-hop> Albert Einstein developed the theory of relativity, introducing the concept of spacetime.",
                    "<2-hop> The bending of light by gravity was confirmed during the 1919 solar eclipse, supporting Einstein’s theory.",
                ],
            ),
            GeneratedQueryAnswer(
                query="How was the experimental validation of the theory of relativity achieved during the 1919 solar eclipse?",
                answer=(
                    "The experimental validation of the theory of relativity was achieved during the 1919 solar eclipse by confirming "
                    "the bending of light by gravity, which supported Einstein’s concept of spacetime as proposed in the theory."
                ),
            ),
        ),
    ]
