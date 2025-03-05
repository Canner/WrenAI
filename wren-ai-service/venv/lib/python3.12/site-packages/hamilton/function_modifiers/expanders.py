import collections
import dataclasses
import functools
import inspect
import typing
from typing import Any, Callable, Collection, Dict, Tuple, Union

import typing_extensions
import typing_inspect

from hamilton import htypes, node, registry
from hamilton.dev_utils import deprecation
from hamilton.function_modifiers import base
from hamilton.function_modifiers.dependencies import (
    ParametrizedDependency,
    ParametrizedDependencySource,
    source,
    value,
)

"""Decorators that enables DRY code by expanding one node into many"""


class parameterize(base.NodeExpander):
    """Decorator to use to create many functions.

    Expands a single function into n, each of which correspond to a function in which the parameter value is replaced\
    either by:

    #. A specified literal value, denoted value('literal_value').
    #. The output from a specified upstream function (i.e. node), denoted source('upstream_function_name').

    Note that ``parameterize`` can take the place of ``@parameterize_sources`` or ``@parameterize_values`` decorators \
    below. In fact, they delegate to this!

    Examples expressing different syntax:

    .. code-block:: python

        @parameterize(
            # tuple of assignments (consisting of literals/upstream specifications), and docstring.
            replace_no_parameters=({}, 'fn with no parameters replaced'),
        )
        def no_param_function() -> Any:
            ...

        @parameterize(
            # tuple of assignments (consisting of literals/upstream specifications), and docstring.
            replace_just_upstream_parameter=(
                {'upstream_source': source('foo_source')},
                'fn with upstream_parameter set to node foo'
            ),
        )
        def param_is_upstream_function(upstream_source: Any) -> Any:
            '''Doc string that can also be parameterized: {upstream_source}.'''
            ...

        @parameterize(
            replace_just_literal_parameter={'literal_parameter': value('bar')},
        )
        def param_is_literal_value(literal_parameter: Any) -> Any:
            '''Doc string that can also be parameterized: {literal_parameter}.'''
            ...

        @parameterize(
            replace_both_parameters={
                'upstream_parameter': source('foo_source'),
                'literal_parameter': value('bar')
            }
        )
        def concat(upstream_parameter: Any, literal_parameter: str) -> Any:
            '''Adding {literal_parameter} to {upstream_parameter} to create {output_name}.'''
            return upstream_parameter + literal_parameter

    You also have the capability to "group" parameters, which will combine them into a list.

    .. code-block:: python

        @parameterize(
            a_plus_b_plus_c={
                'to_concat' : group(source('a'), value('b'), source('c'))
            }
        )
        def concat(to_concat: List[str]) -> Any:
            '''Adding {literal_parameter} to {upstream_parameter} to create {output_name}.'''
            return sum(to_concat, '')
    """

    RESERVED_KWARG = "output_name"
    # This is a kwarg that replaces it with the name of the function
    # Double underscore means it will not be provided as user-base kwargs
    # as hamilton is not OK with these output names
    # We need this as we need to know the name of the function
    # for the `@inject` usage but its not provided at
    # construction time, so we provide a placeholder
    PLACEHOLDER_PARAM_NAME = "__<function_name>"

    def __init__(
        self,
        **parametrization: Union[
            Dict[str, ParametrizedDependency],
            Tuple[Dict[str, ParametrizedDependency], str],
        ],
    ):
        """Decorator to use to create many functions.

        :param parametrization: `**kwargs` with one of two things:

            - a tuple of assignments (consisting of literals/upstream specifications), and docstring.
            - just assignments, in which case it parametrizes the existing docstring.
        """
        self.parameterization = {
            key: (value[0] if isinstance(value, tuple) else value)
            for key, value in parametrization.items()
        }
        bad_values = []
        for _assigned_output, mapping in self.parameterization.items():
            for _parameter, val in mapping.items():
                if not isinstance(val, ParametrizedDependency):
                    bad_values.append(val)
        if bad_values:
            raise base.InvalidDecoratorException(
                f"@parameterize must specify a dependency type -- either source() or value()."
                f"The following are not allowed: {bad_values}."
            )
        self.specified_docstrings = {
            key: value[1] for key, value in parametrization.items() if isinstance(value, tuple)
        }

    def split_parameterizations(
        self, parameterizations: Dict[str, ParametrizedDependency]
    ) -> Dict[ParametrizedDependencySource, Dict[str, ParametrizedDependency]]:
        """Split parameterizations into two groups: those that are literal values, and those that are upstream nodes.
        Will have a key for each existing dependency type.

        :param parameterizations: Passed into @parameterize
        :return: The parameterizations grouped by dependency type
        """
        out = collections.defaultdict(dict)
        for param_name, replacement in parameterizations.items():
            out[replacement.get_dependency_type()][param_name] = replacement
        return out

    def _get_grouped_list_name(self, index: int, arg_name: str):
        """Gets the name of the arg for a given index in a list of args, using grouped"""
        return f"__{arg_name}_{index}"

    def expand_node(
        self, node_: node.Node, config: Dict[str, Any], fn: Callable
    ) -> Collection[node.Node]:
        nodes = []
        for (
            output_node,
            parametrization_with_optional_docstring,
        ) in self.parameterization.items():
            if output_node == parameterize.PLACEHOLDER_PARAM_NAME:
                output_node = node_.name
            if isinstance(
                parametrization_with_optional_docstring, tuple
            ):  # In this case it contains the docstring
                (parameterization,) = parametrization_with_optional_docstring
            else:
                parameterization = parametrization_with_optional_docstring
            docstring = self.format_doc_string(fn, output_node)
            parameterization_splits = self.split_parameterizations(parameterization)
            upstream_dependencies = parameterization_splits[ParametrizedDependencySource.UPSTREAM]
            literal_dependencies = parameterization_splits[ParametrizedDependencySource.LITERAL]
            grouped_list_dependencies = parameterization_splits[
                ParametrizedDependencySource.GROUPED_LIST
            ]
            grouped_dict_dependencies = parameterization_splits[
                ParametrizedDependencySource.GROUPED_DICT
            ]

            def replacement_function(
                *args,
                upstream_dependencies=upstream_dependencies,
                literal_dependencies=literal_dependencies,
                grouped_list_dependencies=grouped_list_dependencies,
                grouped_dict_dependencies=grouped_dict_dependencies,
                former_inputs=list(node_.input_types.keys()),  # noqa
                **kwargs,
            ):
                """This function rewrites what is passed in kwargs to the right kwarg for the function.
                The passed in kwargs are all the dependencies of this node. Note that we actually have the "former inputs",
                which are what the node declares as its dependencies. So, we just have to loop through all of them to
                get the "new" value. This "new" value comes from the parameterization.

                Note that much of this code should *probably* live within the source/value/grouped functions, but
                it is here as we're not 100% sure about the abstraction.

                TODO -- think about how the grouped/source/literal functions should be able to grab the values from kwargs/args.
                Should be easy -- they should just have something like a "resolve(**kwargs)" function that they can call.
                """
                new_kwargs = {}
                for node_input in former_inputs:
                    if node_input in upstream_dependencies:
                        # If the node is specified by `source`, then we get the value from the kwargs
                        new_kwargs[node_input] = kwargs[upstream_dependencies[node_input].source]
                    elif node_input in literal_dependencies:
                        # If the node is specified by `value`, then we get the literal value (no need for kwargs)
                        new_kwargs[node_input] = literal_dependencies[node_input].value
                    elif node_input in grouped_list_dependencies:
                        # If the node is specified by `group`, then we get the list of values from the kwargs or the literal
                        new_kwargs[node_input] = []
                        for replacement in grouped_list_dependencies[node_input].sources:
                            resolved_value = (
                                kwargs[replacement.source]
                                if replacement.get_dependency_type()
                                == ParametrizedDependencySource.UPSTREAM
                                else replacement.value
                            )
                            new_kwargs[node_input].append(resolved_value)
                    elif node_input in grouped_dict_dependencies:
                        # If the node is specified by `group`, then we get the dict of values from the kwargs or the literal
                        new_kwargs[node_input] = {}
                        for dependency, replacement in grouped_dict_dependencies[
                            node_input
                        ].sources.items():
                            resolved_value = (
                                kwargs[replacement.source]
                                if replacement.get_dependency_type()
                                == ParametrizedDependencySource.UPSTREAM
                                else replacement.value
                            )
                            new_kwargs[node_input][dependency] = resolved_value
                    elif node_input in kwargs:
                        new_kwargs[node_input] = kwargs[node_input]
                    # This case is left blank for optional parameters. If we error here, we'll break
                    # the (supported) case of optionals. We do know whether its optional but for
                    # now the error will be clear enough
                return node_.callable(*args, **new_kwargs)

            new_input_types = {}
            grouped_dependencies = {
                **grouped_list_dependencies,
                **grouped_dict_dependencies,
            }
            for param, val in node_.input_types.items():
                if param in upstream_dependencies:
                    new_input_types[upstream_dependencies[param].source] = (
                        val  # We replace with the upstream_dependencies
                    )
                elif param in grouped_dependencies:
                    # These are the components of the individual sequence
                    # E.G. if the parameter is List[int], the individual type is just int
                    grouped_dependency_spec = grouped_dependencies[param]
                    sequence_component_type = grouped_dependency_spec.resolve_dependency_type(
                        val[0], param
                    )
                    unpacked_dependencies = (
                        grouped_dependency_spec.sources
                        if grouped_dependency_spec.get_dependency_type()
                        == ParametrizedDependencySource.GROUPED_LIST
                        else grouped_dependency_spec.sources.values()
                    )
                    for dep in unpacked_dependencies:
                        if dep.get_dependency_type() == ParametrizedDependencySource.UPSTREAM:
                            # TODO -- think through what happens if we have optional pieces...
                            # I think that we shouldn't allow it...
                            new_input_types[dep.source] = (
                                sequence_component_type,
                                val[1],
                            )
                elif param not in literal_dependencies:
                    new_input_types[param] = (
                        val  # We just use the standard one, nothing is getting replaced
                    )
            nodes.append(
                node_.copy_with(
                    name=output_node,
                    doc_string=docstring,  # TODO -- change docstring
                    callabl=functools.partial(
                        replacement_function,
                        **{parameter: val.value for parameter, val in literal_dependencies.items()},
                    ),
                    input_types=new_input_types,
                    include_refs=False,  # Include refs is here as this is earlier than compile time
                    # TODO -- figure out why this isn't getting replaced later...
                )
            )
        return nodes

    def validate(self, fn: Callable):
        signature = inspect.signature(fn)
        func_param_names = set(signature.parameters.keys())
        try:
            for output_name, _mappings in self.parameterization.items():
                # TODO -- separate out into the two dependency-types
                if output_name == self.PLACEHOLDER_PARAM_NAME:
                    output_name = fn.__name__
                self.format_doc_string(fn, output_name)
        except KeyError as e:
            raise base.InvalidDecoratorException(
                f"Function docstring templating is incorrect. "
                f"Please fix up the docstring {fn.__module__}.{fn.__name__}."
            ) from e

        if self.RESERVED_KWARG in func_param_names:
            raise base.InvalidDecoratorException(
                f"Error function {fn.__module__}.{fn.__name__} cannot have '{self.RESERVED_KWARG}'"
                f"as a parameter it is reserved."
            )
        missing_parameters = set()
        for mapping in self.parameterization.values():
            for param_to_replace in mapping:
                if param_to_replace not in func_param_names:
                    missing_parameters.add(param_to_replace)
        if missing_parameters:
            raise base.InvalidDecoratorException(
                f"Parametrization is invalid: the following parameters don't appear in the function itself: {', '.join(missing_parameters)}"
            )
        type_hints = typing.get_type_hints(fn)
        for _output_name, mapping in self.parameterization.items():
            # TODO -- look a the origin type and determine that its a sequence
            # We can just use the GroupedListDependency to do this
            invalid_types = []
            if isinstance(mapping, tuple):
                mapping = mapping[0]
            for param, replacement_value in mapping.items():
                param_annotation = type_hints[param]
                if typing_inspect.is_optional_type(param_annotation):
                    param_annotation = typing_inspect.get_args(param_annotation)[0]
                is_generic = typing_inspect.is_generic_type(param_annotation)
                if (
                    replacement_value.get_dependency_type()
                    == ParametrizedDependencySource.GROUPED_LIST
                ):
                    if not is_generic:
                        invalid_types.append((param, param_annotation))
                    else:
                        origin = typing_inspect.get_origin(param_annotation)
                        if origin != list:
                            invalid_types.append((param, param_annotation))
                    # 3.9 + this works
                    # 3.8 they changed it, so it gives false positives, but we're OK not fixing
                    # for older versions of python
                    args = typing_inspect.get_args(param_annotation)
                    if not len(args) == 1:
                        invalid_types.append((param, param_annotation))
                elif (
                    replacement_value.get_dependency_type()
                    == ParametrizedDependencySource.GROUPED_DICT
                ):
                    if not is_generic:
                        invalid_types.append((param, param_annotation))
                    else:
                        origin = typing_inspect.get_origin(param_annotation)
                        if origin != dict:
                            invalid_types.append((param, param_annotation))
                        args = typing_inspect.get_args(param_annotation)
                        if not len(args) == 2:
                            invalid_types.append((param, param_annotation))
                        elif args[0] != str:
                            invalid_types.append((param, param_annotation))
            if invalid_types:
                raise base.InvalidDecoratorException(
                    f"Validation for fn: {fn.__qualname__} All parameters with a group() parameterization must be annotated as a list: "
                    f"the following are not: {', '.join([f'{param} ({annotation})' for param, annotation in invalid_types])}"
                )

    def format_doc_string(self, fn: Callable, output_name: str) -> str:
        """Helper function to format a function documentation string.

        :param doc: the string template to format
        :param output_name: the output name of the function
        :param params: the parameter mappings
        :return: formatted string
        :raises: KeyError if there is a template variable missing from the parameter mapping.
        """

        class IdentityDict(dict):
            # quick hack to allow for formatting of missing parameters
            def __missing__(self, key):
                return key

        if output_name in self.specified_docstrings:
            return self.specified_docstrings[output_name]
        doc = fn.__doc__
        if doc is None:
            return None
        parameterizations = self.parameterization.copy()
        if self.PLACEHOLDER_PARAM_NAME in parameterizations:
            parameterizations[fn.__name__] = parameterizations.pop(self.PLACEHOLDER_PARAM_NAME)
        parametrization = parameterizations[output_name]
        upstream_dependencies = {
            parameter: replacement.source
            for parameter, replacement in parametrization.items()
            if replacement.get_dependency_type() == ParametrizedDependencySource.UPSTREAM
        }
        literal_dependencies = {
            parameter: replacement.value
            for parameter, replacement in parametrization.items()
            if replacement.get_dependency_type() == ParametrizedDependencySource.LITERAL
        }
        return doc.format_map(
            IdentityDict(
                **{self.RESERVED_KWARG: output_name},
                **{**upstream_dependencies, **literal_dependencies},
            )
        )


