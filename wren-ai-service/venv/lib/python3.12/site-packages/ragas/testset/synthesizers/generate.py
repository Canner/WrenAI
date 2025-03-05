from __future__ import annotations

import logging
import random
import typing as t
from dataclasses import dataclass, field

from langchain_core.callbacks import BaseCallbackManager
from langchain_core.documents import Document as LCDocument

from ragas._analytics import TestsetGenerationEvent, track
from ragas.callbacks import new_group
from ragas.cost import TokenUsageParser
from ragas.embeddings.base import (
    BaseRagasEmbeddings,
    LangchainEmbeddingsWrapper,
    LlamaIndexEmbeddingsWrapper,
)
from ragas.executor import Executor
from ragas.llms import BaseRagasLLM, LangchainLLMWrapper, LlamaIndexLLMWrapper
from ragas.run_config import RunConfig
from ragas.testset.graph import KnowledgeGraph, Node, NodeType
from ragas.testset.persona import Persona, generate_personas_from_kg
from ragas.testset.synthesizers import default_query_distribution
from ragas.testset.synthesizers.testset_schema import Testset, TestsetSample
from ragas.testset.synthesizers.utils import calculate_split_values
from ragas.testset.transforms import Transforms, apply_transforms, default_transforms

if t.TYPE_CHECKING:
    from langchain_core.callbacks import Callbacks
    from langchain_core.embeddings import Embeddings as LangchainEmbeddings
    from langchain_core.language_models import BaseLanguageModel as LangchainLLM
    from llama_index.core.base.embeddings.base import (
        BaseEmbedding as LlamaIndexEmbedding,
    )
    from llama_index.core.base.llms.base import BaseLLM as LlamaIndexLLM
    from llama_index.core.schema import Document as LlamaIndexDocument

    from ragas.embeddings.base import BaseRagasEmbeddings
    from ragas.llms.base import BaseRagasLLM
    from ragas.testset.synthesizers import QueryDistribution
    from ragas.testset.synthesizers.base import BaseScenario


RAGAS_TESTSET_GENERATION_GROUP_NAME = "ragas testset generation"
logger = logging.getLogger(__name__)


