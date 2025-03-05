import inspect
import sys
import typing
from typing import Any, Iterable, Optional, Protocol, Tuple, Type, TypeVar, Union

import typing_inspect

if sys.version_info >= (3, 9):
    from typing import Literal
else:
    Literal = None
from hamilton.registry import COLUMN_TYPE, DF_TYPE_AND_COLUMN_TYPES

BASE_ARGS_FOR_GENERICS = (typing.T,)


def _safe_subclass(candidate_type: Type, base_type: Type) -> bool:
    """Safely checks subclass, returning False if python's subclass does not work.
    This is *not* a true subclass check, and will not tell you whether hamilton
    considers the types to be equivalent. Rather, it is used to short-circuit further
    computation safely and avoid errors.

    Note that we may end up with types that *should* be considered equivalent, but
    are not. In that case we will deal with them -- its a better user experience and easier
    to report than an error.

    :param base_type: Base type to check against
    :param candidate_type: Candidate type to check as a potential subclass
    :return: Whether python considers them subclasses and will not break if subclass is called.
    """
    if len(_get_args(candidate_type)) > 0 or len(_get_args(base_type)) > 0:
        return False
    if inspect.isclass(candidate_type) and inspect.isclass(base_type):
        return issubclass(candidate_type, base_type)
    return False


def custom_subclass_check(requested_type: Type, param_type: Type):
    """This is a custom check around generics & classes. It probably misses a few edge cases.

    We will likely need to revisit this in the future (perhaps integrate with graphadapter?)

    :param requested_type: Candidate subclass.
    :param param_type: Type of parameter to check against.
    :return: Whether or not requested_type is a valid subclass of param_type.
    """
    # handles case when someone is using primitives and generics
    requested_origin_type = requested_type
    param_type, _ = get_type_information(param_type)
    param_origin_type = param_type
    has_generic = False
    if param_type == Any:
        # any type is a valid subclass of Any.
        return True
    if _safe_subclass(requested_type, param_type):
        return True
    if typing_inspect.is_union_type(param_type):
        for arg in _get_args(param_type):
            if custom_subclass_check(requested_type, arg):
                return True
    if typing_inspect.is_generic_type(requested_type) or typing_inspect.is_tuple_type(
        requested_type
    ):
        requested_origin_type = typing_inspect.get_origin(requested_type)
        has_generic = True
    if typing_inspect.is_generic_type(param_type) or typing_inspect.is_tuple_type(param_type):
        param_origin_type = typing_inspect.get_origin(param_type)
        has_generic = True
    # TODO -- consider moving into a graph adapter or elsewhere -- this is perhaps a little too
    #  low-level
    if has_generic and requested_origin_type in (Parallelizable,):
        (requested_type_arg,) = _get_args(requested_type)
        return custom_subclass_check(requested_type_arg, param_type)
    if has_generic and param_origin_type == Collect:
        (param_type_arg,) = _get_args(param_type)
        return custom_subclass_check(requested_type, param_type_arg)
    if requested_origin_type == param_origin_type or _safe_subclass(
        requested_origin_type, param_origin_type
    ):
        if has_generic:  # check the args match or they do not have them defined.
            requested_args = _get_args(requested_type)
            param_args = _get_args(param_type)
            if (
                requested_args
                and param_args
                and requested_args != BASE_ARGS_FOR_GENERICS
                and param_args != BASE_ARGS_FOR_GENERICS
            ):
                return requested_args == param_args
        return True
    return False


def get_type_as_string(type_: Type) -> Optional[str]:
    """Get a string representation of a type.

    The logic supports the evolution of the type system between 3.8 and 3.10.
    :param type_: Any Type object. Typically the node type found at Node.type.
    :return: string representation of the type. An empty string if everything fails.
    """

    if getattr(type_, "__name__", None):
        type_string = type_.__name__
    elif typing_inspect.get_origin(type_):
        base_type = typing_inspect.get_origin(type_)
        type_string = get_type_as_string(base_type)
    elif getattr(type_, "__repr__", None):
        type_string = type_.__repr__()
    else:
        type_string = None

    return type_string


def types_match(param_type: Type[Type], required_node_type: Any) -> bool:
    """Checks that we have "types" that "match".

    Matching can be loose here -- and depends on the adapter being used as to what is
    allowed. Otherwise it does a basic equality check.

    :param adapter: the graph adapter to delegate to for one check.
    :param param_type: the parameter type we're checking.
    :param required_node_type: the expected parameter type to validate against.
    :return: True if types are "matching", False otherwise.
    """
    if required_node_type == typing.Any:
        return True
    # type var  -- straight == should suffice. Assume people understand what they're doing with TypeVar.
    elif typing_inspect.is_typevar(required_node_type) or typing_inspect.is_typevar(param_type):
        return required_node_type == param_type
    elif required_node_type == param_type:
        return True
    elif custom_subclass_check(required_node_type, param_type):
        return True
    return False