class parameterize_values(parameterize):
    """Expands a single function into n, each of which corresponds to a function in which the parameter value is \
    replaced by that `specific value`.

    .. code-block:: python

        import pandas as pd
        from hamilton.function_modifiers import parameterize_values
        import internal_package_with_logic

        ONE_OFF_DATES = {
             #output name        # doc string               # input value to function
            ('D_ELECTION_2016', 'US Election 2016 Dummy'): '2016-11-12',
            ('SOME_OUTPUT_NAME', 'Doc string for this thing'): 'value to pass to function',
        }
                    # parameter matches the name of the argument in the function below
        @parameterize_values(parameter='one_off_date', assigned_output=ONE_OFF_DATES)
        def create_one_off_dates(date_index: pd.Series, one_off_date: str) -> pd.Series:
            '''Given a date index, produces a series where a 1 is placed at the date index that would contain that event.'''
            one_off_dates = internal_package_with_logic.get_business_week(one_off_date)
            return internal_package_with_logic.bool_to_int(date_index.isin([one_off_dates]))

    """

    def __init__(self, parameter: str, assigned_output: Dict[Tuple[str, str], Any]):
        """Constructor for a modifier that expands a single function into n, each of which
        corresponds to a function in which the parameter value is replaced by that *specific value*.

        :param parameter: Parameter to expand on.
        :param assigned_output: A map of tuple of [parameter names, documentation] to values
        """
        for node_ in assigned_output.keys():
            if not isinstance(node_, Tuple):
                raise base.InvalidDecoratorException(
                    f"assigned_output key is incorrect: {node_}. The parameterized decorator needs a dict of "
                    "[name, doc string] -> value to function."
                )
        super(parameterize_values, self).__init__(
            **{
                output: ({parameter: value(literal_value)}, documentation)
                for (output, documentation), literal_value in assigned_output.items()
            }
        )


