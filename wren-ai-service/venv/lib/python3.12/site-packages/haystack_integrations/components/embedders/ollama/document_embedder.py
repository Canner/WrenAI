from typing import Any, Dict, List, Optional

import requests
from haystack import Document, component
from tqdm import tqdm


@component
class OllamaDocumentEmbedder:
    """
    Computes the embeddings of a list of Documents and stores the obtained vectors in the embedding field of each
    Document. It uses embedding models compatible with the Ollama Library.

    Usage example:
    ```python
    from haystack import Document
    from haystack_integrations.components.embedders.ollama import OllamaDocumentEmbedder

    doc = Document(content="What do llamas say once you have thanked them? No probllama!")
    document_embedder = OllamaDocumentEmbedder()

    result = document_embedder.run([doc])
    print(result['documents'][0].embedding)
    ```
    """

    def __init__(
        self,
        model: str = "nomic-embed-text",
        url: str = "http://localhost:11434/api/embeddings",
        generation_kwargs: Optional[Dict[str, Any]] = None,
        timeout: int = 120,
        prefix: str = "",
        suffix: str = "",
        progress_bar: bool = True,
        meta_fields_to_embed: Optional[List[str]] = None,
        embedding_separator: str = "\n",
    ):
        """
        :param model:
            The name of the model to use. The model should be available in the running Ollama instance.
        :param url:
            The URL of the chat endpoint of a running Ollama instance.
        :param generation_kwargs:
            Optional arguments to pass to the Ollama generation endpoint, such as temperature, top_p, and others.
            See the available arguments in
            [Ollama docs](https://github.com/jmorganca/ollama/blob/main/docs/modelfile.md#valid-parameters-and-values).
        :param timeout:
            The number of seconds before throwing a timeout error from the Ollama API.
        """
        self.timeout = timeout
        self.generation_kwargs = generation_kwargs or {}
        self.url = url
        self.model = model
        self.batch_size = 1  # API only supports a single call at the moment
        self.progress_bar = progress_bar
        self.meta_fields_to_embed = meta_fields_to_embed
        self.embedding_separator = embedding_separator
        self.suffix = suffix
        self.prefix = prefix

    def _create_json_payload(self, text: str, generation_kwargs: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Returns A dictionary of JSON arguments for a POST request to an Ollama service
        """
        return {"model": self.model, "prompt": text, "options": {**self.generation_kwargs, **(generation_kwargs or {})}}

    def _prepare_texts_to_embed(self, documents: List[Document]) -> List[str]:
        """
        Prepares the texts to embed by concatenating the Document text with the metadata fields to embed.
        """
        texts_to_embed = []
        for doc in documents:
            if self.meta_fields_to_embed is not None:
                meta_values_to_embed = [
                    str(doc.meta[key])
                    for key in self.meta_fields_to_embed
                    if key in doc.meta and doc.meta[key] is not None
                ]
            else:
                meta_values_to_embed = []

            text_to_embed = (
                self.prefix + self.embedding_separator.join([*meta_values_to_embed, doc.content or ""]) + self.suffix
            ).replace("\n", " ")

            texts_to_embed.append(text_to_embed)
        return texts_to_embed

    def _embed_batch(
        self, texts_to_embed: List[str], batch_size: int, generation_kwargs: Optional[Dict[str, Any]] = None
    ):
        """
        Ollama Embedding only allows single uploads, not batching. Currently the batch size is set to 1.
        If this changes in the future, line 86 (the first line within the for loop), can contain:
            batch = texts_to_embed[i + i + batch_size]
        """

        all_embeddings = []
        meta: Dict[str, Any] = {"model": ""}

        for i in tqdm(
            range(0, len(texts_to_embed), batch_size), disable=not self.progress_bar, desc="Calculating embeddings"
        ):
            batch = texts_to_embed[i]  # Single batch only
            payload = self._create_json_payload(batch, generation_kwargs)
            response = requests.post(url=self.url, json=payload, timeout=self.timeout)
            response.raise_for_status()
            result = response.json()
            all_embeddings.append(result["embedding"])

        meta["model"] = self.model

        return all_embeddings, meta

    @component.output_types(documents=List[Document], meta=Dict[str, Any])
    def run(self, documents: List[Document], generation_kwargs: Optional[Dict[str, Any]] = None):
        """
        Runs an Ollama Model to compute embeddings of the provided documents.

        :param documents:
            Documents to be converted to an embedding.
        :param generation_kwargs:
            Optional arguments to pass to the Ollama generation endpoint, such as temperature,
            top_p, etc. See the
            [Ollama docs](https://github.com/jmorganca/ollama/blob/main/docs/modelfile.md#valid-parameters-and-values).
        :returns: A dictionary with the following keys:
            - `documents`: Documents with embedding information attached
            - `meta`: The metadata collected during the embedding process
        """
        if not isinstance(documents, list) or documents and not isinstance(documents[0], Document):
            msg = (
                "OllamaDocumentEmbedder expects a list of Documents as input."
                "In case you want to embed a list of strings, please use the OllamaTextEmbedder."
            )
            raise TypeError(msg)

        texts_to_embed = self._prepare_texts_to_embed(documents=documents)
        embeddings, meta = self._embed_batch(
            texts_to_embed=texts_to_embed, batch_size=self.batch_size, generation_kwargs=generation_kwargs
        )

        for doc, emb in zip(documents, embeddings):
            doc.embedding = emb

        return {"documents": documents, "meta": meta}
