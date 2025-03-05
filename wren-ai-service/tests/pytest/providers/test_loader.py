from src.providers import loader


def test_import_mods():
    loader.import_mods("src.providers")
    assert len(loader.PROVIDERS) == 11


def test_get_provider():
    loader.import_mods("src.providers")

    # llm provider
    provider = loader.get_provider("openai_llm")
    assert provider.__name__ == "OpenAILLMProvider"

    provider = loader.get_provider("azure_openai_llm")
    assert provider.__name__ == "AzureOpenAILLMProvider"

    provider = loader.get_provider("ollama_llm")
    assert provider.__name__ == "OllamaLLMProvider"

    provider = loader.get_provider("litellm_llm")
    assert provider.__name__ == "LitellmLLMProvider"

    # embedder provider
    provider = loader.get_provider("openai_embedder")
    assert provider.__name__ == "OpenAIEmbedderProvider"

    provider = loader.get_provider("azure_openai_embedder")
    assert provider.__name__ == "AzureOpenAIEmbedderProvider"

    provider = loader.get_provider("ollama_embedder")
    assert provider.__name__ == "OllamaEmbedderProvider"

    # document store provider
    provider = loader.get_provider("qdrant")
    assert provider.__name__ == "QdrantProvider"

    # engine provider
    provider = loader.get_provider("wren_ui")
    assert provider.__name__ == "WrenUI"

    provider = loader.get_provider("wren_ibis")
    assert provider.__name__ == "WrenIbis"

    provider = loader.get_provider("wren_engine")
    assert provider.__name__ == "WrenEngine"