@deprecation.deprecated(
    warn_starting=(1, 10, 0),
    fail_starting=(2, 0, 0),
    use_this=parameterize_values,
    explanation="We now support three parametrize decorators. @parameterize, @parameterize_values, and @parameterize_inputs",
    migration_guide="https://github.com/dagworks-inc/hamilton/blob/main/decorators.md#migrating-parameterized",
)
class parametrized(parameterize_values):
    pass


class parameterize_sources(parameterize):
    """Expands a single function into `n`, each of which corresponds to a function in which the parameters specified \
    are mapped to the specified inputs. Note this decorator and ``@parameterize_values`` are quite similar, except \
    that the input here is another DAG node(s), i.e. column/input, rather than a specific scalar/static value.

    .. code-block:: python

       import pandas as pd
       from hamilton.function_modifiers import parameterize_sources

       @parameterize_sources(
          D_ELECTION_2016_shifted=dict(one_off_date='D_ELECTION_2016'),
          SOME_OUTPUT_NAME=dict(one_off_date='SOME_INPUT_NAME')
       )
       def date_shifter(one_off_date: pd.Series) -> pd.Series:
          '''{one_off_date} shifted by 1 to create {output_name}'''
          return one_off_date.shift(1)

    """

    def __init__(self, **parameterization: Dict[str, str]):
        """Constructor for a modifier that expands a single function into n, each of which corresponds to replacing\
        some subset of the specified parameters with specific upstream nodes.

        Note this decorator and `@parametrized_input` are similar, except this one allows multiple \
        parameters to be mapped to multiple function arguments (and it fixes the spelling mistake).

        `parameterized_sources` allows you keep your code DRY by reusing the same function but replace the inputs \
        to create multiple corresponding distinct outputs. We see here that `parameterized_inputs` allows you to keep \
        your code DRY by reusing the same function to create multiple distinct outputs. The key word arguments passed \
        have to have the following structure:
            > OUTPUT_NAME = Mapping of function argument to input that should go into it.

        The documentation for the output is taken from the function. The documentation string can be templatized with\
        the parameter names of the function and the reserved value `output_name` - those will be replaced with the\
        corresponding values from the parameterization.

        :param \\*\\*parameterization: kwargs of output name to dict of parameter mappings.
        """
        self.parametrization = parameterization
        if not parameterization:
            raise ValueError("Cannot pass empty/None dictionary to parameterize_sources")
        for output, mappings in parameterization.items():
            if not mappings:
                raise ValueError(
                    f"Error, {output} has a none/empty dictionary mapping. Please fill it."
                )
        super(parameterize_sources, self).__init__(
            **{
                output: {
                    parameter: source(upstream_node) for parameter, upstream_node in mapping.items()
                }
                for output, mapping in parameterization.items()
            }
        )