@dataclass
class TestsetGenerator:
    """
    Generates an evaluation dataset based on given scenarios and parameters.

    Attributes
    ----------
    llm : BaseRagasLLM
        The language model to use for the generation process.
    knowledge_graph : KnowledgeGraph, default empty
        The knowledge graph to use for the generation process.
    """

    llm: BaseRagasLLM
    embedding_model: BaseRagasEmbeddings
    knowledge_graph: KnowledgeGraph = field(default_factory=KnowledgeGraph)
    persona_list: t.Optional[t.List[Persona]] = None

    @classmethod
    def from_langchain(
        cls,
        llm: LangchainLLM,
        embedding_model: LangchainEmbeddings,
        knowledge_graph: t.Optional[KnowledgeGraph] = None,
    ) -> TestsetGenerator:
        """
        Creates a `TestsetGenerator` from a Langchain LLMs.
        """
        knowledge_graph = knowledge_graph or KnowledgeGraph()
        return cls(
            LangchainLLMWrapper(llm),
            LangchainEmbeddingsWrapper(embedding_model),
            knowledge_graph,
        )

    @classmethod
    def from_llama_index(
        cls,
        llm: LlamaIndexLLM,
        embedding_model: LlamaIndexEmbedding,
        knowledge_graph: t.Optional[KnowledgeGraph] = None,
    ) -> TestsetGenerator:
        """
        Creates a `TestsetGenerator` from a LlamaIndex LLM and embedding model.
        """
        knowledge_graph = knowledge_graph or KnowledgeGraph()
        return cls(
            LlamaIndexLLMWrapper(llm),
            LlamaIndexEmbeddingsWrapper(embedding_model),
            knowledge_graph,
        )

    def generate_with_langchain_docs(
        self,
        documents: t.Sequence[LCDocument],
        testset_size: int,
        transforms: t.Optional[Transforms] = None,
        transforms_llm: t.Optional[BaseRagasLLM] = None,
        transforms_embedding_model: t.Optional[BaseRagasEmbeddings] = None,
        query_distribution: t.Optional[QueryDistribution] = None,
        run_config: t.Optional[RunConfig] = None,
        callbacks: t.Optional[Callbacks] = None,
        with_debugging_logs=False,
        raise_exceptions: bool = True,
    ) -> Testset:
        """
        Generates an evaluation dataset based on given Langchain documents and parameters.

        Parameters
        ----------
        documents : Sequence[LCDocument]
            A sequence of Langchain documents to use as source material
        testset_size : int
            The number of test samples to generate
        transforms : Optional[Transforms], optional
            Custom transforms to apply to the documents, by default None
        transforms_llm : Optional[BaseRagasLLM], optional
            LLM to use for transforms if different from instance LLM, by default None
        transforms_embedding_model : Optional[BaseRagasEmbeddings], optional
            Embedding model to use for transforms if different from instance model, by default None
        query_distribution : Optional[QueryDistribution], optional
            Distribution of query types to generate, by default None
        run_config : Optional[RunConfig], optional
            Configuration for the generation run, by default None
        callbacks : Optional[Callbacks], optional
            Callbacks to use during generation, by default None
        with_debugging_logs : bool, optional
            Whether to include debug logs, by default False
        raise_exceptions : bool, optional
            Whether to raise exceptions during generation, by default True

        Returns
        -------
        Testset
            The generated evaluation dataset

        Raises
        ------
        ValueError
            If no LLM or embedding model is provided either during initialization or as arguments
        """

        # force the user to provide an llm and embedding client to prevent use of default LLMs
        if not self.llm and not transforms_llm:
            raise ValueError(
                """An llm client was not provided.
                       Provide an LLM on TestsetGenerator instantiation or as an argument for transforms_llm parameter.
                       Alternatively you can provide your own transforms through the `transforms` parameter."""
            )
        if not self.embedding_model and not transforms_embedding_model:
            raise ValueError(
                """An embedding client was not provided. Provide an embedding through the transforms_embedding_model parameter. Alternatively you can provide your own transforms through the `transforms` parameter."""
            )

        if not transforms:
            transforms = default_transforms(
                documents=list(documents),
                llm=transforms_llm or self.llm,
                embedding_model=transforms_embedding_model or self.embedding_model,
            )

        # convert the documents to Ragas nodes
        nodes = []
        for doc in documents:
            node = Node(
                type=NodeType.DOCUMENT,
                properties={
                    "page_content": doc.page_content,
                    "document_metadata": doc.metadata,
                },
            )
            nodes.append(node)

        kg = KnowledgeGraph(nodes=nodes)

        # apply transforms and update the knowledge graph
        apply_transforms(kg, transforms)
        self.knowledge_graph = kg

        return self.generate(
            testset_size=testset_size,
            query_distribution=query_distribution,
            run_config=run_config,
            callbacks=callbacks,
            with_debugging_logs=with_debugging_logs,
            raise_exceptions=raise_exceptions,
        )

    def generate_with_llamaindex_docs(
        self,
        documents: t.Sequence[LlamaIndexDocument],
        testset_size: int,
        transforms: t.Optional[Transforms] = None,
        transforms_llm: t.Optional[LlamaIndexLLM] = None,
        transforms_embedding_model: t.Optional[LlamaIndexEmbedding] = None,
        query_distribution: t.Optional[QueryDistribution] = None,
        run_config: t.Optional[RunConfig] = None,
        callbacks: t.Optional[Callbacks] = None,
        with_debugging_logs=False,
        raise_exceptions: bool = True,
    ):
        """
        Generates an evaluation dataset based on given scenarios and parameters.
        """

        run_config = run_config or RunConfig()

        # force the user to provide an llm and embedding client to prevent use of default LLMs
        if not self.llm and not transforms_llm:
            raise ValueError(
                "An llm client was not provided. Provide an LLM on TestsetGenerator instantiation or as an argument for transforms_llm parameter. Alternatively you can provide your own transforms through the `transforms` parameter."
            )
        if not self.embedding_model and not transforms_embedding_model:
            raise ValueError(
                "An embedding client was not provided. Provide an embedding through the transforms_embedding_model parameter. Alternatively you can provide your own transforms through the `transforms` parameter."
            )

        if not transforms:
            # use TestsetGenerator's LLM and embedding model if no transforms_llm or transforms_embedding_model is provided
            if transforms_llm is None:
                llm_for_transforms = self.llm
            else:
                llm_for_transforms = LlamaIndexLLMWrapper(transforms_llm)
            if transforms_embedding_model is None:
                embedding_model_for_transforms = self.embedding_model
            else:
                embedding_model_for_transforms = LlamaIndexEmbeddingsWrapper(
                    transforms_embedding_model
                )

            # create the transforms
            transforms = default_transforms(
                documents=[LCDocument(page_content=doc.text) for doc in documents],
                llm=llm_for_transforms,
                embedding_model=embedding_model_for_transforms,
            )

        # convert the documents to Ragas nodes
        nodes = []
        for doc in documents:
            if doc.text is not None and doc.text.strip() != "":
                node = Node(
                    type=NodeType.DOCUMENT,
                    properties={
                        "page_content": doc.text,
                        "document_metadata": doc.metadata,
                    },
                )
                nodes.append(node)

        kg = KnowledgeGraph(nodes=nodes)

        # apply transforms and update the knowledge graph
        apply_transforms(kg, transforms, run_config)
        self.knowledge_graph = kg

        return self.generate(
            testset_size=testset_size,
            query_distribution=query_distribution,
            run_config=run_config,
            callbacks=callbacks,
            with_debugging_logs=with_debugging_logs,
            raise_exceptions=raise_exceptions,
        )

    def generate(
        self,
        testset_size: int,
        query_distribution: t.Optional[QueryDistribution] = None,
        num_personas: int = 3,
        run_config: t.Optional[RunConfig] = None,
        batch_size: t.Optional[int] = None,
        callbacks: t.Optional[Callbacks] = None,
        token_usage_parser: t.Optional[TokenUsageParser] = None,
        with_debugging_logs=False,
        raise_exceptions: bool = True,
    ) -> Testset:
        """
        Generate an evaluation dataset based on given scenarios and parameters.

        Parameters
        ----------
        testset_size : int
            The number of samples to generate.
        query_distribution : Optional[QueryDistribution], optional
            A list of tuples containing scenario simulators and their probabilities.
            If None, default simulators will be used.
        num_personas : int, default 3
            The number of personas to generate or use from the persona_list.
        run_config : Optional[RunConfig], optional
            Configuration for running the generation process.
        batch_size: int, optional
            How large should batches be.  If set to None (default), no batching is done.
        callbacks : Optional[Callbacks], optional
            Langchain style callbacks to use for the generation process. You can use
            this to log the generation process or add other metadata.
        token_usage_parser : Optional[TokenUsageParser], optional
            Parse the LLMResult object and return a TokenUsage object. This is used to
            calculate the cost of the generation process.
        with_debugging_logs : bool, default False
            If True, enable debug logging for various components.
        raise_exceptions : bool, default True
            If True, raise exceptions during the generation process.

        Returns
        -------
        Testset
            A dataset containing the generated TestsetSamples.

        Notes
        -----
        This function performs the following steps:
        1. Set up scenarios and debug logging if required.
        2. Generate scenarios using an Executor.
        3. Calculate split values for different scenario types.
        4. Generate samples for each scenario.
        5. Compile the results into an EvaluationDataset.
        """
        if run_config is not None:
            self.llm.set_run_config(run_config)

        query_distribution = query_distribution or default_query_distribution(
            self.llm, self.knowledge_graph
        )
        callbacks = callbacks or []

        # dict to store any callbacks we define
        ragas_callbacks = {}
        # set the token usage parser
        if token_usage_parser is not None:
            from ragas.cost import CostCallbackHandler

            cost_cb = CostCallbackHandler(token_usage_parser=token_usage_parser)
            ragas_callbacks["cost_cb"] = cost_cb
        else:
            cost_cb = None

        # append all the ragas_callbacks to the callbacks
        for cb in ragas_callbacks.values():
            if isinstance(callbacks, BaseCallbackManager):
                callbacks.add_handler(cb)
            else:
                callbacks.append(cb)

        # new group for Testset Generation
        testset_generation_rm, testset_generation_grp = new_group(
            name=RAGAS_TESTSET_GENERATION_GROUP_NAME,
            inputs={"testset_size": testset_size},
            callbacks=callbacks,
        )

        if with_debugging_logs:
            # TODO: Edit this before pre-release
            from ragas.utils import patch_logger

            patch_logger("ragas.experimental.testset.synthesizers", logging.DEBUG)
            patch_logger("ragas.experimental.testset.graph", logging.DEBUG)
            patch_logger("ragas.experimental.testset.transforms", logging.DEBUG)

        if self.persona_list is None:
            self.persona_list = generate_personas_from_kg(
                llm=self.llm,
                kg=self.knowledge_graph,
                num_personas=num_personas,
                callbacks=callbacks,
            )
        else:
            random.shuffle(self.persona_list)

        splits, _ = calculate_split_values(
            [prob for _, prob in query_distribution], testset_size
        )
        # new group for Generation of Scenarios
        scenario_generation_rm, scenario_generation_grp = new_group(
            name="Scenario Generation",
            inputs={"splits": splits},
            callbacks=testset_generation_grp,
        )

        # generate scenarios
        exec = Executor(
            desc="Generating Scenarios",
            raise_exceptions=raise_exceptions,
            run_config=run_config,
            keep_progress_bar=False,
            batch_size=batch_size,
        )
        # generate samples
        splits, _ = calculate_split_values(
            [prob for _, prob in query_distribution], testset_size
        )
        for i, (scenario, _) in enumerate(query_distribution):
            exec.submit(
                scenario.generate_scenarios,
                n=splits[i],
                knowledge_graph=self.knowledge_graph,
                persona_list=self.persona_list[:num_personas],
                callbacks=scenario_generation_grp,
            )

        try:
            scenario_sample_list: t.List[t.List[BaseScenario]] = exec.results()
        except Exception as e:
            scenario_generation_rm.on_chain_error(e)
            raise e
        else:
            scenario_generation_rm.on_chain_end(
                outputs={"scenario_sample_list": scenario_sample_list}
            )

        # new group for Generation of Samples
        sample_generation_rm, sample_generation_grp = new_group(
            name="Sample Generation",
            inputs={"scenario_sample_list": scenario_sample_list},
            callbacks=testset_generation_grp,
        )
        exec = Executor(
            "Generating Samples",
            raise_exceptions=raise_exceptions,
            run_config=run_config,
            keep_progress_bar=True,
            batch_size=batch_size,
        )
        additional_testset_info: t.List[t.Dict] = []
        for i, (synthesizer, _) in enumerate(query_distribution):
            for sample in scenario_sample_list[i]:
                exec.submit(
                    synthesizer.generate_sample,
                    scenario=sample,
                    callbacks=sample_generation_grp,
                )
                # fill out the additional info for the TestsetSample
                additional_testset_info.append(
                    {
                        "synthesizer_name": synthesizer.name,
                    }
                )

        try:
            eval_samples = exec.results()
        except Exception as e:
            sample_generation_rm.on_chain_error(e)
            raise e
        else:
            sample_generation_rm.on_chain_end(outputs={"eval_samples": eval_samples})

        # build the testset
        testsets = []
        for sample, additional_info in zip(eval_samples, additional_testset_info):
            testsets.append(TestsetSample(eval_sample=sample, **additional_info))
        testset = Testset(samples=testsets, cost_cb=cost_cb)
        testset_generation_rm.on_chain_end({"testset": testset})

        # tracking how many samples were generated
        track(
            TestsetGenerationEvent(
                event_type="testset_generation",
                evolution_names=[
                    e.__class__.__name__.lower() for e, _ in query_distribution
                ],
                evolution_percentages=[p for _, p in query_distribution],
                num_rows=testset_size,
                language="english",
            )
        )
        return testset
