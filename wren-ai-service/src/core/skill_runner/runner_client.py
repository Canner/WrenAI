import asyncio
import logging
from typing import Optional, Type, TypeVar

import aiohttp
import orjson

from src.core.skill_runner.models import (
    SkillRunnerExecutionRequest,
    SkillRunnerExecutionResponse,
    SkillRunnerHealthResponse,
)
from src.utils import remove_trailing_slash

logger = logging.getLogger("wren-ai-service")

ResponseModel = TypeVar(
    "ResponseModel",
    SkillRunnerHealthResponse,
    SkillRunnerExecutionResponse,
)


class SkillRunnerClientError(Exception):
    def __init__(
        self,
        message: str,
        status_code: int = 500,
        payload: Optional[dict] = None,
    ):
        super().__init__(message)
        self.status_code = status_code
        self.payload = payload or {}


class SkillRunnerClient:
    def __init__(
        self,
        endpoint: Optional[str],
        timeout: float = 30.0,
        enabled: bool = False,
    ):
        self._endpoint = remove_trailing_slash(endpoint) if endpoint else None
        self._timeout = timeout
        self._enabled = enabled

    @property
    def endpoint(self) -> Optional[str]:
        return self._endpoint

    @property
    def enabled(self) -> bool:
        return bool(self._enabled and self._endpoint)

    async def healthcheck(
        self,
        session: Optional[aiohttp.ClientSession] = None,
    ) -> SkillRunnerHealthResponse:
        return await self._request(
            method="GET",
            path="/health",
            response_model=SkillRunnerHealthResponse,
            session=session,
        )

    async def run(
        self,
        request: SkillRunnerExecutionRequest,
        session: Optional[aiohttp.ClientSession] = None,
    ) -> SkillRunnerExecutionResponse:
        return await self._request(
            method="POST",
            path="/v1/skill-runs",
            payload=request.model_dump(mode="json", by_alias=True),
            response_model=SkillRunnerExecutionResponse,
            session=session,
        )

    async def get_result(
        self,
        execution_id: str,
        session: Optional[aiohttp.ClientSession] = None,
    ) -> SkillRunnerExecutionResponse:
        return await self._request(
            method="GET",
            path=f"/v1/skill-runs/{execution_id}",
            response_model=SkillRunnerExecutionResponse,
            session=session,
        )

    async def _request(
        self,
        method: str,
        path: str,
        response_model: Type[ResponseModel],
        payload: Optional[dict] = None,
        session: Optional[aiohttp.ClientSession] = None,
    ) -> ResponseModel:
        self._ensure_enabled()

        owns_session = session is None
        active_session = session or aiohttp.ClientSession()

        try:
            async with active_session.request(
                method=method,
                url=f"{self._endpoint}{path}",
                data=orjson.dumps(payload) if payload is not None else None,
                headers={"Content-Type": "application/json"}
                if payload is not None
                else None,
                timeout=aiohttp.ClientTimeout(total=self._timeout),
            ) as response:
                parsed_payload = await self._parse_response_payload(response)

                if response.status >= 400:
                    raise SkillRunnerClientError(
                        self._extract_error_message(parsed_payload),
                        status_code=response.status,
                        payload=parsed_payload if isinstance(parsed_payload, dict) else {},
                    )

                return response_model.model_validate(parsed_payload)
        except asyncio.TimeoutError as exc:
            raise SkillRunnerClientError(
                f"Skill runner request timed out after {self._timeout} seconds",
                status_code=504,
            ) from exc
        except aiohttp.ClientError as exc:
            raise SkillRunnerClientError(
                f"Skill runner request failed: {exc}",
                status_code=502,
            ) from exc
        finally:
            if owns_session:
                await active_session.close()

    async def _parse_response_payload(self, response: aiohttp.ClientResponse):
        text = await response.text()
        if not text:
            return {}

        try:
            return orjson.loads(text)
        except orjson.JSONDecodeError:
            return {"detail": text}

    def _ensure_enabled(self):
        if self.enabled:
            return

        raise SkillRunnerClientError(
            "Skill runner is not configured or disabled",
            status_code=503,
        )

    def _extract_error_message(self, payload: object) -> str:
        if isinstance(payload, dict):
            return (
                payload.get("detail")
                or payload.get("error")
                or payload.get("message")
                or "Skill runner request failed"
            )

        return "Skill runner request failed"
