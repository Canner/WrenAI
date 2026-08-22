"""OrcaRouter gateway integration for wren-langchain.

[OrcaRouter](https://www.orcarouter.ai) is an OpenAI-compatible model gateway: one
key routes to 150+ models across providers, and the same endpoint runs
gateway-level, zero-trust security for AI agents. This module builds a
``langchain_openai.ChatOpenAI`` pointed at OrcaRouter's endpoint.
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from langchain_openai import ChatOpenAI

#: Default base URL for the OrcaRouter OpenAI-compatible endpoint.
DEFAULT_ORCAROUTER_BASE_URL = "https://api.orcarouter.ai/v1"
#: Default model id — OrcaRouter's smart auto-routing model.
DEFAULT_ORCAROUTER_MODEL = "orcarouter/auto"


def create_orcarouter_chat_model(*, temperature: float = 0) -> ChatOpenAI:
    """Return a ``ChatOpenAI`` routed through OrcaRouter.

    Requires ``ORCAROUTER_API_KEY`` in the environment. ``ORCAROUTER_BASE_URL``
    and ``ORCAROUTER_MODEL`` override the defaults.

    Raises:
        ImportError: if ``langchain-openai`` is not installed.
        ValueError: if ``ORCAROUTER_API_KEY`` is not set.
    """
    try:
        from langchain_openai import ChatOpenAI  # noqa: PLC0415
    except ImportError as exc:  # pragma: no cover - exercised via dev extra in CI
        raise ImportError(
            "langchain-openai is required for OrcaRouter routing."
        ) from exc

    api_key = os.environ.get("ORCAROUTER_API_KEY")
    if not api_key:
        raise ValueError(
            "ORCAROUTER_API_KEY is required to use the OrcaRouter gateway."
        )

    return ChatOpenAI(
        model=os.environ.get("ORCAROUTER_MODEL", DEFAULT_ORCAROUTER_MODEL),
        base_url=os.environ.get("ORCAROUTER_BASE_URL", DEFAULT_ORCAROUTER_BASE_URL),
        api_key=api_key,
        temperature=temperature,
    )
