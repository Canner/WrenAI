from __future__ import annotations

import logging
import typing as t
from abc import ABC, abstractmethod

from langchain_core.prompt_values import StringPromptValue
from pydantic import BaseModel

from ragas.utils import camel_to_snake

if t.TYPE_CHECKING:
    from langchain_core.callbacks import Callbacks

    from ragas.llms.base import BaseRagasLLM

logger = logging.getLogger(__name__)


class BasePrompt(ABC):
    def __init__(
        self,
        name: t.Optional[str] = None,
        language: str = "english",
        original_hash: t.Optional[str] = None,
    ):
        if name is None:
            self.name = camel_to_snake(self.__class__.__name__)

        self.language = language
        self.original_hash = original_hash

    def __repr__(self):
        return f"{self.__class__.__name__}(name={self.name}, language={self.language})"

    @abstractmethod
    async def generate(
        self,
        llm: BaseRagasLLM,
        data: t.Any,
        temperature: t.Optional[float] = None,
        stop: t.Optional[t.List[str]] = None,
        callbacks: Callbacks = [],
    ) -> t.Any:
        """
        Generate a single completion from the prompt.
        """
        pass

    @abstractmethod
    def generate_multiple(
        self,
        llm: BaseRagasLLM,
        data: t.Any,
        n: int = 1,
        temperature: t.Optional[float] = None,
        stop: t.Optional[t.List[str]] = None,
        callbacks: Callbacks = [],
    ) -> t.Any:
        """
        Generate multiple completions from the prompt.
        """
        pass


class StringIO(BaseModel):
    text: str

    def __hash__(self):
        return hash(self.text)


class BoolIO(BaseModel):
    value: bool

    def __hash__(self):
        return hash(self.value)


class StringPrompt(BasePrompt):
    """
    A simple prompt that can be formatted with additional data using f-string syntax.

    This prompt is a simpler alternative to PydanticPrompt for those who prefer a more
    flexible approach without the need for a Pydantic model.

    Parameters
    ----------
    instruction : str
        The instruction string that can be formatted with additional data.

    Examples
    --------
    >>> from ragas.prompt import string_prompt
    >>> await prompt.generate(llm=llm, data={"category": "commerce"})
    """

    async def generate(
        self,
        llm: BaseRagasLLM,
        data: str,
        temperature: t.Optional[float] = None,
        stop: t.Optional[t.List[str]] = None,
        callbacks: Callbacks = [],
    ) -> str:
        """
        Generate text based on the instruction and provided data.

        Parameters
        ----------
        llm : BaseRagasLLM
            The language model to use for text generation.
        data : Optional[Dict[str, Any]], optional
            The data to format the instruction with, by default None.
        n : int, optional
            The number of completions to generate, by default 1.
        temperature : Optional[float], optional
            The temperature for text generation, by default None.
        stop : Optional[List[str]], optional
            The stop sequences for text generation, by default None.
        callbacks : Callbacks, optional
            The callbacks to use during text generation, by default [].

        Returns
        -------
        str
            The generated text.
        """
        llm_result = await llm.agenerate_text(
            StringPromptValue(text=data),
            n=1,
            temperature=temperature,
            stop=stop,
            callbacks=callbacks,
        )
        return llm_result.generations[0][0].text

    async def generate_multiple(
        self,
        llm: BaseRagasLLM,
        data: str,
        n: int = 1,
        temperature: t.Optional[float] = None,
        stop: t.Optional[t.List[str]] = None,
        callbacks: Callbacks = [],
    ) -> t.List[str]:
        return [
            await self.generate(llm, data, temperature, stop, callbacks)
            for _ in range(n)
        ]
