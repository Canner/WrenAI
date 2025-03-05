from __future__ import annotations

import base64
import logging
import mimetypes
import typing as t
import urllib.request
from urllib.parse import urlparse

from langchain_core.messages import BaseMessage, HumanMessage
from langchain_core.prompt_values import PromptValue
from pydantic import BaseModel

from ragas.callbacks import ChainType, new_group
from ragas.exceptions import RagasOutputParserException
from ragas.prompt.pydantic_prompt import PydanticPrompt, RagasOutputParser

if t.TYPE_CHECKING:
    from langchain_core.callbacks import Callbacks

    from ragas.llms.base import BaseRagasLLM


# type variables for input and output models
InputModel = t.TypeVar("InputModel", bound=BaseModel)
OutputModel = t.TypeVar("OutputModel", bound=BaseModel)

logger = logging.getLogger(__name__)


class ImageTextPrompt(PydanticPrompt, t.Generic[InputModel, OutputModel]):
    def _generate_examples(self):
        if self.examples:
            example_strings = []
            for e in self.examples:
                input_data, output_data = e
                example_strings.append(
                    self.instruction
                    + "\n"
                    + "input: "
                    + input_data.model_dump_json(indent=4)
                    + "\n"
                    + "output: "
                    + output_data.model_dump_json(indent=4)
                )

            return (
                "Some examples are provided below with only text context, but please do use any images for context if they are provided.\n"
                + "\n\n".join(example_strings)
            )
        # if no examples are provided
        else:
            return ""

    def to_prompt_value(self, data: t.Optional[InputModel] = None):
        text = [
            self._generate_instruction(),
            self._generate_output_signature(),
            self._generate_examples(),
            "Now perform the above instruction with the following",
        ] + data.to_string_list()  # type: ignore
        return ImageTextPromptValue(items=text)

    async def generate_multiple(
        self,
        llm: BaseRagasLLM,
        data: InputModel,
        n: int = 1,
        temperature: t.Optional[float] = None,
        stop: t.Optional[t.List[str]] = None,
        callbacks: t.Optional[Callbacks] = None,
        retries_left: int = 3,
    ) -> t.List[OutputModel]:
        """
        Generate multiple outputs using the provided language model and input data.

        Parameters
        ----------
        llm : BaseRagasLLM
            The language model to use for generation.
        data : InputModel
            The input data for generation.
        n : int, optional
            The number of outputs to generate. Default is 1.
        temperature : float, optional
            The temperature parameter for controlling randomness in generation.
        stop : List[str], optional
            A list of stop sequences to end generation.
        callbacks : Callbacks, optional
            Callback functions to be called during the generation process.

        Returns
        -------
        List[OutputModel]
            A list of generated outputs.

        Raises
        ------
        RagasOutputParserException
            If there's an error parsing the output.
        """
        callbacks = callbacks or []
        processed_data = self.process_input(data)
        prompt_rm, prompt_cb = new_group(
            name=self.name,
            inputs={"data": processed_data},
            callbacks=callbacks,
            metadata={"type": ChainType.RAGAS_PROMPT},
        )
        prompt_value = self.to_prompt_value(processed_data)
        resp = await llm.generate(
            prompt_value,
            n=n,
            temperature=temperature,
            stop=stop,
            callbacks=prompt_cb,
        )

        output_models = []
        parser = RagasOutputParser(pydantic_object=self.output_model)  # type: ignore
        for i in range(n):
            output_string = resp.generations[0][i].text
            try:
                answer = await parser.parse_output_string(
                    output_string=output_string,
                    prompt_value=prompt_value,  # type: ignore
                    llm=llm,
                    callbacks=prompt_cb,
                    retries_left=retries_left,
                )
                processed_output = self.process_output(answer, data)  # type: ignore
                output_models.append(processed_output)
            except RagasOutputParserException as e:
                prompt_rm.on_chain_error(error=e)
                logger.error("Prompt %s failed to parse output: %s", self.name, e)
                raise e

        prompt_rm.on_chain_end({"output": output_models})
        return output_models


class ImageTextPromptValue(PromptValue):
    items: t.List[str]

    def to_messages(self) -> t.List[BaseMessage]:
        messages = []
        for item in self.items:
            if self.is_image(item):
                messages.append(self.get_image(item))
            else:
                messages.append(self.get_text(item))
        return [HumanMessage(content=messages)]

    def get_text(self, item):
        return {"type": "text", "text": item}

    def get_image(self, item):
        if self.is_base64(item):
            encoded_image = item
        elif self.is_valid_url(item):
            encoded_image = self.download_and_encode_image(item)
        else:
            encoded_image = self.encode_image_to_base64(item)

        return {
            "type": "image_url",
            "image_url": {"url": f"data:image/jpeg;base64,{encoded_image}"},
        }

    def to_string(self):
        string_representation = ""
        for item in self.items:
            if self.is_image(item):
                string_representation += "[Image]"
            else:
                string_representation += item
            string_representation += " "
        return string_representation.strip()

    def is_base64(self, s):
        try:
            if isinstance(s, str):
                # Try to decode the string
                if base64.b64encode(base64.b64decode(s)).decode("utf-8") == s:
                    return True
            return False
        except Exception:
            return False

    def is_valid_url(self, url):
        try:
            result = urlparse(url)
            return all([result.scheme, result.netloc])
        except ValueError:
            return False

    def encode_image_to_base64(self, file_path):
        with open(file_path, "rb") as image_file:
            return base64.b64encode(image_file.read()).decode("utf-8")

    def download_and_encode_image(self, url):
        with urllib.request.urlopen(url) as response:
            return base64.b64encode(response.read()).decode("utf-8")

    def is_image(self, item):
        if self.is_base64(item):
            return True
        elif self.is_valid_url(item):
            mime_type, _ = mimetypes.guess_type(item)
            return mime_type and mime_type.startswith("image")
        elif isinstance(item, str):
            mime_type, _ = mimetypes.guess_type(item)
            return mime_type and mime_type.startswith("image")
        return False
