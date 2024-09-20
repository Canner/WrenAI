from src.core.pipeline import PipelineComponent


def generate_components() -> dict[str, PipelineComponent]:
    # todo: I think the next is init provider by config and then assume to the pipe components
    # consider moving the provider initialization to the __init__.py file
    # providers = init_providers(
    #     engine_config=EngineConfig(provider=os.getenv("ENGINE", "wren_ui"))
    # )
    return {}
