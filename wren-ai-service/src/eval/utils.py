def get_generation_model_pricing(
    model_name: str,
):
    # https://openai.com/pricing
    # https://docs.anthropic.com/claude/docs/models-overview#model-comparison
    generation_model_pricing = {
        "gpt-3.5-turbo": {
            "prompt_tokens": 0.5 / 10**6,
            "completion_tokens": 1.5 / 10**6,
        },
        "gpt-3.5-turbo-0125": {
            "prompt_tokens": 0.5 / 10**6,
            "completion_tokens": 1.5 / 10**6,
        },
        "gpt-4-turbo": {
            "prompt_tokens": 10 / 10**6,
            "completion_tokens": 30 / 10**6,
        },
        "gpt-4-0125-preview": {
            "prompt_tokens": 10 / 10**6,
            "completion_tokens": 30 / 10**6,
        },
        "claude-3-haiku-20240307": {
            "prompt_tokens": 0.25 / 10**6,
            "completion_tokens": 1.25 / 10**6,
        },
        "claude-3-opus-20240229": {
            "prompt_tokens": 15 / 10**6,
            "completion_tokens": 75 / 10**6,
        },
    }

    return generation_model_pricing[model_name]
