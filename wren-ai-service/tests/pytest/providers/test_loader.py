from src.providers import loader


def test_import_mods():
    loader.import_mods("src.providers")
    assert len(loader.PROVIDERS) == 3


def test_get_provider():
    loader.import_mods("src.providers")

    provider = loader.get_provider("openai")
    assert provider.__name__ == "OpenAILLMProvider"

    provider = loader.get_provider("qdrant")
    assert provider.__name__ == "QdrantProvider"

    provider = loader.get_provider("azure_openai")
    assert provider.__name__ == "AzureOpenAILLMProvider"
