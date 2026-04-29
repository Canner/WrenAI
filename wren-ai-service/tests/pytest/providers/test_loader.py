from src.providers import loader


def test_import_mods():
    loader.import_mods("src.providers")
    assert len(loader.PROVIDERS) == 7


def test_get_provider():
    loader.import_mods("src.providers")

    # llm provider
    provider = loader.get_provider("litellm_llm")
    assert provider.__name__ == "LitellmLLMProvider"

    # minimax llm provider
    provider = loader.get_provider("minimax_llm")
    assert provider.__name__ == "MiniMaxLLMProvider"

    # embedder provider
    provider = loader.get_provider("litellm_embedder")
    assert provider.__name__ == "LitellmEmbedderProvider"

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
