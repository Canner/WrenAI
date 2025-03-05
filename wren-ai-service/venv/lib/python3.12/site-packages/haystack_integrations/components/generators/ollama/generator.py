import json
from typing import Any, Callable, Dict, List, Optional

import requests
from haystack import component, default_from_dict, default_to_dict
from haystack.dataclasses import StreamingChunk
from haystack.utils.callable_serialization import deserialize_callable, serialize_callable
from requests import Response


@component
class OllamaGenerator:
    """
    Provides an interface to generate text using an LLM running on Ollama.

    Usage example:
    ```python
    from haystack_integrations.components.generators.ollama import OllamaGenerator

    generator = OllamaGenerator(model="zephyr",
                                url = "http://localhost:11434/api/generate",
                                generation_kwargs={
                                "num_predict": 100,
                                "temperature": 0.9,
                                })

    print(generator.run("Who is the best American actor?"))
    ```
    """

    def __init__(
        self,
        model: str = "orca-mini",
        url: str = "http://localhost:11434/api/generate",
        generation_kwargs: Optional[Dict[str, Any]] = None,
        system_prompt: Optional[str] = None,
        template: Optional[str] = None,
        raw: bool = False,
        timeout: int = 120,
        streaming_callback: Optional[Callable[[StreamingChunk], None]] = None,
    ):
        """
        :param model:
            The name of the model to use. The model should be available in the running Ollama instance.
        :param url:
            The URL of the generation endpoint of a running Ollama instance.
        :param generation_kwargs:
            Optional arguments to pass to the Ollama generation endpoint, such as temperature,
            top_p, and others. See the available arguments in
            [Ollama docs](https://github.com/jmorganca/ollama/blob/main/docs/modelfile.md#valid-parameters-and-values).
        :param system_prompt:
            Optional system message (overrides what is defined in the Ollama Modelfile).
        :param template:
            The full prompt template (overrides what is defined in the Ollama Modelfile).
        :param raw:
            If True, no formatting will be applied to the prompt. You may choose to use the raw parameter
            if you are specifying a full templated prompt in your API request.
        :param timeout:
            The number of seconds before throwing a timeout error from the Ollama API.
        :param streaming_callback:
            A callback function that is called when a new token is received from the stream.
            The callback function accepts StreamingChunk as an argument.
        """
        self.timeout = timeout
        self.raw = raw
        self.template = template
        self.system_prompt = system_prompt
        self.model = model
        self.url = url
        self.generation_kwargs = generation_kwargs or {}
        self.streaming_callback = streaming_callback

    def to_dict(self) -> Dict[str, Any]:
        """
        Serializes the component to a dictionary.

        :returns:
              Dictionary with serialized data.
        """
        callback_name = serialize_callable(self.streaming_callback) if self.streaming_callback else None
        return default_to_dict(
            self,
            timeout=self.timeout,
            raw=self.raw,
            template=self.template,
            system_prompt=self.system_prompt,
            model=self.model,
            url=self.url,
            generation_kwargs=self.generation_kwargs,
            streaming_callback=callback_name,
        )

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "OllamaGenerator":
        """
        Deserializes the component from a dictionary.

        :param data:
            Dictionary to deserialize from.
        :returns:
            Deserialized component.
        """
        init_params = data.get("init_parameters", {})
        serialized_callback_handler = init_params.get("streaming_callback")
        if serialized_callback_handler:
            data["init_parameters"]["streaming_callback"] = deserialize_callable(serialized_callback_handler)
        return default_from_dict(cls, data)

    def _create_json_payload(self, prompt: str, stream: bool, generation_kwargs=None) -> Dict[str, Any]:
        """
        Returns a dictionary of JSON arguments for a POST request to an Ollama service.
        """
        generation_kwargs = generation_kwargs or {}
        return {
            "prompt": prompt,
            "model": self.model,
            "stream": stream,
            "raw": self.raw,
            "template": self.template,
            "system": self.system_prompt,
            "options": generation_kwargs,
        }

    def _convert_to_response(self, ollama_response: Response) -> Dict[str, List[Any]]:
        """
        Converts a response from the Ollama API to the required Haystack format.
        """

        resp_dict = ollama_response.json()

        replies = [resp_dict["response"]]
        meta = {key: value for key, value in resp_dict.items() if key != "response"}

        return {"replies": replies, "meta": [meta]}

    def _convert_to_streaming_response(self, chunks: List[StreamingChunk]) -> Dict[str, List[Any]]:
        """
        Converts a list of chunks response required Haystack format.
        """

        replies = ["".join([c.content for c in chunks])]
        meta = {key: value for key, value in chunks[0].meta.items() if key != "response"}

        return {"replies": replies, "meta": [meta]}

    def _handle_streaming_response(self, response) -> List[StreamingChunk]:
        """
        Handles Streaming response cases
        """
        chunks: List[StreamingChunk] = []
        for chunk in response.iter_lines():
            chunk_delta: StreamingChunk = self._build_chunk(chunk)
            chunks.append(chunk_delta)
            if self.streaming_callback is not None:
                self.streaming_callback(chunk_delta)
        return chunks

    def _build_chunk(self, chunk_response: Any) -> StreamingChunk:
        """
        Converts the response from the Ollama API to a StreamingChunk.
        """
        decoded_chunk = json.loads(chunk_response.decode("utf-8"))

        content = decoded_chunk["response"]
        meta = {key: value for key, value in decoded_chunk.items() if key != "response"}

        chunk_message = StreamingChunk(content, meta)
        return chunk_message

    @component.output_types(replies=List[str], meta=List[Dict[str, Any]])
    def run(
        self,
        prompt: str,
        generation_kwargs: Optional[Dict[str, Any]] = None,
    ):
        """
        Runs an Ollama Model on the given prompt.

        :param prompt:
            The prompt to generate a response for.
        :param generation_kwargs:
            Optional arguments to pass to the Ollama generation endpoint, such as temperature,
            top_p, and others. See the available arguments in
            [Ollama docs](https://github.com/jmorganca/ollama/blob/main/docs/modelfile.md#valid-parameters-and-values).
        :returns: A dictionary with the following keys:
            - `replies`: The responses from the model
            - `meta`: The metadata collected during the run
        """
        generation_kwargs = {**self.generation_kwargs, **(generation_kwargs or {})}

        stream = self.streaming_callback is not None

        json_payload = self._create_json_payload(prompt, stream, generation_kwargs)

        response = requests.post(url=self.url, json=json_payload, timeout=self.timeout, stream=stream)

        # throw error on unsuccessful response
        response.raise_for_status()

        if stream:
            chunks: List[StreamingChunk] = self._handle_streaming_response(response)
            return self._convert_to_streaming_response(chunks)

        return self._convert_to_response(response)
