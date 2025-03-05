import abc
from collections import defaultdict
from typing import Any, Callable, Collection, Dict, List, Type

from hamilton import node
from hamilton.data_quality import base as dq_base
from hamilton.data_quality import default_validators
from hamilton.function_modifiers import base

"""Decorators that validate artifacts of a node"""

IS_DATA_VALIDATOR_TAG = "hamilton.data_quality.contains_dq_results"
DATA_VALIDATOR_ORIGINAL_OUTPUT_TAG = "hamilton.data_quality.source_node"


class BaseDataValidationDecorator(base.NodeTransformer):
    @abc.abstractmethod
    def get_validators(self, node_to_validate: node.Node) -> List[dq_base.DataValidator]:
        """Returns a list of validators used to transform the nodes.

        :param node_to_validate: Nodes to which the output of the validator will apply
        :return: A list of validators to apply to the node.
        """
        pass

    def transform_node(
        self, node_: node.Node, config: Dict[str, Any], fn: Callable
    ) -> Collection[node.Node]:
        raw_node = node.Node(
            name=node_.name
            + "_raw",  # TODO -- make this unique -- this will break with multiple validation decorators, which we *don't* want
            typ=node_.type,
            doc_string=node_.documentation,
            callabl=node_.callable,
            node_source=node_.node_role,
            input_types=node_.input_types,
            tags=node_.tags,
        )
        validators = self.get_validators(node_)
        validator_nodes = []
        validator_name_map = {}
        validator_name_count = defaultdict(int)
        for validator in validators:

            def validation_function(validator_to_call: dq_base.DataValidator = validator, **kwargs):
                result = list(kwargs.values())[0]  # This should just have one kwarg
                return validator_to_call.validate(result)

            validator_node_name = node_.name + "_" + validator.name()
            validator_name_count[validator_node_name] = (
                validator_name_count[validator_node_name] + 1
            )
            if validator_name_count[validator_node_name] > 1:
                validator_node_name = (
                    validator_node_name + "_" + str(validator_name_count[validator_node_name] - 1)
                )
            validator_node = node.Node(
                name=validator_node_name,  # TODO -- determine a good approach towards naming this
                typ=dq_base.ValidationResult,
                doc_string=validator.description(),
                callabl=validation_function,
                node_source=node.NodeType.STANDARD,
                input_types={raw_node.name: (node_.type, node.DependencyType.REQUIRED)},
                tags={
                    **node_.tags,
                    **{
                        IS_DATA_VALIDATOR_TAG: True,
                        DATA_VALIDATOR_ORIGINAL_OUTPUT_TAG: node_.name,
                    },
                },
            )
            validator_name_map[validator_node_name] = validator
            validator_nodes.append(validator_node)

        def final_node_callable(
            validator_nodes=validator_nodes, validator_name_map=validator_name_map, **kwargs
        ):
            """Callable for the final node. First calls the action on every node, then

            :param validator_nodes:
            :param validator_name_map:
            :param kwargs:
            :return: returns the original node output
            """
            failures = []
            for validator_node in validator_nodes:
                validator: dq_base.DataValidator = validator_name_map[validator_node.name]
                validation_result: dq_base.ValidationResult = kwargs[validator_node.name]
                if validator.importance == dq_base.DataValidationLevel.WARN:
                    dq_base.act_warn(node_.name, validation_result, validator)
                else:
                    failures.append((validation_result, validator))
            dq_base.act_fail_bulk(node_.name, failures)
            return kwargs[raw_node.name]

        final_node = node.Node(
            name=node_.name,
            typ=node_.type,
            doc_string=node_.documentation,
            callabl=final_node_callable,
            node_source=node_.node_role,
            input_types={
                raw_node.name: (node_.type, node.DependencyType.REQUIRED),
                **{
                    validator_node.name: (validator_node.type, node.DependencyType.REQUIRED)
                    for validator_node in validator_nodes
                },
            },
            tags=node_.tags,
        )
        return [*validator_nodes, final_node, raw_node]

    def validate(self, fn: Callable):
        pass


