import asyncio
import os

from deepeval.metrics import BaseMetric
from deepeval.test_case import LLMTestCase

from eval.metrics.spider import Evaluator, build_foreign_key_map_from_json, tokenize
from eval.metrics.spider.process_sql import Schema, get_schema


class ExactMatchAccuracy(BaseMetric):
    def __init__(
        self,
        kmap_path: str = "./tools/dev/etc/spider1.0/spider_data/tables.json",
        db_dir: str = "./tools/dev/etc/spider1.0/database",
    ):
        self.threshold = 0
        self.score = 0
        self.kmaps = build_foreign_key_map_from_json(kmap_path)

        self.db_dir = db_dir

    def measure(self, test_case: LLMTestCase):
        return asyncio.run(self.a_measure(test_case))

    async def a_measure(self, test_case: LLMTestCase, *args, **kwargs):
        if not test_case.additional_metadata["enable_spider_metrics"]:
            self.success = True
            return 0

        db_name = test_case.additional_metadata["catalog"]
        db = os.path.join(self.db_dir, db_name, db_name + ".sqlite")
        schema = Schema(get_schema(db))
        gold_sql = tokenize(test_case.expected_output, schema, self.kmaps[db_name])
        pred_sql = tokenize(test_case.actual_output, schema, self.kmaps[db_name])

        evaluator = Evaluator()
        self.score = evaluator.eval_exact_match(pred_sql, gold_sql)
        self.success = self.score >= self.threshold

        return self.score

    def is_successful(self):
        return self.success

    @property
    def __name__(self):
        return "ExactMatchAccuracy"


if __name__ == "__main__":
    metric = ExactMatchAccuracy()
    test_case = LLMTestCase(
        input="",
        expected_output="SELECT COUNT(DISTINCT Nationality) FROM people",
        actual_output='SELECT COUNT(DISTINCT "Nationality") AS "nationality_count" FROM "people"',
        additional_metadata={"catalog": "poker_player"},
    )
    print(metric.measure(test_case))
