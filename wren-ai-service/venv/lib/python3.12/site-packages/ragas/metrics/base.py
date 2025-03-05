from __future__ import annotations

import asyncio
import logging
import typing as t
from abc import ABC, abstractmethod
from collections import Counter
from dataclasses import dataclass, field
from enum import Enum

from pydantic import ValidationError
from tqdm import tqdm

from ragas._analytics import EvaluationEvent, _analytics_batcher
from ragas.callbacks import ChainType, new_group
from ragas.dataset_schema import MetricAnnotation, MultiTurnSample, SingleTurnSample
from ragas.executor import is_event_loop_running
from ragas.losses import BinaryMetricLoss, MSELoss
from ragas.prompt import FewShotPydanticPrompt, PromptMixin
from ragas.run_config import RunConfig
from ragas.utils import camel_to_snake, deprecated, get_metric_language

if t.TYPE_CHECKING:
    from langchain_core.callbacks import Callbacks

    from ragas.config import DemonstrationConfig, InstructionConfig
    from ragas.embeddings import BaseRagasEmbeddings
    from ragas.llms import BaseRagasLLM

logger = logging.getLogger(__name__)


VALID_COLUMNS = [
    "user_input",
    "retrieved_contexts",
    "reference_contexts",
    "response",
    "reference",
    "rubric",
]


class MetricType(Enum):
    """
    Enumeration of metric types in Ragas.

    Attributes
    ----------
    SINGLE_TURN : str
        Represents a single-turn metric type.
    MULTI_TURN : str
        Represents a multi-turn metric type.
    """

    SINGLE_TURN = "single_turn"
    MULTI_TURN = "multi_turn"


class MetricOutputType(Enum):
    BINARY = "binary"
    DISCRETE = "discrete"
    CONTINUOUS = "continuous"
    RANKING = "ranking"


@dataclass
class Metric(ABC):
    """
    Abstract base class for metrics in Ragas.

    Attributes
    ----------
    name : str
        The name of the metric.
    required_columns : Dict[str, Set[str]]
        A dictionary mapping metric type names to sets of required column names. This is
        a property and raises `ValueError` if columns are not in `VALID_COLUMNS`.
    """

    _required_columns: t.Dict[MetricType, t.Set[str]] = field(default_factory=dict)
    name: str = field(default="", repr=True)

    def __post_init__(self):
        if self.name == "":
            self.name = camel_to_snake(self.__class__.__name__)

    @property
    def required_columns(self) -> t.Dict[str, t.Set[str]]:
        required_columns = {}
        # ignore any value that contains ":optional"
        for k, v in self._required_columns.items():
            required_columns[k.name] = {
                column for column in v if not column.endswith(":optional")
            }
        return required_columns

    @required_columns.setter
    def required_columns(self, required_columns: t.Dict[MetricType, t.Set[str]]):
        rc = {}
        for metric_type, columns in required_columns.items():
            for column in columns:
                if column not in VALID_COLUMNS:
                    raise ValueError(
                        f"Invalid column '{column}'. Must be one of {VALID_COLUMNS}"
                    )
            rc[metric_type] = columns
        self._required_columns = rc

    def get_required_columns(
        self, with_optional: bool = False
    ) -> t.Dict[str, t.Set[str]]:
        if with_optional:
            # get all the required columns with optional columns, remove the optional suffix
            required_columns = {}
            for k, v in self._required_columns.items():
                # if any column ends with ":optional", add it to the required columns after removing the suffix
                required_columns[k.name] = set()
                for column in v:
                    if column.endswith(":optional"):
                        required_columns[k.name].add(column[: -len(":optional")])
                    else:
                        required_columns[k.name].add(column)
            return required_columns
        else:
            return self.required_columns

    @abstractmethod
    def init(self, run_config: RunConfig): ...

    @deprecated("0.2", removal="0.3", alternative="single_turn_ascore")
    def score(self, row: t.Dict, callbacks: Callbacks = None) -> float:
        """
        Calculates the score for a single row of data.

        Note
        ----
        This method is deprecated and will be removed in 0.3. Please use `single_turn_ascore` or `multi_turn_ascore` instead.
        """
        callbacks = callbacks or []
        rm, group_cm = new_group(
            self.name,
            inputs=row,
            callbacks=callbacks,
            metadata={"type": ChainType.METRIC},
        )
        try:
            if is_event_loop_running():
                try:
                    import nest_asyncio

                    nest_asyncio.apply()
                except ImportError:
                    raise ImportError(
                        "It seems like your running this in a jupyter-like environment. Please install nest_asyncio with `pip install nest_asyncio` to make it work."
                    )
            loop = asyncio.get_event_loop()
            score = loop.run_until_complete(self._ascore(row=row, callbacks=group_cm))
        except Exception as e:
            if not group_cm.ended:
                rm.on_chain_error(e)
            raise e
        else:
            if not group_cm.ended:
                rm.on_chain_end({"output": score})
        return score

    @deprecated("0.2", removal="0.3", alternative="single_turn_ascore")
    async def ascore(
        self,
        row: t.Dict,
        callbacks: Callbacks = None,
        timeout: t.Optional[float] = None,
    ) -> float:
        """
        Asynchronously calculates the score for a single row of data.

        Note
        ----
        This method is deprecated and will be removed in 0.3. Please use `single_turn_ascore` instead.
        """
        callbacks = callbacks or []
        rm, group_cm = new_group(
            self.name,
            inputs=row,
            callbacks=callbacks,
            metadata={"type": ChainType.METRIC},
        )
        try:
            score = await asyncio.wait_for(
                self._ascore(row=row, callbacks=group_cm),
                timeout=timeout,
            )
        except Exception as e:
            if not group_cm.ended:
                rm.on_chain_error(e)
            raise e
        else:
            if not group_cm.ended:
                rm.on_chain_end({"output": score})
        return score

    async def _ascore(self, row: t.Dict, callbacks: Callbacks) -> float:
        raise NotImplementedError(
            f"Metric '{self.name}' has no implementation for _ascore. score() is deprecated and will be removed in 0.3. Please use single_turn_ascore or multi_turn_ascore instead."
        )