class check_output_custom(BaseDataValidationDecorator):
    """Class to use if you want to implement your own custom validators.

    Come chat to us in slack if you're interested in this!
    """

    def __init__(self, *validators: dq_base.DataValidator, target_: base.TargetType = None):
        """Creates a check_output_custom decorator. This allows passing of custom validators that implement the \
        DataValidator interface.

        :param validators: Validator to use.
        :param target\\_: The nodes to check the output of. For more detail read the docs in\
        function_modifiers.base.NodeTransformer, but your options are:

            1. **None**: This will check just the "final node" (the node that is returned by the decorated function).
            2. **... (Ellipsis)**: This will check all nodes in the subDAG created by this.
            3. **string**: This will check the node with the given name.
            4. **Collection[str]**: This will check all nodes specified in the list.

            In all likelihood, you *don't* want ``...``, but the others are useful.

            Note: you cannot stack `@check_output_custom` decorators. If you want to use multiple custom validators, \
            you should pass them all in as arguments to a single `@check_output_custom` decorator.

        """
        super(check_output_custom, self).__init__(target=target_)
        self.validators = list(validators)

    def get_validators(self, node_to_validate: node.Node) -> List[dq_base.DataValidator]:
        return self.validators


class check_output(BaseDataValidationDecorator):
    """The ``@check_output`` decorator enables you to add simple data quality checks to your code.

    For example:

    .. code-block:: python

        import pandas as pd
        import numpy as np
        from hamilton.function_modifiers import check_output

        @check_output(
            data_type=np.int64,
            data_in_range=(0,100),
            importance="warn",
        )
        def some_int_data_between_0_and_100() -> pd.Series:
            ...

    The check_output decorator takes in arguments that each correspond to one of the default validators. These \
    arguments tell it to add the default validator to the list. The above thus creates two validators, one that checks \
    the datatype of the series, and one that checks whether the data is in a certain range.

    Pandera example that shows how to use the check_output decorator with a Pandera schema:

    .. code-block:: python

        import pandas as pd
        import pandera as pa
        from hamilton.function_modifiers import check_output
        from hamilton.function_modifiers import extract_columns

        schema = pa.DataFrameSchema(...)

        @extract_columns('col1', 'col2')
        @check_output(schema=schema, target_="builds_dataframe", importance="fail")
        def builds_dataframe(...) -> pd.DataFrame:
            ...

    """

    def get_validators(self, node_to_validate: node.Node) -> List[dq_base.DataValidator]:
        try:
            return default_validators.resolve_default_validators(
                node_to_validate.type,
                importance=self.importance,
                available_validators=self.default_validator_candidates,
                **self.default_validator_kwargs,
            )
        except ValueError as e:
            raise ValueError(
                f"Could not resolve validators for @check_output for function [{node_to_validate.name}]. "
                f"Please check that `target_` is set correctly if you're using that argument.\n"
                f"Actual error: {e}"
            ) from e

    def __init__(
        self,
        importance: str = dq_base.DataValidationLevel.WARN.value,
        default_validator_candidates: List[Type[dq_base.BaseDefaultValidator]] = None,
        target_: base.TargetType = None,
        **default_validator_kwargs: Any,
    ):
        """Creates the check_output validator.

        This constructs the default validator class.

        Note: that this creates a whole set of default validators.
        TODO -- enable construction of custom validators using check_output.custom(\\*validators).

        :param importance: For the default validator, how important is it that this passes.
        :param default_validator_candidates: List of validators to be considerred for this check.
        :param default_validator_kwargs: keyword arguments to be passed to the validator.
        :param target\\_: a target specifying which nodes to decorate. See the docs in check_output_custom\
        for a quick overview and the docs in function_modifiers.base.NodeTransformer for more detail.
        """
        super(check_output, self).__init__(target=target_)
        self.importance = importance
        self.default_validator_kwargs = default_validator_kwargs
        self.default_validator_candidates = default_validator_candidates
        # We need to wait until we actually have the function in order to construct the validators
        # So, we'll just store the constructor arguments for now and check it in validation

    @staticmethod
    def _validate_constructor_args(
        *validator: dq_base.DataValidator, importance: str = None, **default_validator_kwargs: Any
    ):
        if len(validator) != 0:
            if importance is not None or len(default_validator_kwargs) > 0:
                raise ValueError(
                    "Can provide *either* a list of custom validators or arguments for the default validator. "
                    "Instead received both."
                )
        else:
            if importance is None:
                raise ValueError("Must supply an importance level if using the default validator.")

    def validate(self, fn: Callable):
        """Validates that the check_output node works on the function on which it was called

        :param fn: Function to validate
        :raises: InvalidDecoratorException if the decorator is not valid for the function's return type
        """
        pass
