import logging
import typing as t
from dataclasses import dataclass, field

from pydantic import BaseModel, Field

from ragas.prompt import PydanticPrompt
from ragas.testset.graph import KnowledgeGraph, Node
from ragas.testset.graph_queries import get_parent_nodes
from ragas.testset.transforms.base import LLMBasedNodeFilter

logger = logging.getLogger(__name__)


DEFAULT_RUBRICS = {
    "score1_description": "The page content is irrelevant or does not align with the main themes or topics of the document summary.",
    "score2_description": "The page content partially aligns with the document summary, but it includes unrelated details or lacks critical information related to the document's main themes.",
    "score3_description": "The page content generally reflects the document summary but may miss key details or lack depth in addressing the main themes.",
    "score4_description": "The page content aligns well with the document summary, covering the main themes and topics with minor gaps or minimal unrelated information.",
    "score5_description": "The page content is highly relevant, accurate, and directly reflects the main themes of the document summary, covering all important details and adding depth to the understanding of the document's topics.",
}


class QuestionPotentialInput(BaseModel):
    document_summary: str = Field(
        ...,
        description="The summary of the document to provide context for evaluating the node.",
    )
    node_content: str = Field(
        ...,
        description="The content of the node to evaluate for question generation potential.",
    )
    rubrics: t.Dict[str, str] = Field(..., description="The rubric")


class QuestionPotentialOutput(BaseModel):
    score: int = Field(
        ...,
        description="1 to 5 score",
    )


class QuestionPotentialPrompt(
    PydanticPrompt[QuestionPotentialInput, QuestionPotentialOutput]
):
    instruction = (
        "Given a document summary and node content, score the content of the node in 1 to 5 range."
        ""
    )
    input_model = QuestionPotentialInput
    output_model = QuestionPotentialOutput


@dataclass
class CustomNodeFilter(LLMBasedNodeFilter):
    """
    returns True if the score is less than min_score
    """

    scoring_prompt: PydanticPrompt = field(default_factory=QuestionPotentialPrompt)
    min_score: int = 2
    rubrics: t.Dict[str, str] = field(default_factory=lambda: DEFAULT_RUBRICS)

    async def custom_filter(self, node: Node, kg: KnowledgeGraph) -> bool:

        if node.type.name == "CHUNK":
            parent_nodes = get_parent_nodes(node, kg)
            if len(parent_nodes) > 0:
                summary = parent_nodes[0].properties.get("summary", "")
            else:
                summary = ""
        else:
            summary = node.properties.get("summary", "")

        if summary == "":
            logger.warning(
                f"Node {node.id} does not have a summary. Skipping filtering."
            )
            return False

        prompt_input = QuestionPotentialInput(
            document_summary=summary,
            node_content=node.properties.get("page_content", ""),
            rubrics=self.rubrics,
        )
        response = await self.scoring_prompt.generate(data=prompt_input, llm=self.llm)
        return response.score <= self.min_score