_sys_version_info = sys.version_info
_version_tuple = (
    _sys_version_info.major,
    _sys_version_info.minor,
    _sys_version_info.micro,
)

"""
The following is purely for backwards compatibility
The behavior of annotated/get_args/get_origin has changed in recent versions
So we have to handle it accordingly
In 3.8/below we have to use the typing_extensions version

Also, note that it is currently called `column`, but
we will eventually want more options. E.G.

`dataset`
`scalar`
`tensor`

etc...

To do this, we'll likely extend from annotated, and add new types.
See `annotated` source code: https://github.com/python/cpython/blob/3.11/Lib/typing.py#L2122.

We can also potentially add validation in the types, and remove it from the validate.
"""

ANNOTATE_ALLOWED = False
if _version_tuple < (3, 9, 0):
    # Before 3.9 we use typing_extensions
    import typing_extensions

    column = typing_extensions.Annotated


else:
    ANNOTATE_ALLOWED = True
    from typing import Annotated, Type

    column = Annotated

if _version_tuple < (3, 9, 0):
    import typing_extensions

    _get_origin = typing_extensions.get_origin
    _get_args = typing_extensions.get_args
else:
    from typing import get_args as _get_args
    from typing import get_origin as _get_origin


def _is_annotated_type(type_: Type[Type]) -> bool:
    """Utility function to tell if a type is Annotated"""
    return _get_origin(type_) == column


# Placeholder exception for invalid hamilton types
class InvalidTypeException(Exception):
    pass


# Some valid series annotations
# We will likely have to expand
_valid_series_annotations = (
    int,
    float,
    str,
    bool,
)


def _is_valid_series_type(candidate_type: Type[Type]) -> bool:
    """Tells if something is a valid series type, using the registry we have.

    :param candidate_type: Type to check
    :return: Whether it is a series (column) type that we have registered
    """
    for _key, types in DF_TYPE_AND_COLUMN_TYPES.items():
        if COLUMN_TYPE not in types:
            continue
        if issubclass(candidate_type, types[COLUMN_TYPE]):
            return True
    return False


def validate_type_annotation(annotation: Type[Type]):
    """Validates a type annotation for a hamilton function.
    If it is not an Annotated type, it will be fine.
    If it is the Annotated type, it will check that
    it only has one type annotation and that that is valid (currently int, float, str, bool).

    :param annotation: Annotation (e.g. Annotated[pd.Series, int])
    :raises InvalidTypeException: If the annotation is invalid
    """

    if not _is_annotated_type(annotation):
        # In this case we don't care too much -- hamilton accepts anything
        return True
    original, *annotations = _get_args(annotation)
    # TODO -- use extensions/series types to do this more effectively
    if not (_is_valid_series_type(original)):
        raise InvalidTypeException(
            f"Hamilton only accepts annotated types of series or equivalent. Got {original}"
        )
    if len(annotations) > 1 or len(annotations) == 0:
        raise InvalidTypeException(
            f"Hamilton only accepts one annotation per pd.Series. Got {annotations}"
        )
    subclasses_valid_annotation = False
    (annotation,) = annotations
    for valid_annotation in _valid_series_annotations:
        if custom_subclass_check(annotation, valid_annotation):
            subclasses_valid_annotation = True
    if not subclasses_valid_annotation:
        raise InvalidTypeException(
            f"Hamilton only accepts annotations on series that are subclasses of one of {_valid_series_annotations}. "
            f"Got {annotation}"
        )


def get_type_information(some_type: Any) -> Tuple[Type[Type], list]:
    """Gets the type information for a given type.

    If it is an annotated type, it will return the original type and the annotation.
    If it is not an annotated type, it will return the type and empty list.

    :param some_type: Type to get information for
    :return: Tuple of type and list of annotations (or empty list)
    """
    if _is_annotated_type(some_type):
        original, *annotations = _get_args(some_type)
        return original, annotations
    return some_type, []


# Type variables for annotations below
SequentialElement = TypeVar("SequentialElement", covariant=True)
ParallelizableElement = TypeVar("ParallelizableElement", covariant=True)
CollectElement = TypeVar("CollectElement", covariant=True)


# TODO -- support sequential operation
# class Sequential(Iterable[SequentialElement], Protocol[SequentialElement]):
#     pass


class Parallelizable(Iterable[ParallelizableElement], Protocol[ParallelizableElement]):
    """Marks the output of a function node as parallelizable.

    Parallelizable outputs are expected to be iterable, where each element dynamically
    generates a node. When using dynamic execution, each of these dynamic nodes can be
    executed in parallel.

    Because this uses dynamic execution, the builder method `enable_dynamic_execution`
    must be called with `allow_experimental_mode=True`.
    """

    pass


def is_parallelizable_type(type_: Type) -> bool:
    return _get_origin(type_) == Parallelizable


