import math
import typing as t


def calculate_split_values(
    probs: t.List[float], n: int
) -> t.Tuple[t.List[int], t.List[int]]:
    # calculate the number of samples for each scenario
    splits = [math.ceil(n * prob) for prob in probs]
    # convert this to split values like [0, 30, 60, 80]
    split_values = [0] + splits + [sum(splits)]
    split_values = [sum(split_values[:i]) for i in range(1, len(split_values))]
    return (splits, split_values)