@deprecation.deprecated(
    warn_starting=(1, 10, 0),
    fail_starting=(2, 0, 0),
    use_this=parameterize_sources,
    explanation="We now support three parametrize decorators. @parameterize, "
    "@parameterize_values, and @parameterize_inputs",
    migration_guide="https://github.com/dagworks-inc/hamilton/blob/main/decorators.md#migrating"
    "-parameterized",
)
class parametrized_input(parameterize):
    def __init__(self, parameter: str, variable_inputs: Dict[str, Tuple[str, str]]):
        """Constructor for a modifier that expands a single function into n, each of which
        corresponds to the specified parameter replaced by a *specific input column*.

        Note this decorator and `@parametrized` are quite similar, except that the input here is another DAG node,
        i.e. column, rather than some specific value.

        The `parameterized_input` allows you keep your code DRY by reusing the same function but replace the inputs
        to create multiple corresponding distinct outputs. The _parameter_ key word argument has to match one of the
        arguments in the function. The rest of the arguments are pulled from items inside the DAG.
        The _assigned_inputs_ key word argument takes in a dictionary of \
        input_column -> tuple(Output Name, Documentation string).

        :param parameter: Parameter to expand on.
        :param variable_inputs: A map of tuple of [parameter names, documentation] to values
        """
        for val in variable_inputs.values():
            if not isinstance(val, Tuple):
                raise base.InvalidDecoratorException(
                    f"assigned_output key is incorrect: {node}. The parameterized decorator needs a dict of "
                    "input column -> [name, description] to function."
                )
        super(parametrized_input, self).__init__(
            **{
                output: ({parameter: source(value)}, documentation)
                for value, (output, documentation) in variable_inputs.items()
            }
        )