@dataclass
class MetricWithLLM(Metric, PromptMixin):
    """
    A metric class that uses a language model for evaluation.

    Attributes
    ----------
    llm : Optional[BaseRagasLLM]
        The language model used for the metric.
    """

    llm: t.Optional[BaseRagasLLM] = None
    output_type: t.Optional[MetricOutputType] = None

    def init(self, run_config: RunConfig):
        if self.llm is None:
            raise ValueError(
                f"Metric '{self.name}' has no valid LLM provided (self.llm is None). Please initantiate a the metric with an LLM to run."  # noqa
            )
        self.llm.set_run_config(run_config)

    def _optimize_instruction(
        self,
        instruction_config: InstructionConfig,
        dataset: MetricAnnotation,
        callbacks: Callbacks,
        run_config: RunConfig,
        batch_size: t.Optional[int],
        with_debugging_logs: bool,
        raise_exceptions: bool,
    ):
        if self.llm is None:
            raise ValueError(
                f"Metric '{self.name}' has no valid LLM provided (self.llm is None). Please initantiate a the metric with an LLM to run."  # noqa
            )
        optimizer = instruction_config.optimizer
        if optimizer.llm is None:
            optimizer.llm = instruction_config.llm

        # figure out the loss function
        if instruction_config.loss is None:
            if self.output_type is None:
                raise ValueError(
                    f"Output type for metric '{self.name}' is not defined. Please set the output type in the metric or in the instruction config."
                )
            if self.output_type.name == MetricOutputType.BINARY.name:
                loss_fun = BinaryMetricLoss()
            elif (
                self.output_type.name == MetricOutputType.CONTINUOUS.name
                or self.output_type.name == MetricOutputType.DISCRETE.name
            ):
                loss_fun = MSELoss()
            else:
                raise NotImplementedError(
                    f"Output type '{self.output_type.name}' not implemented"
                )
        else:
            loss_fun = instruction_config.loss

        # Optimize the prompts
        optimizer.metric = self
        optimizer_config = instruction_config.optimizer_config or {}
        optimized_prompts = optimizer.optimize(
            dataset[self.name],
            loss_fun,
            optimizer_config,
            callbacks=callbacks,
            run_config=run_config,
            batch_size=batch_size,
            with_debugging_logs=with_debugging_logs,
            raise_exceptions=raise_exceptions,
        )

        # replace the instruction in the metric with the optimized instruction
        prompts = self.get_prompts()
        for key, val in optimized_prompts.items():
            prompts[key].instruction = val
        self.set_prompts(**prompts)

    def _optimize_demonstration(
        self, demonstration_config: DemonstrationConfig, dataset: MetricAnnotation
    ):
        # get the prompt annotations for this metric
        prompt_annotations = dataset[self.name].get_prompt_annotations()
        prompts = self.get_prompts()
        for prompt_name, prompt_annotation_list in prompt_annotations.items():
            # create a new FewShotPydanticPrompt with these annotations
            if prompt_name not in prompts:
                raise ValueError(
                    f"Prompt '{prompt_name}' not found in metric '{self.name}'. Please check the prompt names in the annotation dataset."
                )
            pydantic_prompt = prompts[prompt_name]
            input_model, output_model = (
                pydantic_prompt.input_model,
                pydantic_prompt.output_model,
            )
            # convert annotations into examples
            input_examples, output_examples = [], []
            for i, prompt_annotation in enumerate(prompt_annotation_list):
                try:
                    input_examples.append(
                        input_model.model_validate(prompt_annotation.prompt_input)
                    )
                    # use the edited output if it is provided
                    if prompt_annotation.edited_output is not None:
                        output_examples.append(
                            output_model.model_validate(prompt_annotation.edited_output)
                        )
                    else:
                        output_examples.append(
                            output_model.model_validate(prompt_annotation.prompt_output)
                        )
                except ValidationError as e:
                    logger.warning(
                        f"Skipping prompt '{prompt_name}' example {i} because of validation error: {e}"
                    )
                    continue
            embedding_model = demonstration_config.embedding
            few_shot_prompt = FewShotPydanticPrompt.from_pydantic_prompt(
                pydantic_prompt=pydantic_prompt,
                embeddings=embedding_model,
            )

            # add the top k examples to the few shot prompt
            few_shot_prompt.top_k_for_examples = demonstration_config.top_k
            few_shot_prompt.threshold_for_examples = demonstration_config.threshold

            # add examples to the few shot prompt
            for input_example, output_example in tqdm(
                zip(input_examples, output_examples),
                total=len(input_examples),
                desc=f"Few-shot examples [{prompt_name}]",
            ):
                few_shot_prompt.add_example(input_example, output_example)
            prompts[prompt_name] = few_shot_prompt
        self.set_prompts(**prompts)

    def train(
        self,
        path: t.Optional[str] = None,
        run_id: t.Optional[str] = None,
        demonstration_config: t.Optional[DemonstrationConfig] = None,
        instruction_config: t.Optional[InstructionConfig] = None,
        callbacks: t.Optional[Callbacks] = None,
        run_config: t.Optional[RunConfig] = None,
        batch_size: t.Optional[int] = None,
        with_debugging_logs=False,
        raise_exceptions: bool = True,
    ) -> None:
        """
        Train the metric using local JSON data or annotations from Ragas platform

        Parameters
        ----------
        path : str, optional
            Path to local JSON training data file
        run_id : str, optional
            Direct run ID to fetch annotations
        demonstration_config : DemonstrationConfig, optional
            Configuration for demonstration optimization
        instruction_config : InstructionConfig, optional
            Configuration for instruction optimization
        callbacks : Callbacks, optional
            List of callback functions
        run_config : RunConfig, optional
            Run configuration
        batch_size : int, optional
            Batch size for training
        with_debugging_logs : bool, default=False
            Enable debugging logs
        raise_exceptions : bool, default=True
            Whether to raise exceptions during training

        Raises
        ------
        ValueError
            If invalid combination of path, and run_id is provided
        """
        # Validate input parameters
        provided_inputs = sum(x is not None for x in [path, run_id])
        if provided_inputs == 0:
            raise ValueError("One of path or run_id must be provided")
        if provided_inputs > 1:
            raise ValueError("Only one of path or run_id should be provided")

        run_config = run_config or RunConfig()
        callbacks = callbacks or []

        # Load the dataset based on input type
        if path is not None:
            if not path.endswith(".json"):
                raise ValueError("Train data must be in json format")
            dataset = MetricAnnotation.from_json(path, metric_name=self.name)
        elif run_id is not None:
            dataset = MetricAnnotation.from_app(
                run_id=run_id,
                metric_name=self.name,
            )
        else:
            raise ValueError("One of path or run_id must be provided")

        # only optimize the instruction if instruction_config is provided
        if instruction_config is not None:
            self._optimize_instruction(
                instruction_config=instruction_config,
                dataset=dataset,
                callbacks=callbacks,
                run_config=run_config,
                batch_size=batch_size,
                with_debugging_logs=with_debugging_logs,
                raise_exceptions=raise_exceptions,
            )

        # if demonstration_config is provided, optimize the demonstrations
        if demonstration_config is not None:
            self._optimize_demonstration(
                demonstration_config=demonstration_config,
                dataset=dataset,
            )


