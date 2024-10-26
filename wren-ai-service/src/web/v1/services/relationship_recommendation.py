import logging
from typing import Dict, Literal, Optional
from enum import Enum
import orjson
from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import BaseModel, Field
from src.core.pipeline import BasicPipeline
from src.utils import trace_metadata

logger = logging.getLogger("wren-ai-service")

class RelationshipRecommendation:
    """Service for generating relationship recommendations based on MDL input."""

    class ErrorCode(str, Enum):
        """Enumeration of possible error codes for the service."""
        OTHERS = "OTHERS"
        MDL_PARSE_ERROR = "MDL_PARSE_ERROR"
        RESOURCE_NOT_FOUND = "RESOURCE_NOT_FOUND"

    class Input(BaseModel):
        """Input model for relationship recommendation requests."""
        id: str = Field(..., description="Unique identifier for the request")
        mdl: str = Field(..., description="MDL data in string format")

        class Config:
            frozen = True

    class Resource(BaseModel):
        """Resource model representing the state and result of a recommendation request."""
        class Error(BaseModel):
            """Error details when processing fails."""
            code: Literal["OTHERS", "MDL_PARSE_ERROR", "RESOURCE_NOT_FOUND"]
            message: str

        id: str = Field(..., description="Unique identifier matching the input request")
        status: Literal["generating", "finished", "failed"] = Field(
            default="generating",
            description="Current status of the recommendation process"
        )
        response: Optional[dict] = Field(
            default=None,
            description="Validated recommendation response when successful"
        )
        error: Optional[Error] = Field(
            default=None,
            description="Error details if processing failed"
        )

        class Config:
            frozen = True

        @property
        def is_completed(self) -> bool:
            """Check if the processing is complete (either finished or failed)."""
            return self.status in ("finished", "failed")

        @classmethod
        def create_error_resource(
            cls,
            id: str,
            error_code: str,
            error_message: str
        ) -> "RelationshipRecommendation.Resource":
            """Factory method for creating error resources."""
            return cls(
                id=id,
                status="failed",
                error=RelationshipRecommendation.Resource.Error(
                    code=error_code,
                    message=error_message
                )
            )

    def __init__(
        self,
        pipelines: Dict[str, BasicPipeline],
        maxsize: int = 1_000_000,
        ttl: int = 120,
    ):
        """Initialize the service with required pipelines and cache settings."""
        self._pipelines = pipelines
        self._cache: Dict[str, RelationshipRecommendation.Resource] = TTLCache(
            maxsize=maxsize,
            ttl=ttl
        )

    def _handle_exception(
        self,
        input: Input,
        error_message: str,
        code: str = "OTHERS",
    ) -> Resource:
        """Handle exceptions by creating and caching an error resource."""
        resource = self.Resource.create_error_resource(
            id=input.id,
            error_code=code,
            error_message=error_message
        )
        self._cache[input.id] = resource
        logger.error(error_message)
        return resource

    @observe(name="Generate Relationship Recommendation")
    @trace_metadata
    async def recommend(self, request: Input, **kwargs) -> Resource:
        """
        Generate relationship recommendations based on the provided MDL input.
        
        Args:
            request: Input model containing the request parameters
            **kwargs: Additional keyword arguments passed to the pipeline
            
        Returns:
            Resource model containing the recommendation results or error details
        """
        logger.info("Generate Relationship Recommendation pipeline is running...")
        
        try:
            mdl_dict = orjson.loads(request.mdl)
            
            resp = await self._pipelines["relationship_recommendation"].run(
                mdl=mdl_dict
            )
            
            resource = self.Resource(
                id=request.id,
                status="finished",
                response=resp.get("validated")
            )
            self._cache[request.id] = resource
            return resource

        except orjson.JSONDecodeError as e:
            return self._handle_exception(
                request,
                f"Failed to parse MDL: {str(e)}",
                code="MDL_PARSE_ERROR",
            )
        except Exception as e:
            return self._handle_exception(
                request,
                f"An error occurred during relationship recommendation generation: {str(e)}",
            )

    def __getitem__(self, id: str) -> Resource:
        """
        Retrieve a resource by its ID from the cache.
        
        Args:
            id: The unique identifier of the resource
            
        Returns:
            The cached resource or an error resource if not found
        """
        if resource := self._cache.get(id):
            return resource

        message = f"Relationship Recommendation Resource with ID '{id}' not found."
        logger.error(message)
        return self.Resource.create_error_resource(
            id=id,
            error_code="RESOURCE_NOT_FOUND",
            error_message=message
        )

    def __setitem__(self, id: str, value: Resource):
        """Store a resource in the cache."""
        self._cache[id] = value