@deprecation.deprecated(
    warn_starting=(1, 10, 0),
    fail_starting=(2, 0, 0),
    use_this=parameterize_sources,
    explanation="We now support three parametrize decorators. @parameterize, @parameterize_values, and @parameterize_inputs",
    migration_guide="https://github.com/dagworks-inc/hamilton/blob/main/decorators.md#migrating-parameterized",
)
class parameterized_inputs(parameterize_sources):
    pass


class extract_columns(base.SingleNodeNodeTransformer):
    def __init__(self, *columns: Union[Tuple[str, str], str], fill_with: Any = None):
        """Constructor for a modifier that expands a single function into the following nodes:

        - n functions, each of which take in the original dataframe and output a specific column
        - 1 function that outputs the original dataframe

        :param columns: Columns to extract, that can be a list of tuples of (name, documentation) or just names.
        :param fill_with: If you want to extract a column that doesn't exist, do you want to fill it with a default \
        value? Or do you want to error out? Leave empty/None to error out, set fill_value to dynamically create a \
        column.
        """
        super(extract_columns, self).__init__()
        if not columns:
            raise base.InvalidDecoratorException(
                "Error empty arguments passed to extract_columns decorator."
            )
        elif isinstance(columns[0], list):
            raise base.InvalidDecoratorException(
                "Error list passed in. Please `*` in front of it to expand it."
            )
        self.columns = columns
        self.fill_with = fill_with

    @staticmethod
    def validate_return_type(fn: Callable):
        """Validates that the return type of the function is a pandas dataframe.
        :param fn: Function to validate
        """
        output_type = typing.get_type_hints(fn).get("return")
        try:
            registry.get_column_type_from_df_type(output_type)
        except NotImplementedError as e:
            raise base.InvalidDecoratorException(
                # TODO: capture was dataframe libraries are supported and print here.
                f"Error {fn} does not output a type we know about. Is it a dataframe type we "
                f"support? "
            ) from e

    def validate(self, fn: Callable):
        """A function is invalid if it does not output a dataframe.

        :param fn: Function to validate.
        :raises: InvalidDecoratorException If the function does not output a Dataframe
        """
        extract_columns.validate_return_type(fn)

    def transform_node(
        self, node_: node.Node, config: Dict[str, Any], fn: Callable
    ) -> Collection[node.Node]:
        """For each column to extract, output a node that extracts that column. Also, output the original dataframe
        generator.
        :param node_: Node to transform
        :param config: Config to use
        :param fn: Function to extract columns from. Must output a dataframe.
        :return: A collection of nodes --
                one for the original dataframe generator, and another for each column to extract.
        """
        fn = node_.callable
        base_doc = node_.documentation

        # if fn is an async function
        if inspect.iscoroutinefunction(fn):

            async def df_generator(*args, **kwargs) -> Any:
                df_generated = await fn(*args, **kwargs)
                if self.fill_with is not None:
                    for col in self.columns:
                        if col not in df_generated:
                            registry.fill_with_scalar(df_generated, col, self.fill_with)
                            assert col in df_generated
                return df_generated

        else:

            def df_generator(*args, **kwargs) -> Any:
                df_generated = fn(*args, **kwargs)
                if self.fill_with is not None:
                    for col in self.columns:
                        if col not in df_generated:
                            registry.fill_with_scalar(df_generated, col, self.fill_with)
                            assert col in df_generated
                return df_generated

        output_nodes = [node_.copy_with(callabl=df_generator)]
        output_type = node_.type
        series_type = registry.get_column_type_from_df_type(output_type)
        for column in self.columns:
            doc_string = base_doc  # default doc string of base function.
            if isinstance(column, Tuple):  # Expand tuple into constituents
                column, doc_string = column

            if inspect.iscoroutinefunction(fn):

                async def extractor_fn(column_to_extract: str = column, **kwargs) -> Any:
                    df = kwargs[node_.name]
                    if column_to_extract not in df:
                        raise base.InvalidDecoratorException(
                            f"No such column: {column_to_extract} produced by {node_.name}. "
                            f"It only produced {str(df.columns)}"
                        )
                    return registry.get_column(df, column_to_extract)

            else:

                def extractor_fn(
                    column_to_extract: str = column, **kwargs
                ) -> Any:  # avoiding problems with closures
                    df = kwargs[node_.name]
                    if column_to_extract not in df:
                        raise base.InvalidDecoratorException(
                            f"No such column: {column_to_extract} produced by {node_.name}. "
                            f"It only produced {str(df.columns)}"
                        )
                    return registry.get_column(df, column_to_extract)

            output_nodes.append(
                node.Node(
                    column,
                    series_type,
                    doc_string,
                    extractor_fn,
                    input_types={node_.name: output_type},
                    tags=node_.tags.copy(),
                )
            )
        return output_nodes


