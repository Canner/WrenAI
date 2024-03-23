from src.pipelines.ask_details.components.generator import (
    init_generator,
)
from src.pipelines.ask_details.generation_pipeline import Generation


# TODO: finish test_generation_pipeline for ask details pipeline
def test_generation_pipeline():
    generation_pipeline = Generation(
        generator=init_generator(),
    )

    generation_result = generation_pipeline.run(
        "How many books are there?",
    )

    print(generation_result)
