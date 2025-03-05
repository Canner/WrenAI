from typing import Any, Dict, List, Optional, Union

from pydantic import BaseModel, Field

from qdrant_client.conversions.common_types import SparseVector


class QueryResponse(BaseModel, extra="forbid"):  # type: ignore
    id: Union[str, int]
    embedding: Optional[List[float]]
    sparse_embedding: Optional[SparseVector] = Field(default=None)
    metadata: Dict[str, Any]
    document: str
    score: float