def _validate_extract_fields(fields: dict):
    """Validates the fields dict for extract field.
    Rules are:
    - All keys must be strings
    - All values must be types
    - It must not be empty

    :param fields: Constructor argument to extract_fields
    :raises InvalidDecoratorException: If the fields dict is invalid.
    """
    if not fields:
        raise base.InvalidDecoratorException(
            "Error an empty dict, or no dict, passed to extract_fields decorator."
        )
    elif not isinstance(fields, dict):
        raise base.InvalidDecoratorException(f"Error, please pass in a dict, not {type(fields)}")
    else:
        errors = []
        for field, field_type in fields.items():
            if not isinstance(field, str):
                errors.append(f"{field} is not a string. All keys must be strings.")

            # second condition needed because isinstance(Any, type) == False for Python <3.11
            if not (
                isinstance(field_type, type)
                or field_type is Any
                or typing_inspect.is_generic_type(field_type)
                or typing_inspect.is_union_type(field_type)
            ):
                errors.append(f"{field} does not declare a type. Instead it passes {field_type}.")

        if errors:
            raise base.InvalidDecoratorException(
                f"Error, found these {errors}. " f"Please pass in a dict of string to types. "
            )


class extract_fields(base.SingleNodeNodeTransformer):
    """Extracts fields from a dictionary of output."""

    def __init__(self, fields: dict = None, fill_with: Any = None):
        """Constructor for a modifier that expands a single function into the following nodes:

        - n functions, each of which take in the original dict and output a specific field
        - 1 function that outputs the original dict

        :param fields: Fields to extract. A dict of 'field_name' -> 'field_type'.
        :param fill_with: If you want to extract a field that doesn't exist, do you want to fill it with a default \
        value? Or do you want to error out? Leave empty/None to error out, set fill_value to dynamically create a \
        field value.
        """
        super(extract_fields, self).__init__()
        self.fields = fields
        self.fill_with = fill_with

    def validate(self, fn: Callable):
        """A function is invalid if it is not annotated with a dict or typing.Dict return type.

        :param fn: Function to validate.
        :raises: InvalidDecoratorException If the function is not annotated with a dict or typing.Dict type as output.
        """
        output_type = typing.get_type_hints(fn).get("return")
        if typing_inspect.is_generic_type(output_type):
            base_type = typing_inspect.get_origin(output_type)
            if base_type == dict or base_type == Dict:
                _validate_extract_fields(self.fields)
            else:
                raise base.InvalidDecoratorException(
                    f"For extracting fields, output type must be a dict or typing.Dict, not: {output_type}"
                )
        elif output_type == dict:
            _validate_extract_fields(self.fields)
        elif typing_extensions.is_typeddict(output_type):
            if self.fields is None:
                self.fields = typing.get_type_hints(output_type)
            else:
                # check that fields is a subset of TypedDict that is defined
                typed_dict_fields = typing.get_type_hints(output_type)
                for field_name, field_type in self.fields.items():
                    expected_type = typed_dict_fields.get(field_name, None)
                    if expected_type == field_type:
                        pass  # we're definitely good
                    elif expected_type is not None and htypes.custom_subclass_check(
                        field_type, expected_type
                    ):
                        pass
                    else:
                        raise base.InvalidDecoratorException(
                            f"Error {self.fields} did not match a subset of the TypedDict annotation's fields {typed_dict_fields}."
                        )
            _validate_extract_fields(self.fields)
        else:
            raise base.InvalidDecoratorException(
                f"For extracting fields, output type must be a dict or typing.Dict, not: {output_type}"
            )

    def transform_node(
        self, node_: node.Node, config: Dict[str, Any], fn: Callable
    ) -> Collection[node.Node]:
        """For each field to extract, output a node that extracts that field. Also, output the original TypedDict
        generator.

        :param node_:
        :param config:
        :param fn: Function to extract columns from. Must output a dataframe.
        :return: A collection of nodes --
                one for the original dataframe generator, and another for each column to extract.
        """
        fn = node_.callable
        base_doc = node_.documentation

        # if fn is async
        if inspect.iscoroutinefunction(fn):

            async def dict_generator(*args, **kwargs):
                dict_generated = await fn(*args, **kwargs)
                if self.fill_with is not None:
                    for field in self.fields:
                        if field not in dict_generated:
                            dict_generated[field] = self.fill_with
                return dict_generated

        else:

            def dict_generator(*args, **kwargs):
                dict_generated = fn(*args, **kwargs)
                if self.fill_with is not None:
                    for field in self.fields:
                        if field not in dict_generated:
                            dict_generated[field] = self.fill_with
                return dict_generated

        output_nodes = [node_.copy_with(callabl=dict_generator)]

        for field, field_type in self.fields.items():
            doc_string = base_doc  # default doc string of base function.

            # if fn is async
            if inspect.iscoroutinefunction(fn):

                async def extractor_fn(field_to_extract: str = field, **kwargs) -> field_type:
                    dt = kwargs[node_.name]
                    if field_to_extract not in dt:
                        raise base.InvalidDecoratorException(
                            f"No such field: {field_to_extract} produced by {node_.name}. "
                            f"It only produced {list(dt.keys())}"
                        )
                    return kwargs[node_.name][field_to_extract]

            else:

                def extractor_fn(
                    field_to_extract: str = field, **kwargs
                ) -> field_type:  # avoiding problems with closures
                    dt = kwargs[node_.name]
                    if field_to_extract not in dt:
                        raise base.InvalidDecoratorException(
                            f"No such field: {field_to_extract} produced by {node_.name}. "
                            f"It only produced {list(dt.keys())}"
                        )
                    return kwargs[node_.name][field_to_extract]

            output_nodes.append(
                node.Node(
                    field,
                    field_type,
                    doc_string,
                    extractor_fn,
                    input_types={node_.name: dict},
                    tags=node_.tags.copy(),
                )
            )
        return output_nodes


