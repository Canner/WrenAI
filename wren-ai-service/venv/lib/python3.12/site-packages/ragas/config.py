from __future__ import annotations

import typing as t

from pydantic import BaseModel, Field, field_validator

from ragas.embeddings.base import BaseRagasEmbeddings
from ragas.llms.base import BaseRagasLLM
from ragas.losses import Loss
from ragas.optimizers import GeneticOptimizer, Optimizer

DEFAULT_OPTIMIZER_CONFIG = {"max_steps": 100}


class DemonstrationConfig(BaseModel):
    embedding: t.Any  # this has to be of type Any because BaseRagasEmbedding is an ABC
    enabled: bool = True
    top_k: int = 3
    threshold: float = 0.7
    technique: t.Literal["random", "similarity"] = "similarity"

    @field_validator("embedding")
    def validate_embedding(cls, v):
        if not isinstance(v, BaseRagasEmbeddings):
            raise ValueError("embedding must be an instance of BaseRagasEmbeddings")
        return v


class InstructionConfig(BaseModel):
    llm: BaseRagasLLM
    enabled: bool = True
    loss: t.Optional[Loss] = None
    optimizer: Optimizer = GeneticOptimizer()
    optimizer_config: t.Dict[str, t.Any] = Field(
        default_factory=lambda: DEFAULT_OPTIMIZER_CONFIG
    )


InstructionConfig.model_rebuild()
