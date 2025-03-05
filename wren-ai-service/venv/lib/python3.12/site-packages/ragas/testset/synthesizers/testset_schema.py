from __future__ import annotations

import typing as t
from dataclasses import dataclass, field
from datetime import datetime
from uuid import uuid4

from pydantic import BaseModel, Field

from ragas.cost import CostCallbackHandler, TokenUsage
from ragas.dataset_schema import (
    BaseSample,
    EvaluationDataset,
    MultiTurnSample,
    RagasDataset,
    SingleTurnSample,
)
from ragas.exceptions import UploadException
from ragas.sdk import get_app_url, upload_packet


class TestsetSample(BaseSample):
    """
    Represents a sample in a test set.

    Attributes
    ----------
    eval_sample : Union[SingleTurnSample, MultiTurnSample]
        The evaluation sample, which can be either a single-turn or multi-turn sample.
    synthesizer_name : str
        The name of the synthesizer used to generate this sample.
    """

    eval_sample: t.Union[SingleTurnSample, MultiTurnSample]
    synthesizer_name: str


class TestsetPacket(BaseModel):
    """
    A packet of testset samples to be uploaded to the server.
    """

    samples_original: t.List[TestsetSample]
    run_id: str
    created_at: str = Field(default_factory=lambda: datetime.now().isoformat())


@dataclass
class Testset(RagasDataset[TestsetSample]):
    """
    Represents a test set containing multiple test samples.

    Attributes
    ----------
    samples : List[TestsetSample]
        A list of TestsetSample objects representing the samples in the test set.
    """

    samples: t.List[TestsetSample]
    run_id: str = field(default_factory=lambda: str(uuid4()), repr=False, compare=False)
    cost_cb: t.Optional[CostCallbackHandler] = field(default=None, repr=False)

    def to_evaluation_dataset(self) -> EvaluationDataset:
        """
        Converts the Testset to an EvaluationDataset.
        """
        return EvaluationDataset(
            samples=[sample.eval_sample for sample in self.samples]
        )

    def to_list(self) -> t.List[t.Dict]:
        """
        Converts the Testset to a list of dictionaries.
        """
        list_dict = []
        for sample in self.samples:
            sample_dict = sample.eval_sample.model_dump(exclude_none=True)
            sample_dict["synthesizer_name"] = sample.synthesizer_name
            list_dict.append(sample_dict)
        return list_dict

    @classmethod
    def from_list(cls, data: t.List[t.Dict]) -> Testset:
        """
        Converts a list of dictionaries to a Testset.
        """
        # first create the samples
        samples = []
        for sample in data:
            synthesizer_name = sample["synthesizer_name"]
            # remove the synthesizer name from the sample
            sample.pop("synthesizer_name")
            # the remaining sample is the eval_sample
            eval_sample = sample

            # if user_input is a list it is MultiTurnSample
            if "user_input" in eval_sample and not isinstance(
                eval_sample.get("user_input"), list
            ):
                eval_sample = SingleTurnSample(**eval_sample)
            else:
                eval_sample = MultiTurnSample(**eval_sample)

            samples.append(
                TestsetSample(
                    eval_sample=eval_sample, synthesizer_name=synthesizer_name
                )
            )
        # then create the testset
        return Testset(samples=samples)

    def total_tokens(self) -> t.Union[t.List[TokenUsage], TokenUsage]:
        """
        Compute the total tokens used in the evaluation.
        """
        if self.cost_cb is None:
            raise ValueError(
                "The Testset was not configured for computing cost. Please provide a token_usage_parser function to TestsetGenerator to compute cost."
            )
        return self.cost_cb.total_tokens()

    def total_cost(
        self,
        cost_per_input_token: t.Optional[float] = None,
        cost_per_output_token: t.Optional[float] = None,
    ) -> float:
        """
        Compute the total cost of the evaluation.
        """
        if self.cost_cb is None:
            raise ValueError(
                "The Testset was not configured for computing cost. Please provide a token_usage_parser function to TestsetGenerator to compute cost."
            )
        return self.cost_cb.total_cost(
            cost_per_input_token=cost_per_input_token,
            cost_per_output_token=cost_per_output_token,
        )

    def upload(self, verbose: bool = True) -> str:
        packet = TestsetPacket(samples_original=self.samples, run_id=self.run_id)
        response = upload_packet(
            path="/alignment/testset",
            data_json_string=packet.model_dump_json(),
        )
        app_url = get_app_url()

        testset_endpoint = f"{app_url}/dashboard/alignment/testset/{self.run_id}"
        if response.status_code == 409:
            # this testset already exists
            if verbose:
                print(f"Testset already exists. View at {testset_endpoint}")
            return testset_endpoint
        elif response.status_code != 200:
            # any other error
            raise UploadException(
                status_code=response.status_code,
                message=f"Failed to upload results: {response.text}",
            )
        if verbose:
            print(f"Testset uploaded! View at {testset_endpoint}")
        return testset_endpoint

    @classmethod
    def from_annotated(cls, path: str) -> Testset:
        """
        Loads a testset from an annotated JSON file from app.ragas.io.
        """
        import json

        with open(path, "r") as f:
            annotated_testset = json.load(f)

        samples = []
        for sample in annotated_testset:
            if sample["approval_status"] == "approved":
                samples.append(TestsetSample(**sample))
        return cls(samples=samples)
