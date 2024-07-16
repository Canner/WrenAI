from deepeval.metrics import BaseMetric
from deepeval.test_case import LLMTestCase


# Inherit BaseMetric
class ExampleMetric(BaseMetric):
    # This metric by default checks if the latency is greater than 10 seconds
    def __init__(self):
        self.threshold = 10

    def measure(self, test_case: LLMTestCase):
        # Set self.success and self.score in the "measure" method
        self.success = test_case.actual_output is not None
        if self.success:
            self.score = 1
        else:
            self.score = 0

        # You can also optionally set a reason for the score returned.
        # This is particularly useful for a score computed using LLMs
        self.reason = "Too slow!"
        return self.score

    async def a_measure(self, test_case: LLMTestCase):
        return self.measure(test_case)

    def is_successful(self):
        return self.success

    @property
    def __name__(self):
        return "Example"
