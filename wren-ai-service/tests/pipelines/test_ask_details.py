from src.pipelines.ask_details.generation_pipeline import Generation
from src.utils import init_providers
from src.web.v1.services.ask_details import (
    AskDetailsResultResponse,
)


def test_generation_pipeline():
    llm_provider, _ = init_providers()
    generation_pipeline = Generation(
        generator=llm_provider.get_generator(),
    )

    generation_result = generation_pipeline.run(
        "SELECT * FROM book",
    )

    assert AskDetailsResultResponse.AskDetailsResponseDetails(
        **generation_result["post_processor"]["results"]
    )
