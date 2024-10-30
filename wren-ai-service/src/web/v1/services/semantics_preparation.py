import logging
from typing import Dict, Literal, Optional

from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import BaseModel, Field

from src.core.pipeline import BasicPipeline
from src.utils import async_timer, trace_metadata

logger = logging.getLogger("wren-ai-service")


class SemanticsPreparation:
    """Service for preparing and managing semantics operations."""

    class Input(BaseModel):
        """Input model for semantics preparation requests."""
        mdl: str
        mdl_hash: str = Field(description="Unique identifier for the MDL")
        project_id: Optional[str] = None
        user_id: Optional[str] = None

    class Resource(BaseModel):
        """Resource model representing the state and result of semantics preparation."""
        class Error(BaseModel):
            """Error information when preparation fails."""
            code: Literal["OTHERS", "NOT_FOUND", "INDEXING_FAILED"]
            message: str

        mdl_hash: str
        status: Literal["indexing", "finished", "failed"] = "indexing"
        error: Optional[Error] = None
        metadata: Optional[dict] = Field(default_factory=dict)

    def __init__(
        self,
        pipelines: Dict[str, BasicPipeline],
        maxsize: int = 1_000_000,
        ttl: int = 120,
    ):
        """Initialize the SemanticsPreparation service.

        Args:
            pipelines: Dictionary of pipeline implementations
            maxsize: Maximum size of the cache
            ttl: Time-to-live for cache entries in seconds
        """
        self._pipelines = pipelines
        self._cache: Dict[str, SemanticsPreparation.Resource] = TTLCache(
            maxsize=maxsize, ttl=ttl
        )

    def _handle_exception(
        self,
        input: Input,
        error_message: str,
        code: str = "OTHERS",
    ) -> Resource:
        """Handle exceptions by creating and caching error resources.

        Args:
            input: The input that caused the exception
            error_message: Description of the error
            code: Error code identifier
        """
        resource = self.Resource(
            mdl_hash=input.mdl_hash,
            status="failed",
            error=self.Resource.Error(code=code, message=error_message),
            metadata={"error_type": code, "error_message": error_message},
        )
        self._cache[input.mdl_hash] = resource
        logger.error(f"Semantics preparation failed: {error_message}")
        return resource

    @async_timer
    @observe(name="Prepare Semantics")
    @trace_metadata
    async def prepare(self, input: Input, **kwargs) -> Resource:
        """Prepare semantics based on the provided input.

        Args:
            input: The preparation request parameters
            **kwargs: Additional keyword arguments for pipeline execution

        Returns:
            Resource object containing the preparation status and results
        """
        logger.info(f"Starting semantics preparation for MDL hash: {input.mdl_hash}")
        
        # Initialize resource in cache
        self._cache[input.mdl_hash] = self.Resource(
            mdl_hash=input.mdl_hash,
            status="indexing"
        )

        try:
            logger.info(f"Processing MDL: {input.mdl}")
            await self._pipelines["indexing"].run(
                mdl_str=input.mdl,
                id=input.project_id,
            )

            # Update cache with success result
            self._cache[input.mdl_hash] = self.Resource(
                mdl_hash=input.mdl_hash,
                status="finished",
                metadata={"completion_time": kwargs.get("timestamp")}
            )

        except Exception as e:
            return self._handle_exception(
                input,
                f"Failed to prepare semantics: {str(e)}",
                code="INDEXING_FAILED"
            )

        return self._cache[input.mdl_hash]

    def get_status(self, mdl_hash: str) -> Resource:
        """Retrieve the current status of a semantics preparation request.

        Args:
            mdl_hash: The identifier for the preparation request

        Returns:
            Resource object containing the current status
        """
        if (resource := self._cache.get(mdl_hash)) is None:
            message = f"No preparation found for MDL hash: {mdl_hash}"
            logger.error(message)
            return self.Resource(
                mdl_hash=mdl_hash,
                status="failed",
                error=self.Resource.Error(
                    code="NOT_FOUND",
                    message=message
                )
            )

        return resource