@dataclass
class MetricWithEmbeddings(Metric):
    embeddings: t.Optional[BaseRagasEmbeddings] = None

    def init(self, run_config: RunConfig):
        if self.embeddings is None:
            raise ValueError(
                f"Metric '{self.name}' has no valid embeddings provided (self.embeddings is None). Please initantiate a the metric with an embeddings to run."  # noqa
            )
        self.embeddings.set_run_config(run_config)


class SingleTurnMetric(Metric):
    """
    A metric class for evaluating single-turn interactions.

    This class provides methods to score single-turn samples, both synchronously and asynchronously.
    """

    def _only_required_columns_single_turn(
        self, sample: SingleTurnSample
    ) -> SingleTurnSample:
        """
        Simplify the sample to only include the required columns.
        """
        required_columns = self.get_required_columns(with_optional=True).get(
            MetricType.SINGLE_TURN.name, set()
        )
        if not required_columns:
            return sample
        return SingleTurnSample(**sample.model_dump(include=required_columns))

    def single_turn_score(
        self,
        sample: SingleTurnSample,
        callbacks: Callbacks = None,
    ) -> float:
        """
        Synchronously score a single-turn sample.

        May raise ImportError if nest_asyncio is not installed in a Jupyter-like environment.
        """
        callbacks = callbacks or []
        # only get the required columns
        sample = self._only_required_columns_single_turn(sample)
        rm, group_cm = new_group(
            self.name,
            inputs=sample.to_dict(),
            callbacks=callbacks,
            metadata={"type": ChainType.METRIC},
        )
        try:
            if is_event_loop_running():
                try:
                    import nest_asyncio

                    nest_asyncio.apply()
                except ImportError:
                    raise ImportError(
                        "It seems like your running this in a jupyter-like environment. Please install nest_asyncio with `pip install nest_asyncio` to make it work."
                    )
            loop = asyncio.get_event_loop()
            score = loop.run_until_complete(
                self._single_turn_ascore(sample=sample, callbacks=group_cm)
            )
        except Exception as e:
            if not group_cm.ended:
                rm.on_chain_error(e)
            raise e
        else:
            if not group_cm.ended:
                rm.on_chain_end({"output": score})

        # track the evaluation event
        _analytics_batcher.add_evaluation(
            EvaluationEvent(
                metrics=[self.name],
                num_rows=1,
                evaluation_type=MetricType.SINGLE_TURN.name,
                language=get_metric_language(self),
            )
        )
        return score

    async def single_turn_ascore(
        self,
        sample: SingleTurnSample,
        callbacks: Callbacks = None,
        timeout: t.Optional[float] = None,
    ) -> float:
        """
        Asynchronously score a single-turn sample with an optional timeout.

        May raise asyncio.TimeoutError if the scoring process exceeds the specified timeout.
        """
        callbacks = callbacks or []
        # only get the required columns
        sample = self._only_required_columns_single_turn(sample)
        rm, group_cm = new_group(
            self.name,
            inputs=sample.to_dict(),
            callbacks=callbacks,
            metadata={"type": ChainType.METRIC},
        )
        try:
            score = await asyncio.wait_for(
                self._single_turn_ascore(sample=sample, callbacks=group_cm),
                timeout=timeout,
            )
        except Exception as e:
            if not group_cm.ended:
                rm.on_chain_error(e)
            raise e
        else:
            if not group_cm.ended:
                rm.on_chain_end({"output": score})

        # track the evaluation event
        _analytics_batcher.add_evaluation(
            EvaluationEvent(
                metrics=[self.name],
                num_rows=1,
                evaluation_type=MetricType.SINGLE_TURN.name,
                language=get_metric_language(self),
            )
        )
        return score

    @abstractmethod
    async def _single_turn_ascore(
        self,
        sample: SingleTurnSample,
        callbacks: Callbacks,
    ) -> float:
        """
        Abstract method to be implemented by subclasses for actual scoring logic.
        """
        ...


