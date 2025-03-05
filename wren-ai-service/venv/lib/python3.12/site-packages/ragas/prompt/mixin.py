from __future__ import annotations

import inspect
import logging
import os
import typing as t

from .pydantic_prompt import PydanticPrompt

if t.TYPE_CHECKING:
    from ragas.llms.base import BaseRagasLLM


logger = logging.getLogger(__name__)


class PromptMixin:
    """
    Mixin class for classes that have prompts.
    eg: [BaseSynthesizer][ragas.testset.synthesizers.base.BaseSynthesizer], [MetricWithLLM][ragas.metrics.base.MetricWithLLM]
    """

    def _get_prompts(self) -> t.Dict[str, PydanticPrompt]:

        prompts = {}
        for key, value in inspect.getmembers(self):
            if isinstance(value, PydanticPrompt):
                prompts.update({key: value})
        return prompts

    def get_prompts(self) -> t.Dict[str, PydanticPrompt]:
        """
        Returns a dictionary of prompts for the class.
        """
        prompts = {}
        for _, value in self._get_prompts().items():
            prompts.update({value.name: value})
        return prompts

    def set_prompts(self, **prompts):
        """
        Sets the prompts for the class.

        Raises
        ------
        ValueError
            If the prompt is not an instance of `PydanticPrompt`.
        """
        available_prompts = self.get_prompts()
        name_to_var = {v.name: k for k, v in self._get_prompts().items()}
        for key, value in prompts.items():
            if key not in available_prompts:
                raise ValueError(
                    f"Prompt with name '{key}' does not exist. Use get_prompts() to see available prompts."
                )
            if not isinstance(value, PydanticPrompt):
                raise ValueError(
                    f"Prompt with name '{key}' must be an instance of 'ragas.prompt.PydanticPrompt'"
                )
            setattr(self, name_to_var[key], value)

    async def adapt_prompts(
        self, language: str, llm: BaseRagasLLM, adapt_instruction: bool = False
    ) -> t.Dict[str, PydanticPrompt]:
        """
        Adapts the prompts in the class to the given language and using the given LLM.

        Notes
        -----
        Make sure you use the best available LLM for adapting the prompts and then save and load the prompts using
        [save_prompts][ragas.prompt.mixin.PromptMixin.save_prompts] and [load_prompts][ragas.prompt.mixin.PromptMixin.load_prompts]
        methods.
        """
        prompts = self.get_prompts()
        adapted_prompts = {}
        for name, prompt in prompts.items():
            adapted_prompt = await prompt.adapt(language, llm, adapt_instruction)
            adapted_prompts[name] = adapted_prompt

        return adapted_prompts

    def save_prompts(self, path: str):
        """
        Saves the prompts to a directory in the format of {name}_{language}.json
        """
        # check if path is valid
        if not os.path.exists(path):
            raise ValueError(f"Path {path} does not exist")

        prompts = self.get_prompts()
        for prompt_name, prompt in prompts.items():
            # hash_hex = f"0x{hash(prompt) & 0xFFFFFFFFFFFFFFFF:016x}"
            prompt_file_name = os.path.join(
                path, f"{prompt_name}_{prompt.language}.json"
            )
            prompt.save(prompt_file_name)

    def load_prompts(self, path: str, language: t.Optional[str] = None):
        """
        Loads the prompts from a path. File should be in the format of {name}_{language}.json
        """
        # check if path is valid
        if not os.path.exists(path):
            raise ValueError(f"Path {path} does not exist")

        # check if language is supported, defaults to english
        if language is None:
            language = "english"
            logger.info(
                "Language not specified, loading prompts for default language: %s",
                language,
            )

        loaded_prompts = {}
        for prompt_name, prompt in self.get_prompts().items():
            prompt_file_name = os.path.join(path, f"{prompt_name}_{language}.json")
            loaded_prompt = prompt.__class__.load(prompt_file_name)
            loaded_prompts[prompt_name] = loaded_prompt
        return loaded_prompts
