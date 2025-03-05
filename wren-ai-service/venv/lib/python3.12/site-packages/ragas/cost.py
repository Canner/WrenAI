import logging
import typing as t

from langchain_core.callbacks.base import BaseCallbackHandler
from langchain_core.outputs import ChatGeneration, ChatResult, LLMResult
from pydantic import BaseModel

from ragas.utils import get_from_dict

TokenUsageParser = t.Callable[[t.Union[LLMResult, ChatResult]], "TokenUsage"]

logger = logging.getLogger(__name__)


class TokenUsage(BaseModel):
    input_tokens: int
    output_tokens: int
    model: str = ""

    def __add__(self, y: "TokenUsage") -> "TokenUsage":
        if self.model == y.model or (self.model is None and y.model is None):
            return TokenUsage(
                input_tokens=self.input_tokens + y.input_tokens,
                output_tokens=self.output_tokens + y.output_tokens,
            )
        else:
            raise ValueError("Cannot add TokenUsage objects with different models")

    def cost(
        self,
        cost_per_input_token: float,
        cost_per_output_token: t.Optional[float] = None,
    ) -> float:
        if cost_per_output_token is None:
            cost_per_output_token = cost_per_input_token

        return (
            self.input_tokens * cost_per_input_token
            + self.output_tokens * cost_per_output_token
        )

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, TokenUsage):
            return False
        return (
            self.input_tokens == other.input_tokens
            and self.output_tokens == other.output_tokens
            and self.is_same_model(other)
        )

    def is_same_model(self, other: "TokenUsage") -> bool:
        if self.model is None and other.model is None:
            return True
        elif self.model == other.model:
            return True
        else:
            return False


def get_token_usage_for_openai(
    llm_result: t.Union[LLMResult, ChatResult],
) -> TokenUsage:
    # OpenAI like interfaces
    llm_output = llm_result.llm_output
    if llm_output is None:
        logger.info("No llm_output found in the LLMResult")
        return TokenUsage(input_tokens=0, output_tokens=0)
    output_tokens = get_from_dict(llm_output, "token_usage.completion_tokens", 0)
    input_tokens = get_from_dict(llm_output, "token_usage.prompt_tokens", 0)

    return TokenUsage(input_tokens=input_tokens, output_tokens=output_tokens)


def get_token_usage_for_anthropic(
    llm_result: t.Union[LLMResult, ChatResult],
) -> TokenUsage:
    token_usages = []
    for gs in llm_result.generations:
        for g in gs:
            if isinstance(g, ChatGeneration):
                if g.message.response_metadata != {}:
                    # Anthropic
                    token_usages.append(
                        TokenUsage(
                            input_tokens=get_from_dict(
                                g.message.response_metadata,
                                "usage.input_tokens",
                                0,
                            ),
                            output_tokens=get_from_dict(
                                g.message.response_metadata,
                                "usage.output_tokens",
                                0,
                            ),
                        )
                    )

        return sum(token_usages, TokenUsage(input_tokens=0, output_tokens=0))
    else:
        return TokenUsage(input_tokens=0, output_tokens=0)


class CostCallbackHandler(BaseCallbackHandler):
    def __init__(self, token_usage_parser: TokenUsageParser):
        self.token_usage_parser = token_usage_parser
        self.usage_data: t.List[TokenUsage] = []

    def on_llm_end(self, response: LLMResult, **kwargs: t.Any):
        self.usage_data.append(self.token_usage_parser(response))

    def total_cost(
        self,
        cost_per_input_token: t.Optional[float] = None,
        cost_per_output_token: t.Optional[float] = None,
        per_model_costs: t.Dict[str, t.Tuple[float, float]] = {},
    ) -> float:
        if (
            per_model_costs == {}
            and cost_per_input_token is None
            and cost_per_output_token is None
        ):
            raise ValueError(
                "No cost table or cost per token provided. Please provide a cost table if using multiple models or cost per token if using a single model"
            )

        # sum up everything
        first_usage = self.usage_data[0]
        total_table: t.Dict[str, TokenUsage] = {first_usage.model: first_usage}
        for usage in self.usage_data[1:]:
            if usage.model in total_table:
                total_table[usage.model] += usage
            else:
                total_table[usage.model] = usage

        # caculate total cost
        # if only one model is used
        if len(total_table) == 1:
            model_name = list(total_table)[0]
            # if per model cost is provided check that
            if per_model_costs != {}:
                if model_name not in per_model_costs:
                    raise ValueError(f"Model {model_name} not found in per_model_costs")
                cpit, cpot = per_model_costs[model_name]
                return total_table[model_name].cost(cpit, cpot)
            # else use the cost_per_token vals
            else:
                if cost_per_output_token is None:
                    cost_per_output_token = cost_per_input_token
                assert cost_per_input_token is not None
                return total_table[model_name].cost(
                    cost_per_input_token, cost_per_output_token
                )
        else:
            total_cost = 0.0
            for model, usage in total_table.items():
                if model in per_model_costs:
                    cpit, cpot = per_model_costs[model]
                    total_cost += usage.cost(cpit, cpot)
            return total_cost

    def total_tokens(self) -> t.Union[TokenUsage, t.List[TokenUsage]]:
        """
        Return the sum of tokens used by the callback handler
        """
        first_usage = self.usage_data[0]
        total_table: t.Dict[str, TokenUsage] = {first_usage.model: first_usage}
        for usage in self.usage_data[1:]:
            if usage.model in total_table:
                total_table[usage.model] += usage
            else:
                total_table[usage.model] = usage

        if len(total_table) == 1:
            return list(total_table.values())[0]
        else:
            return list(total_table.values())
