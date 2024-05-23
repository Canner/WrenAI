from typing import Any, AnyStr, Dict, List, Optional

import orjson
from haystack import Pipeline
from haystack.components.builders import PromptBuilder

from src.core.pipeline import BasicPipeline
from src.core.provider import DocumentStoreProvider, LLMProvider
from src.utils import init_providers

_TEMPLATE = """
There are numerous experts dedicated to generating semantic descriptions and names for various types of 
data. They are working together to provide a comprehensive and accurate description of the data.

### EXTRA INFORMATION ###
Given the following information to improve the description generation.

Context: 
{% for document in documents %}
    {{ document.content }}
{% endfor %}

### INSTRUCTIONS ###
- Provide a brief summary of the specified identifier as the description.
- Name the display_name based on the description, using natural language.

### TASK ###
Given the input model, provide a description of the specified identifier.

### MODEL STRUCTURE ###
Model Structure: {{ mdl }}

### MODEL NAME ###
Model Name: {{ model }}

### IDENTIFIER ###
the types for the identifier include: model, column@column_name
Identifier: {{ identifier }}

### OUTPUT FORMAT ###
The output format must be in JSON format:
{
 "identifier": "<IDENTIFIER>",
 "display_name": "<DISPLAY_NAME>",
 "description": "<DESCRIPTION>"
}

The output format doesn't need a markdown JSON code block.
"""


class Generation(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        document_store_provider: DocumentStoreProvider,
    ):
        self._prompt_builder = PromptBuilder(template=_TEMPLATE)
        self._pipe = Pipeline()
        self._pipe.add_component("text_embedder", llm_provider.get_text_embedder())
        self._pipe.add_component(
            "retriever",
            document_store_provider.get_retriever(document_store_provider.get_store()),
        )
        self._pipe.add_component("prompt_builder", self._prompt_builder)
        self._pipe.add_component("llm", llm_provider.get_generator())

        self._pipe.connect("text_embedder.embedding", "retriever.query_embedding")
        self._pipe.connect("retriever", "prompt_builder.documents")
        self._pipe.connect("prompt_builder", "llm")

        super().__init__(self._pipe)

    def run(
        self,
        *,
        mdl: Dict[AnyStr, Any],
        model: str,
        identifier: Optional[str] = None,
        include_outputs_from: List[str] | None = None,
    ):
        return self._pipe.run(
            {
                "prompt_builder": {
                    "mdl": mdl,
                    "model": model,
                    "identifier": identifier,
                },
                "text_embedder": {
                    "text": f"model: {model}, identifier: {identifier}",
                },
            },
            include_outputs_from=(
                set(include_outputs_from) if include_outputs_from else None
            ),
        )


if __name__ == "__main__":
    llm_provider, document_store_provider = init_providers()
    pipe = Generation(
        llm_provider=llm_provider,
        document_store_provider=document_store_provider,
    )

    res = pipe.run(
        **{
            "mdl": {
                "name": "all_star",
                "properties": {},
                "refsql": 'select * from "wrenai".spider."baseball_1-all_star"',
                "columns": [
                    {
                        "name": "player_id",
                        "type": "varchar",
                        "notnull": False,
                        "iscalculated": False,
                        "expression": "player_id",
                        "properties": {},
                    },
                    {
                        "name": "year",
                        "type": "integer",
                        "notnull": False,
                        "iscalculated": False,
                        "expression": "year",
                        "properties": {},
                    },
                    {
                        "name": "game_num",
                        "type": "integer",
                        "notnull": False,
                        "iscalculated": False,
                        "expression": "game_num",
                        "properties": {},
                    },
                    {
                        "name": "game_id",
                        "type": "varchar",
                        "notnull": False,
                        "iscalculated": False,
                        "expression": "game_id",
                        "properties": {},
                    },
                    {
                        "name": "team_id",
                        "type": "varchar",
                        "notnull": False,
                        "iscalculated": False,
                        "expression": "team_id",
                        "properties": {},
                    },
                    {
                        "name": "league_id",
                        "type": "varchar",
                        "notnull": False,
                        "iscalculated": False,
                        "expression": "league_id",
                        "properties": {},
                    },
                    {
                        "name": "gp",
                        "type": "real",
                        "notnull": False,
                        "iscalculated": False,
                        "expression": "gp",
                        "properties": {},
                    },
                    {
                        "name": "starting_pos",
                        "type": "real",
                        "notnull": False,
                        "iscalculated": False,
                        "expression": "starting_pos",
                        "properties": {},
                    },
                ],
                "primarykey": "",
            },
            "model": "all_star",
            "identifier": "model",
        }
    )
    print(res)
    print(res["llm"]["replies"][0])
    content = orjson.loads(res["llm"]["replies"][0])
    print(content)

    pipe.draw("./outputs/pipelines/semantics/description.jpg")
