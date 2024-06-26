from src.providers import loader


def test_import_mods():
    loader.import_mods("src.providers")
    assert len(loader.PROVIDERS) == 6


def test_get_provider():
    loader.import_mods("src.providers")

    # llm provider
    provider = loader.get_provider("openai")
    assert provider.__name__ == "OpenAILLMProvider"

    provider = loader.get_provider("azure_openai")
    assert provider.__name__ == "AzureOpenAILLMProvider"

    provider = loader.get_provider("ollama")
    assert provider.__name__ == "OllamaLLMProvider"

    # document store provider
    provider = loader.get_provider("qdrant")
    assert provider.__name__ == "QdrantProvider"

    # engine provider
    provider = loader.get_provider("wren-ui")
    assert provider.__name__ == "WrenUI"

    provider = loader.get_provider("wren-ibis")
    assert provider.__name__ == "WrenIbis"
