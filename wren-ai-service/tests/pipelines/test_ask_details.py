from src.pipelines.ask_details.components.generator import (
    init_generator,
)
from src.pipelines.ask_details.generation_pipeline import Generation
from src.web.v1.services.ask_details import (
    AskDetailsResultResponse,
)


# TODO: finish test_generation_pipeline for ask details pipeline
def test_generation_pipeline():
    generation_pipeline = Generation(
        sql_details_generator=init_generator(),
    )

    generation_result = generation_pipeline.run(
        "SELECT * FROM book",
    )

    assert AskDetailsResultResponse.AskDetailsResponseDetails(
        **generation_result["sql_details_post_processor"]["post_processing_results"]
    )
