import asyncio
import os

from deepeval.metrics import BaseMetric
from deepeval.test_case import LLMTestCase

from eval.metrics.spider import eval_exec_match


class ExecutionAccuracy(BaseMetric):
    def __init__(
        self,
        db_dir: str = "./tools/dev/etc/spider1.0/database",
    ):
        self.threshold = 0
        self.score = 0

        self.db_dir = db_dir

    def measure(self, test_case: LLMTestCase):
        return asyncio.run(self.a_measure(test_case))

    async def a_measure(self, test_case: LLMTestCase, *args, **kwargs):
        if not test_case.additional_metadata["enable_spider_metrics"]:
            self.success = True
            return 0

        db_name = test_case.additional_metadata["catalog"]
        db = os.path.join(self.db_dir, db_name, db_name + ".sqlite")

        self.score = await eval_exec_match(
            db=db,
            p_str=test_case.actual_output,
            g_str=test_case.expected_output,
        )

        self.success = self.score >= self.threshold

        return self.score

    def is_successful(self):
        return self.success

    @property
    def __name__(self):
        return "ExecutionAccuracy"


if __name__ == "__main__":
    metric = ExecutionAccuracy()
    test_case = LLMTestCase(
        input="",
        expected_output="SELECT COUNT(DISTINCT Nationality) FROM people",
        actual_output='SELECT COUNT(DISTINCT "Nationality") AS "nationality_count" FROM "people"',
        additional_metadata={"catalog": "poker_player"},
    )
    print(metric.measure(test_case))
