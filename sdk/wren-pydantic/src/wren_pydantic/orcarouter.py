"""OrcaRouter gateway integration for wren-pydantic.

[OrcaRouter](https://www.orcarouter.ai) is an OpenAI-compatible model gateway: one
key routes to 150+ models across providers, and the same endpoint runs
gateway-level, zero-trust security for AI agents. This module builds a
Pydantic AI ``OpenAIChatModel`` pointed at OrcaRouter's endpoint.
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pydantic_ai.models.openai import OpenAIChatModel

#: Default base URL for the OrcaRouter OpenAI-compatible endpoint.
DEFAULT_ORCAROUTER_BASE_URL = "https://api.orcarouter.ai/v1"
#: Default model id — OrcaRouter's smart auto-routing model.
DEFAULT_ORCAROUTER_MODEL = "orcarouter/auto"


def create_orcarouter_model() -> OpenAIChatModel:
    """Return a Pydantic AI ``OpenAIChatModel`` routed through OrcaRouter.

    Requires ``ORCAROUTER_API_KEY`` in the environment. ``ORCAROUTER_BASE_URL``
    and ``ORCAROUTER_MODEL`` override the defaults.

    Raises:
        ValueError: if ``ORCAROUTER_API_KEY`` is not set.
    """
    from pydantic_ai.models.openai import OpenAIChatModel  # noqa: PLC0415
    from pydantic_ai.providers.openai import OpenAIProvider  # noqa: PLC0415

    api_key = os.environ.get("ORCAROUTER_API_KEY")
    if not api_key:
        raise ValueError(
            "ORCAROUTER_API_KEY is required to use the OrcaRouter gateway."
        )

    return OpenAIChatModel(
        os.environ.get("ORCAROUTER_MODEL", DEFAULT_ORCAROUTER_MODEL),
        provider=OpenAIProvider(
            base_url=os.environ.get("ORCAROUTER_BASE_URL", DEFAULT_ORCAROUTER_BASE_URL),
            api_key=api_key,
        ),
    )