class Collect(Iterable[CollectElement], Protocol[CollectElement]):
    """Marks a function node parameter as collectable.

    Collectable inputs are expected to be iterable, where each element is populated with
    the results of dynamic nodes derived from parallelizable outputs.

    Because this uses dynamic execution, the builder method `enable_dynamic_execution`
    must be called with `allow_experimental_mode=True`.
    """


def check_input_type(node_type: Type, input_value: Any) -> bool:
    """Checks an input value against the declare input type. This is a utility function to be
    used for checking types against values. Note we are looser here than in custom_subclass_check,
    as runtime-typing is less specific.

    :param node_type: Type of the node to check against.
    :param input_value: Value to check.
    :return: True if the input value is of the correct type, False otherwise.
    """
    if node_type == Any:
        return True
    # In the case of dict[str, Any] (or equivalent) in python 3.9 +
    # we need to double-check that its not generic, as the isinstance clause will break this
    elif (
        inspect.isclass(node_type)
        and not typing_inspect.is_generic_type(node_type)
        and isinstance(input_value, node_type)
    ):
        return True
    elif typing_inspect.is_typevar(node_type):  # skip runtime comparison for now.
        return True
    elif typing_inspect.is_generic_type(node_type) and typing_inspect.get_origin(node_type) == type(
        input_value
    ):
        return True
    elif typing_inspect.is_union_type(node_type):
        union_types = typing_inspect.get_args(node_type)
        return any([check_input_type(ut, input_value) for ut in union_types])
    elif node_type == type(input_value):
        return True
    # check for literal and that the value is in the literals listed.
    elif typing_inspect.is_literal_type(node_type) and input_value in typing_inspect.get_args(
        node_type
    ):
        return True
    # iterable (set, dict) is super class over sequence (list, tuple)
    elif (
        typing_inspect.is_generic_type(node_type)
        and typing_inspect.get_origin(node_type)
        in (list, tuple, typing_inspect.get_origin(typing.Sequence))
        and isinstance(input_value, (list, tuple, typing_inspect.get_origin(typing.Sequence)))
    ):
        if typing_inspect.get_args(node_type):
            # check first value in sequence -- if the type is specified.
            for i in input_value:  # this handles empty input case, e.g. [] or (), set()
                return check_input_type(typing_inspect.get_args(node_type)[0], i)
        return True
    elif (
        typing_inspect.is_generic_type(node_type)
        and typing_inspect.get_origin(node_type)
        in (set, typing_inspect.get_origin(typing.Iterable))
        and isinstance(input_value, (set, typing_inspect.get_origin(typing.Iterable)))
    ):
        if typing_inspect.get_args(node_type):
            # check first value in sequence -- if the type is specified.
            for i in input_value:  # this handles empty input case, e.g. [] or (), set()
                return check_input_type(typing_inspect.get_args(node_type)[0], i)
        return True

    return False


# TODO: merge the above with this in some way. Right now they're separate because they have different
# behaviors. We should determine how to reconcile these and how further type checking capabilities,
# e.g. handling Annotated, Pandera, etc, should be handled...
def check_instance(obj: Any, type_: Any) -> bool:
    """This function checks if an object is an instance of a given type. It supports generic types as well.

    :param obj: The object to check.
    :param type_: The type to check against. This can be a generic type like List[int] or Dict[str, Any].
    :return: True if the object is an instance of the type, False otherwise.
    """
    if type_ == Any:
        return True
    # Get the origin of the type (i.e., the base class for generic types)
    origin = getattr(type_, "__origin__", None)

    # If the type has an origin, it's a generic type
    if origin is not None:
        # If the type is a Union type
        if origin is Union:
            return any(check_instance(obj, t) for t in type_.__args__)
        elif origin is Literal:
            return obj in type_.__args__
        # Check if the object is an instance of the origin of the type
        elif not isinstance(obj, origin):
            return False

        # If the type has arguments (i.e., it's a parameterized generic type like List[int])
        if hasattr(type_, "__args__"):
            # Get the element type(s) of the generic type
            element_type = type_.__args__

            # If the object is a dictionary
            if isinstance(obj, dict):
                all_items_meet_condition = True

                # Iterate over each key-value pair in the dictionary
                for key, value in obj.items():
                    # Check if the key is an instance of the first element type and the value is an instance of the second element type
                    key_is_correct_type = check_instance(key, element_type[0])
                    value_is_correct_type = check_instance(value, element_type[1])

                    # If either the key or the value is not the correct type, set the flag to False and break the loop
                    if not key_is_correct_type or not value_is_correct_type:
                        all_items_meet_condition = False
                        break

                # Return the result
                return all_items_meet_condition

            # If the object is a list, set, or tuple
            elif isinstance(obj, (list, set, tuple)):
                element_type = element_type[0]
                for i in obj:
                    if not check_instance(i, element_type):
                        return False
                return True

    # If the type is not a generic type, just use isinstance
    return isinstance(obj, type_)
