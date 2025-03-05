import typing as t

from pydantic import BaseModel

from ragas.prompt import PydanticPrompt
from ragas.testset.persona import Persona


class QueryCondition(BaseModel):
    persona: Persona
    term: str
    query_style: str
    query_length: str
    context: str


class GeneratedQueryAnswer(BaseModel):
    query: str
    answer: str


class QueryAnswerGenerationPrompt(PydanticPrompt[QueryCondition, GeneratedQueryAnswer]):
    instruction: str = (
        "Generate a single-hop query and answer based on the specified conditions (persona, term, style, length) "
        "and the provided context. Ensure the answer is entirely faithful to the context, using only the information "
        "directly from the provided context."
        "### Instructions:\n"
        "1. **Generate a Query**: Based on the context, persona, term, style, and length, create a question "
        "that aligns with the persona's perspective and incorporates the term.\n"
        "2. **Generate an Answer**: Using only the content from the provided context, construct a detailed answer "
        "to the query. Do not add any information not included in or inferable from the context.\n"
    )
    input_model: t.Type[QueryCondition] = QueryCondition
    output_model: t.Type[GeneratedQueryAnswer] = GeneratedQueryAnswer
    examples: t.List[t.Tuple[QueryCondition, GeneratedQueryAnswer]] = [
        (
            QueryCondition(
                persona=Persona(
                    name="Software Engineer",
                    role_description="Focuses on coding best practices and system design.",
                ),
                term="microservices",
                query_style="Formal",
                query_length="Medium",
                context="Microservices are an architectural style where applications are structured as a collection of loosely coupled services. "
                "Each service is fine-grained and focuses on a single functionality.",
            ),
            GeneratedQueryAnswer(
                query="What is the purpose of microservices in software architecture?",
                answer="Microservices are designed to structure applications as a collection of loosely coupled services, each focusing on a single functionality.",
            ),
        ),
    ]