@dataclasses.dataclass
class ParameterizedExtract:
    """Dataclass to hold inputs for @parameterize and @parameterize_extract_columns.

    :param outputs: A tuple of strings, each of which is the name of an output.
    :param input_mapping: A dictionary of string to ParametrizedDependency. The string is the name of the python \
    parameter of the decorated function, and the value is a "source"/"value" which will be passed as input for that\
    parameter to the function.
    """

    outputs: Tuple[str, ...]
    input_mapping: Dict[str, ParametrizedDependency]


class parameterize_extract_columns(base.NodeExpander):
    """`@parameterize_extract_columns` gives you the power of both `@extract_columns` and `@parameterize` in one\
     decorator.

    It takes in a list of `Parameterized_Extract` objects, each of which is composed of:
    1. A list of columns to extract, and
    2. A parameterization that gets used

    In the following case, we produce four columns, two for each parameterization:

    .. code-block:: python

        import pandas as pd
        from function_modifiers import parameterize_extract_columns, ParameterizedExtract, source, value
        @parameterize_extract_columns(
            ParameterizedExtract(
                ("outseries1a", "outseries2a"),
                {"input1": source("inseries1a"), "input2": source("inseries1b"), "input3": value(10)},
            ),
            ParameterizedExtract(
                ("outseries1b", "outseries2b"),
                {"input1": source("inseries2a"), "input2": source("inseries2b"), "input3": value(100)},
            ),
        )
        def fn(input1: pd.Series, input2: pd.Series, input3: float) -> pd.DataFrame:
            return pd.concat([input1 * input2 * input3, input1 + input2 + input3], axis=1)

    """

    def __init__(self, *extract_config: ParameterizedExtract, reassign_columns: bool = True):
        """Initializes a `parameterized_extract` decorator. Note this currently works for series,
        but the plan is to extend it to fields as well...

        :param extract_config: A configuration consisting of a list ParameterizedExtract classes\
        These contain the information of a `@parameterized` and `@extract...` together.
        :param reassign_columns: Whether we want to reassign the columns as part of the function.
        """
        self.extract_config = extract_config
        self.reassign_columns = reassign_columns

    def expand_node(
        self, node_: node.Node, config: Dict[str, Any], fn: Callable
    ) -> Collection[node.Node]:
        """Expands a node into multiple, given the extract_config passed to
        parameterize_extract_columns. Goes through all parameterizations,
        creates an extract_columns node for each, then delegates to that.
        Note this calls out to `@parameterize` and `@extract_columns` rather
        than reimplementing the logic.

        :param node_: Node to expand
        :param config: Config to use to expand
        :param fn: Original function
        :return: The nodes produced by this decorator.
        """
        output_nodes = []
        for i, parameterization in enumerate(self.extract_config):

            @functools.wraps(fn)
            def wrapper_fn(*args, _output_columns=parameterization.outputs, **kwargs):
                df_out = fn(*args, **kwargs)
                df_out.columns = _output_columns
                return df_out

            new_node = node_.copy_with(callabl=wrapper_fn)
            fn_to_call = wrapper_fn if self.reassign_columns else fn
            # We have to rename the underlying function so that we do not
            # get naming collisions. Using __ is cleaner than using a uuid
            # as it is easier to read/manage and naturally maeks sense.
            parameterization_decorator = parameterize(
                **{node_.name + f"__{i}": parameterization.input_mapping}
            )
            (parameterized_node,) = parameterization_decorator.expand_node(
                new_node, config, fn_to_call
            )
            extract_columns_decorator = extract_columns(*parameterization.outputs)
            output_nodes.extend(
                extract_columns_decorator.transform_node(
                    parameterized_node, config, parameterized_node.callable
                )
            )

        return output_nodes

    def validate(self, fn: Callable):
        extract_columns.validate_return_type(fn)


class inject(parameterize):
    """@inject allows you to replace parameters with values passed in. You can think of
    it as a `@parameterize` call that has only one parameterization, the result of which
    is the name of the function. See the following examples:

    .. code-block:: python

        import pandas as pd
        from function_modifiers import inject, source, value, group

        @inject(nums=group(source('a'), value(10), source('b'), value(2)))
        def a_plus_10_plus_b_plus_2(nums: List[int]) -> int:
            return sum(nums)

        This would be equivalent to:

        @parameterize(
            a_plus_10_plus_b_plus_2={
                'nums': group(source('a'), value(10), source('b'), value(2))
            })
        def sum_numbers(nums: List[int]) -> int:
            return sum(nums)

    Something to note -- we currently do not support the case in which the same parameter is utilized
    multiple times as an injection. E.G. two lists, a list and a dict, two sources, etc...

    This is considered undefined behavior, and should be avoided.
    """

    def __init__(self, **key_mapping: ParametrizedDependency):
        """Instantiates an @inject decorator with the given key_mapping.

        :param key_mapping: A dictionary of string to dependency spec.
            This is the same as the input mapping in `@parameterize`.
        """
        super(inject, self).__init__(**{parameterize.PLACEHOLDER_PARAM_NAME: key_mapping})