class MultiTurnMetric(Metric):
    """
    A metric class for evaluating multi-turn conversations.

    This class extends the base Metric class to provide functionality
    for scoring multi-turn conversation samples.
    """

    def _only_required_columns_multi_turn(
        self, sample: MultiTurnSample
    ) -> MultiTurnSample:
        """
        Simplify the sample to only include the required columns.
        """
        required_columns = self.get_required_columns(with_optional=True).get(
            MetricType.MULTI_TURN.name, set()
        )
        if not required_columns:
            return sample
        return MultiTurnSample(**sample.model_dump(include=required_columns))

    def multi_turn_score(
        self,
        sample: MultiTurnSample,
        callbacks: Callbacks = None,
    ) -> float:
        """
        Score a multi-turn conversation sample synchronously.

        May raise ImportError if nest_asyncio is not installed in Jupyter-like environments.
        """
        callbacks = callbacks or []
        sample = self._only_required_columns_multi_turn(sample)
        rm, group_cm = new_group(
            self.name,
            inputs=sample.to_dict(),
            callbacks=callbacks,
            metadata={"type": ChainType.METRIC},
        )
        try:
            if is_event_loop_running():
                try:
                    import nest_asyncio

                    nest_asyncio.apply()
                except ImportError:
                    raise ImportError(
                        "It seems like your running this in a jupyter-like environment. Please install nest_asyncio with `pip install nest_asyncio` to make it work."
                    )
            loop = asyncio.get_event_loop()
            score = loop.run_until_complete(
                self._multi_turn_ascore(sample=sample, callbacks=group_cm)
            )
        except Exception as e:
            if not group_cm.ended:
                rm.on_chain_error(e)
            raise e
        else:
            if not group_cm.ended:
                rm.on_chain_end({"output": score})

        # track the evaluation event
        _analytics_batcher.add_evaluation(
            EvaluationEvent(
                metrics=[self.name],
                num_rows=1,
                evaluation_type=MetricType.SINGLE_TURN.name,
                language=get_metric_language(self),
            )
        )
        return score

    async def multi_turn_ascore(
        self,
        sample: MultiTurnSample,
        callbacks: Callbacks = None,
        timeout: t.Optional[float] = None,
    ) -> float:
        """
        Score a multi-turn conversation sample asynchronously.

        May raise asyncio.TimeoutError if the scoring process exceeds the specified timeout.
        """
        callbacks = callbacks or []
        sample = self._only_required_columns_multi_turn(sample)

        rm, group_cm = new_group(
            self.name,
            inputs=sample.to_dict(),
            callbacks=callbacks,
            metadata={"type": ChainType.METRIC},
        )
        try:
            score = await asyncio.wait_for(
                self._multi_turn_ascore(sample=sample, callbacks=group_cm),
                timeout=timeout,
            )
        except Exception as e:
            if not group_cm.ended:
                rm.on_chain_error(e)
            raise e
        else:
            if not group_cm.ended:
                rm.on_chain_end({"output": score})

        # track the evaluation event
        _analytics_batcher.add_evaluation(
            EvaluationEvent(
                metrics=[self.name],
                num_rows=1,
                evaluation_type=MetricType.SINGLE_TURN.name,
                language=get_metric_language(self),
            )
        )

        return score

    @abstractmethod
    async def _multi_turn_ascore(
        self,
        sample: MultiTurnSample,
        callbacks: Callbacks,
    ) -> float:
        """
        Abstract method to be implemented by subclasses for actual multi-turn scoring logic.
        """
        ...


class Ensember:
    """
    Combine multiple llm outputs for same input (n>1) to a single output
    """

    def from_discrete(
        self, inputs: list[list[t.Dict]], attribute: str
    ) -> t.List[t.Dict]:
        """
        Simple majority voting for binary values, ie [0,0,1] -> 0
        inputs: list of list of dicts each containing verdict for a single input
        """

        if not isinstance(inputs, list):
            inputs = [inputs]

        if not all(len(item) == len(inputs[0]) for item in inputs):
            logger.warning("All inputs must have the same length")
            return inputs[0]

        if not all(attribute in item for input in inputs for item in input):
            logger.warning(f"All inputs must have {attribute} attribute")
            return inputs[0]

        if len(inputs) == 1:
            return inputs[0]

        verdict_agg = []
        for i in range(len(inputs[0])):
            item = inputs[0][i]
            verdicts = [inputs[k][i][attribute] for k in range(len(inputs))]
            verdict_counts = dict(Counter(verdicts).most_common())
            item[attribute] = list(verdict_counts.keys())[0]
            verdict_agg.append(item)

        return verdict_agg


ensembler = Ensember()
