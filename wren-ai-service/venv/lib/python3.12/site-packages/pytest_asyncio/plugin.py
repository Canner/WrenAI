"""pytest-asyncio implementation."""

import asyncio
import contextlib
import enum
import functools
import inspect
import socket
import warnings
from asyncio import AbstractEventLoopPolicy
from textwrap import dedent
from typing import (
    Any,
    AsyncIterator,
    Awaitable,
    Callable,
    Dict,
    Generator,
    Iterable,
    Iterator,
    List,
    Literal,
    Mapping,
    Optional,
    Sequence,
    Set,
    Type,
    TypeVar,
    Union,
    overload,
)

import pluggy
import pytest
from pytest import (
    Class,
    Collector,
    Config,
    FixtureDef,
    FixtureRequest,
    Function,
    Item,
    Mark,
    Metafunc,
    Module,
    Package,
    Parser,
    PytestCollectionWarning,
    PytestDeprecationWarning,
    PytestPluginManager,
    Session,
    StashKey,
)

_ScopeName = Literal["session", "package", "module", "class", "function"]
_T = TypeVar("_T")

SimpleFixtureFunction = TypeVar(
    "SimpleFixtureFunction", bound=Callable[..., Awaitable[object]]
)
FactoryFixtureFunction = TypeVar(
    "FactoryFixtureFunction", bound=Callable[..., AsyncIterator[object]]
)
FixtureFunction = Union[SimpleFixtureFunction, FactoryFixtureFunction]
FixtureFunctionMarker = Callable[[FixtureFunction], FixtureFunction]


class PytestAsyncioError(Exception):
    """Base class for exceptions raised by pytest-asyncio"""


class MultipleEventLoopsRequestedError(PytestAsyncioError):
    """Raised when a test requests multiple asyncio event loops."""


class Mode(str, enum.Enum):
    AUTO = "auto"
    STRICT = "strict"


ASYNCIO_MODE_HELP = """\
'auto' - for automatically handling all async functions by the plugin
'strict' - for autoprocessing disabling (useful if different async frameworks \
should be tested together, e.g. \
both pytest-asyncio and pytest-trio are used in the same project)
"""


def pytest_addoption(parser: Parser, pluginmanager: PytestPluginManager) -> None:
    group = parser.getgroup("asyncio")
    group.addoption(
        "--asyncio-mode",
        dest="asyncio_mode",
        default=None,
        metavar="MODE",
        help=ASYNCIO_MODE_HELP,
    )
    parser.addini(
        "asyncio_mode",
        help="default value for --asyncio-mode",
        default="strict",
    )
    parser.addini(
        "asyncio_default_fixture_loop_scope",
        type="string",
        help="default scope of the asyncio event loop used to execute async fixtures",
        default=None,
    )


@overload
def fixture(
    fixture_function: FixtureFunction,
    *,
    scope: "Union[_ScopeName, Callable[[str, Config], _ScopeName]]" = ...,
    loop_scope: Union[_ScopeName, None] = ...,
    params: Optional[Iterable[object]] = ...,
    autouse: bool = ...,
    ids: Union[
        Iterable[Union[str, float, int, bool, None]],
        Callable[[Any], Optional[object]],
        None,
    ] = ...,
    name: Optional[str] = ...,
) -> FixtureFunction: ...


@overload
def fixture(
    fixture_function: None = ...,
    *,
    scope: "Union[_ScopeName, Callable[[str, Config], _ScopeName]]" = ...,
    loop_scope: Union[_ScopeName, None] = ...,
    params: Optional[Iterable[object]] = ...,
    autouse: bool = ...,
    ids: Union[
        Iterable[Union[str, float, int, bool, None]],
        Callable[[Any], Optional[object]],
        None,
    ] = ...,
    name: Optional[str] = None,
) -> FixtureFunctionMarker: ...


def fixture(
    fixture_function: Optional[FixtureFunction] = None,
    loop_scope: Union[_ScopeName, None] = None,
    **kwargs: Any,
) -> Union[FixtureFunction, FixtureFunctionMarker]:
    if fixture_function is not None:
        _make_asyncio_fixture_function(fixture_function, loop_scope)
        return pytest.fixture(fixture_function, **kwargs)

    else:

        @functools.wraps(fixture)
        def inner(fixture_function: FixtureFunction) -> FixtureFunction:
            return fixture(fixture_function, loop_scope=loop_scope, **kwargs)

        return inner


def _is_asyncio_fixture_function(obj: Any) -> bool:
    obj = getattr(obj, "__func__", obj)  # instance method maybe?
    return getattr(obj, "_force_asyncio_fixture", False)


def _make_asyncio_fixture_function(
    obj: Any, loop_scope: Union[_ScopeName, None]
) -> None:
    if hasattr(obj, "__func__"):
        # instance method, check the function object
        obj = obj.__func__
    obj._force_asyncio_fixture = True
    obj._loop_scope = loop_scope


def _is_coroutine_or_asyncgen(obj: Any) -> bool:
    return asyncio.iscoroutinefunction(obj) or inspect.isasyncgenfunction(obj)


def _get_asyncio_mode(config: Config) -> Mode:
    val = config.getoption("asyncio_mode")
    if val is None:
        val = config.getini("asyncio_mode")
    try:
        return Mode(val)
    except ValueError:
        modes = ", ".join(m.value for m in Mode)
        raise pytest.UsageError(
            f"{val!r} is not a valid asyncio_mode. Valid modes: {modes}."
        )


_DEFAULT_FIXTURE_LOOP_SCOPE_UNSET = """\
The configuration option "asyncio_default_fixture_loop_scope" is unset.
The event loop scope for asynchronous fixtures will default to the fixture caching \
scope. Future versions of pytest-asyncio will default the loop scope for asynchronous \
fixtures to function scope. Set the default fixture loop scope explicitly in order to \
avoid unexpected behavior in the future. Valid fixture loop scopes are: \
"function", "class", "module", "package", "session"
"""


def pytest_configure(config: Config) -> None:
    default_loop_scope = config.getini("asyncio_default_fixture_loop_scope")
    if not default_loop_scope:
        warnings.warn(PytestDeprecationWarning(_DEFAULT_FIXTURE_LOOP_SCOPE_UNSET))
    config.addinivalue_line(
        "markers",
        "asyncio: "
        "mark the test as a coroutine, it will be "
        "run using an asyncio event loop",
    )


@pytest.hookimpl(tryfirst=True)
def pytest_report_header(config: Config) -> List[str]:
    """Add asyncio config to pytest header."""
    mode = _get_asyncio_mode(config)
    default_loop_scope = config.getini("asyncio_default_fixture_loop_scope")
    return [f"asyncio: mode={mode}, default_loop_scope={default_loop_scope}"]


def _preprocess_async_fixtures(
    collector: Collector,
    processed_fixturedefs: Set[FixtureDef],
) -> None:
    config = collector.config
    default_loop_scope = config.getini("asyncio_default_fixture_loop_scope")
    asyncio_mode = _get_asyncio_mode(config)
    fixturemanager = config.pluginmanager.get_plugin("funcmanage")
    assert fixturemanager is not None
    for fixtures in fixturemanager._arg2fixturedefs.values():
        for fixturedef in fixtures:
            func = fixturedef.func
            if fixturedef in processed_fixturedefs or not _is_coroutine_or_asyncgen(
                func
            ):
                continue
            if not _is_asyncio_fixture_function(func) and asyncio_mode == Mode.STRICT:
                # Ignore async fixtures without explicit asyncio mark in strict mode
                # This applies to pytest_trio fixtures, for example
                continue
            scope = (
                getattr(func, "_loop_scope", None)
                or default_loop_scope
                or fixturedef.scope
            )
            if scope == "function" and "event_loop" not in fixturedef.argnames:
                fixturedef.argnames += ("event_loop",)
            _make_asyncio_fixture_function(func, scope)
            function_signature = inspect.signature(func)
            if "event_loop" in function_signature.parameters:
                warnings.warn(
                    PytestDeprecationWarning(
                        f"{func.__name__} is asynchronous and explicitly "
                        f'requests the "event_loop" fixture. Asynchronous fixtures and '
                        f'test functions should use "asyncio.get_running_loop()" '
                        f"instead."
                    )
                )
            if "request" not in fixturedef.argnames:
                fixturedef.argnames += ("request",)
            _synchronize_async_fixture(fixturedef)
            assert _is_asyncio_fixture_function(fixturedef.func)
            processed_fixturedefs.add(fixturedef)


def _synchronize_async_fixture(fixturedef: FixtureDef) -> None:
    """
    Wraps the fixture function of an async fixture in a synchronous function.
    """
    if inspect.isasyncgenfunction(fixturedef.func):
        _wrap_asyncgen_fixture(fixturedef)
    elif inspect.iscoroutinefunction(fixturedef.func):
        _wrap_async_fixture(fixturedef)


def _add_kwargs(
    func: Callable[..., Any],
    kwargs: Dict[str, Any],
    event_loop: asyncio.AbstractEventLoop,
    request: FixtureRequest,
) -> Dict[str, Any]:
    sig = inspect.signature(func)
    ret = kwargs.copy()
    if "request" in sig.parameters:
        ret["request"] = request
    if "event_loop" in sig.parameters:
        ret["event_loop"] = event_loop
    return ret


def _perhaps_rebind_fixture_func(func: _T, instance: Optional[Any]) -> _T:
    if instance is not None:
        # The fixture needs to be bound to the actual request.instance
        # so it is bound to the same object as the test method.
        unbound, cls = func, None
        try:
            unbound, cls = func.__func__, type(func.__self__)  # type: ignore
        except AttributeError:
            pass
        # Only if the fixture was bound before to an instance of
        # the same type.
        if cls is not None and isinstance(instance, cls):
            func = unbound.__get__(instance)  # type: ignore
    return func


def _wrap_asyncgen_fixture(fixturedef: FixtureDef) -> None:
    fixture = fixturedef.func

    @functools.wraps(fixture)
    def _asyncgen_fixture_wrapper(request: FixtureRequest, **kwargs: Any):
        func = _perhaps_rebind_fixture_func(fixture, request.instance)
        event_loop_fixture_id = _get_event_loop_fixture_id_for_async_fixture(
            request, func
        )
        event_loop = request.getfixturevalue(event_loop_fixture_id)
        kwargs.pop(event_loop_fixture_id, None)
        gen_obj = func(**_add_kwargs(func, kwargs, event_loop, request))

        async def setup():
            res = await gen_obj.__anext__()  # type: ignore[union-attr]
            return res

        def finalizer() -> None:
            """Yield again, to finalize."""

            async def async_finalizer() -> None:
                try:
                    await gen_obj.__anext__()  # type: ignore[union-attr]
                except StopAsyncIteration:
                    pass
                else:
                    msg = "Async generator fixture didn't stop."
                    msg += "Yield only once."
                    raise ValueError(msg)

            event_loop.run_until_complete(async_finalizer())

        result = event_loop.run_until_complete(setup())
        request.addfinalizer(finalizer)
        return result

    fixturedef.func = _asyncgen_fixture_wrapper  # type: ignore[misc]


def _wrap_async_fixture(fixturedef: FixtureDef) -> None:
    fixture = fixturedef.func

    @functools.wraps(fixture)
    def _async_fixture_wrapper(request: FixtureRequest, **kwargs: Any):
        func = _perhaps_rebind_fixture_func(fixture, request.instance)
        event_loop_fixture_id = _get_event_loop_fixture_id_for_async_fixture(
            request, func
        )
        event_loop = request.getfixturevalue(event_loop_fixture_id)
        kwargs.pop(event_loop_fixture_id, None)

        async def setup():
            res = await func(**_add_kwargs(func, kwargs, event_loop, request))
            return res

        return event_loop.run_until_complete(setup())

    fixturedef.func = _async_fixture_wrapper  # type: ignore[misc]


def _get_event_loop_fixture_id_for_async_fixture(
    request: FixtureRequest, func: Any
) -> str:
    default_loop_scope = request.config.getini("asyncio_default_fixture_loop_scope")
    loop_scope = (
        getattr(func, "_loop_scope", None) or default_loop_scope or request.scope
    )
    if loop_scope == "function":
        event_loop_fixture_id = "event_loop"
    else:
        event_loop_node = _retrieve_scope_root(request._pyfuncitem, loop_scope)
        event_loop_fixture_id = event_loop_node.stash.get(
            # Type ignored because of non-optimal mypy inference.
            _event_loop_fixture_id,  # type: ignore[arg-type]
            "",
        )
    assert event_loop_fixture_id
    return event_loop_fixture_id


class PytestAsyncioFunction(Function):
    """Base class for all test functions managed by pytest-asyncio."""

    @classmethod
    def item_subclass_for(
        cls, item: Function, /
    ) -> Union[Type["PytestAsyncioFunction"], None]:
        """
        Returns a subclass of PytestAsyncioFunction if there is a specialized subclass
        for the specified function item.

        Return None if no specialized subclass exists for the specified item.
        """
        for subclass in cls.__subclasses__():
            if subclass._can_substitute(item):
                return subclass
        return None

    @classmethod
    def _from_function(cls, function: Function, /) -> Function:
        """
        Instantiates this specific PytestAsyncioFunction type from the specified
        Function item.
        """
        assert function.get_closest_marker("asyncio")
        subclass_instance = cls.from_parent(
            function.parent,
            name=function.name,
            callspec=getattr(function, "callspec", None),
            callobj=function.obj,
            fixtureinfo=function._fixtureinfo,
            keywords=function.keywords,
            originalname=function.originalname,
        )
        subclass_instance.own_markers = function.own_markers
        assert subclass_instance.own_markers == function.own_markers
        subclassed_function_signature = inspect.signature(subclass_instance.obj)
        if "event_loop" in subclassed_function_signature.parameters:
            subclass_instance.warn(
                PytestDeprecationWarning(
                    f"{subclass_instance.name} is asynchronous and explicitly "
                    f'requests the "event_loop" fixture. Asynchronous fixtures and '
                    f'test functions should use "asyncio.get_running_loop()" instead.'
                )
            )
        return subclass_instance

    @staticmethod
    def _can_substitute(item: Function) -> bool:
        """Returns whether the specified function can be replaced by this class"""
        raise NotImplementedError()


class Coroutine(PytestAsyncioFunction):
    """Pytest item created by a coroutine"""

    @staticmethod
    def _can_substitute(item: Function) -> bool:
        func = item.obj
        return asyncio.iscoroutinefunction(func)

    def runtest(self) -> None:
        self.obj = wrap_in_sync(
            # https://github.com/pytest-dev/pytest-asyncio/issues/596
            self.obj,  # type: ignore[has-type]
        )
        super().runtest()


class AsyncGenerator(PytestAsyncioFunction):
    """Pytest item created by an asynchronous generator"""

    @staticmethod
    def _can_substitute(item: Function) -> bool:
        func = item.obj
        return inspect.isasyncgenfunction(func)

    @classmethod
    def _from_function(cls, function: Function, /) -> Function:
        async_gen_item = super()._from_function(function)
        unsupported_item_type_message = (
            f"Tests based on asynchronous generators are not supported. "
            f"{function.name} will be ignored."
        )
        async_gen_item.warn(PytestCollectionWarning(unsupported_item_type_message))
        async_gen_item.add_marker(
            pytest.mark.xfail(run=False, reason=unsupported_item_type_message)
        )
        return async_gen_item


class AsyncStaticMethod(PytestAsyncioFunction):
    """
    Pytest item that is a coroutine or an asynchronous generator
    decorated with staticmethod
    """

    @staticmethod
    def _can_substitute(item: Function) -> bool:
        func = item.obj
        return isinstance(func, staticmethod) and _is_coroutine_or_asyncgen(
            func.__func__
        )

    def runtest(self) -> None:
        self.obj = wrap_in_sync(
            # https://github.com/pytest-dev/pytest-asyncio/issues/596
            self.obj,  # type: ignore[has-type]
        )
        super().runtest()


class AsyncHypothesisTest(PytestAsyncioFunction):
    """
    Pytest item that is coroutine or an asynchronous generator decorated by
    @hypothesis.given.
    """

    @staticmethod
    def _can_substitute(item: Function) -> bool:
        func = item.obj
        return (
            getattr(func, "is_hypothesis_test", False)  # type: ignore[return-value]
            and getattr(func, "hypothesis", None)
            and asyncio.iscoroutinefunction(func.hypothesis.inner_test)
        )

    def runtest(self) -> None:
        self.obj.hypothesis.inner_test = wrap_in_sync(
            self.obj.hypothesis.inner_test,
        )
        super().runtest()


_HOLDER: Set[FixtureDef] = set()


# The function name needs to start with "pytest_"
# see https://github.com/pytest-dev/pytest/issues/11307
@pytest.hookimpl(specname="pytest_pycollect_makeitem", tryfirst=True)
def pytest_pycollect_makeitem_preprocess_async_fixtures(
    collector: Union[pytest.Module, pytest.Class], name: str, obj: object
) -> Union[
    pytest.Item, pytest.Collector, List[Union[pytest.Item, pytest.Collector]], None
]:
    """A pytest hook to collect asyncio coroutines."""
    if not collector.funcnamefilter(name):
        return None
    _preprocess_async_fixtures(collector, _HOLDER)
    return None


# The function name needs to start with "pytest_"
# see https://github.com/pytest-dev/pytest/issues/11307
@pytest.hookimpl(specname="pytest_pycollect_makeitem", hookwrapper=True)
def pytest_pycollect_makeitem_convert_async_functions_to_subclass(
    collector: Union[pytest.Module, pytest.Class], name: str, obj: object
) -> Generator[None, pluggy.Result, None]:
    """
    Converts coroutines and async generators collected as pytest.Functions
    to AsyncFunction items.
    """
    hook_result = yield
    try:
        node_or_list_of_nodes: Union[
            pytest.Item,
            pytest.Collector,
            List[Union[pytest.Item, pytest.Collector]],
            None,
        ] = hook_result.get_result()
    except BaseException as e:
        hook_result.force_exception(e)
        return
    if not node_or_list_of_nodes:
        return
    if isinstance(node_or_list_of_nodes, Sequence):
        node_iterator = iter(node_or_list_of_nodes)
    else:
        # Treat single node as a single-element iterable
        node_iterator = iter((node_or_list_of_nodes,))
    updated_node_collection = []
    for node in node_iterator:
        updated_item = node
        if isinstance(node, Function):
            specialized_item_class = PytestAsyncioFunction.item_subclass_for(node)
            if specialized_item_class:
                if _get_asyncio_mode(
                    node.config
                ) == Mode.AUTO and not node.get_closest_marker("asyncio"):
                    node.add_marker("asyncio")
                if node.get_closest_marker("asyncio"):
                    updated_item = specialized_item_class._from_function(node)
        updated_node_collection.append(updated_item)
    hook_result.force_result(updated_node_collection)


_event_loop_fixture_id = StashKey[str]()
_fixture_scope_by_collector_type: Mapping[Type[pytest.Collector], _ScopeName] = {
    Class: "class",
    # Package is a subclass of module and the dict is used in isinstance checks
    # Therefore, the order matters and Package needs to appear before Module
    Package: "package",
    Module: "module",
    Session: "session",
}

# A stack used to push package-scoped loops during collection of a package
# and pop those loops during collection of a Module
__package_loop_stack: List[Union[FixtureFunctionMarker, FixtureFunction]] = []


@pytest.hookimpl
def pytest_collectstart(collector: pytest.Collector) -> None:
    try:
        collector_scope = next(
            scope
            for cls, scope in _fixture_scope_by_collector_type.items()
            if isinstance(collector, cls)
        )
    except StopIteration:
        return
    # Session is not a PyCollector type, so it doesn't have a corresponding
    # "obj" attribute to attach a dynamic fixture function to.
    # However, there's only one session per pytest run, so there's no need to
    # create the fixture dynamically. We can simply define a session-scoped
    # event loop fixture once in the plugin code.
    if collector_scope == "session":
        event_loop_fixture_id = _session_event_loop.__name__
        collector.stash[_event_loop_fixture_id] = event_loop_fixture_id
        return
    # There seem to be issues when a fixture is shadowed by another fixture
    # and both differ in their params.
    # https://github.com/pytest-dev/pytest/issues/2043
    # https://github.com/pytest-dev/pytest/issues/11350
    # As such, we assign a unique name for each event_loop fixture.
    # The fixture name is stored in the collector's Stash, so it can
    # be injected when setting up the test
    event_loop_fixture_id = f"{collector.nodeid}::<event_loop>"
    collector.stash[_event_loop_fixture_id] = event_loop_fixture_id

    @pytest.fixture(
        scope=collector_scope,
        name=event_loop_fixture_id,
    )
    def scoped_event_loop(
        *args,  # Function needs to accept "cls" when collected by pytest.Class
        event_loop_policy,
    ) -> Iterator[asyncio.AbstractEventLoop]:
        new_loop_policy = event_loop_policy
        with _temporary_event_loop_policy(new_loop_policy):
            loop = asyncio.new_event_loop()
            loop.__pytest_asyncio = True  # type: ignore[attr-defined]
            asyncio.set_event_loop(loop)
            yield loop
            loop.close()

    # @pytest.fixture does not register the fixture anywhere, so pytest doesn't
    # know it exists. We work around this by attaching the fixture function to the
    # collected Python object, where it will be picked up by pytest.Class.collect()
    # or pytest.Module.collect(), respectively
    if type(collector) is Package:
        # Packages do not have a corresponding Python object. Therefore, the fixture
        # for the package-scoped event loop is added to a stack. When a module inside
        # the package is collected, the module will attach the fixture to its
        # Python object.
        __package_loop_stack.append(scoped_event_loop)
    elif isinstance(collector, Module):
        # Accessing Module.obj triggers a module import executing module-level
        # statements. A module-level pytest.skip statement raises the "Skipped"
        # OutcomeException or a Collector.CollectError, if the "allow_module_level"
        # kwargs is missing. These cases are handled correctly when they happen inside
        # Collector.collect(), but this hook runs before the actual collect call.
        # Therefore, we monkey patch Module.collect to add the scoped fixture to the
        # module before it runs the actual collection.
        def _patched_collect():
            # If the collected module is a DoctestTextfile, collector.obj is None
            module = collector.obj
            if module is not None:
                module.__pytest_asyncio_scoped_event_loop = scoped_event_loop
                try:
                    package_loop = __package_loop_stack.pop()
                    module.__pytest_asyncio_package_scoped_event_loop = package_loop
                except IndexError:
                    pass
            return collector.__original_collect()

        collector.__original_collect = collector.collect  # type: ignore[attr-defined]
        collector.collect = _patched_collect  # type: ignore[method-assign]
    elif isinstance(collector, Class):
        collector.obj.__pytest_asyncio_scoped_event_loop = scoped_event_loop


@contextlib.contextmanager
def _temporary_event_loop_policy(policy: AbstractEventLoopPolicy) -> Iterator[None]:
    old_loop_policy = asyncio.get_event_loop_policy()
    try:
        old_loop = _get_event_loop_no_warn()
    except RuntimeError:
        old_loop = None
    asyncio.set_event_loop_policy(policy)
    try:
        yield
    finally:
        asyncio.set_event_loop_policy(old_loop_policy)
        # When a test uses both a scoped event loop and the event_loop fixture,
        # the "_provide_clean_event_loop" finalizer of the event_loop fixture
        # will already have installed a fresh event loop, in order to shield
        # subsequent tests from side-effects. We close this loop before restoring
        # the old loop to avoid ResourceWarnings.
        try:
            _get_event_loop_no_warn().close()
        except RuntimeError:
            pass
        asyncio.set_event_loop(old_loop)


_REDEFINED_EVENT_LOOP_FIXTURE_WARNING = dedent(
    """\
    The event_loop fixture provided by pytest-asyncio has been redefined in
    %s:%d
    Replacing the event_loop fixture with a custom implementation is deprecated
    and will lead to errors in the future.
    If you want to request an asyncio event loop with a scope other than function
    scope, use the "scope" argument to the asyncio mark when marking the tests.
    If you want to return different types of event loops, use the event_loop_policy
    fixture.
    """
)


@pytest.hookimpl(tryfirst=True)
def pytest_generate_tests(metafunc: Metafunc) -> None:
    marker = metafunc.definition.get_closest_marker("asyncio")
    if not marker:
        return
    scope = _get_marked_loop_scope(marker)
    if scope == "function":
        return
    event_loop_node = _retrieve_scope_root(metafunc.definition, scope)
    event_loop_fixture_id = event_loop_node.stash.get(_event_loop_fixture_id, None)

    if event_loop_fixture_id:
        # This specific fixture name may already be in metafunc.argnames, if this
        # test indirectly depends on the fixture. For example, this is the case
        # when the test depends on an async fixture, both of which share the same
        # event loop fixture mark.
        if event_loop_fixture_id in metafunc.fixturenames:
            return
        fixturemanager = metafunc.config.pluginmanager.get_plugin("funcmanage")
        assert fixturemanager is not None
        if "event_loop" in metafunc.fixturenames:
            raise MultipleEventLoopsRequestedError(
                _MULTIPLE_LOOPS_REQUESTED_ERROR.format(
                    test_name=metafunc.definition.nodeid,
                    scope=scope,
                    scoped_loop_node=event_loop_node.nodeid,
                ),
            )
        # Add the scoped event loop fixture to Metafunc's list of fixture names and
        # fixturedefs and leave the actual parametrization to pytest
        # The fixture needs to be appended to avoid messing up the fixture evaluation
        # order
        metafunc.fixturenames.append(event_loop_fixture_id)
        metafunc._arg2fixturedefs[event_loop_fixture_id] = (
            fixturemanager._arg2fixturedefs[event_loop_fixture_id]
        )


@pytest.hookimpl(hookwrapper=True)
def pytest_fixture_setup(
    fixturedef: FixtureDef,
) -> Generator[None, pluggy.Result, None]:
    """Adjust the event loop policy when an event loop is produced."""
    if fixturedef.argname == "event_loop":
        # The use of a fixture finalizer is preferred over the
        # pytest_fixture_post_finalizer hook. The fixture finalizer is invoked once
        # for each fixture, whereas the hook may be invoked multiple times for
        # any specific fixture.
        # see https://github.com/pytest-dev/pytest/issues/5848
        _add_finalizers(
            fixturedef,
            _close_event_loop,
            _restore_event_loop_policy(asyncio.get_event_loop_policy()),
            _provide_clean_event_loop,
        )
        outcome = yield
        loop: asyncio.AbstractEventLoop = outcome.get_result()
        # Weird behavior was observed when checking for an attribute of FixtureDef.func
        # Instead, we now check for a special attribute of the returned event loop
        fixture_filename = inspect.getsourcefile(fixturedef.func)
        if not getattr(loop, "__original_fixture_loop", False):
            _, fixture_line_number = inspect.getsourcelines(fixturedef.func)
            warnings.warn(
                _REDEFINED_EVENT_LOOP_FIXTURE_WARNING
                % (fixture_filename, fixture_line_number),
                DeprecationWarning,
            )
        policy = asyncio.get_event_loop_policy()
        try:
            old_loop = _get_event_loop_no_warn(policy)
            is_pytest_asyncio_loop = getattr(old_loop, "__pytest_asyncio", False)
            if old_loop is not loop and not is_pytest_asyncio_loop:
                old_loop.close()
        except RuntimeError:
            # Either the current event loop has been set to None
            # or the loop policy doesn't specify to create new loops
            # or we're not in the main thread
            pass
        policy.set_event_loop(loop)
        return

    yield


def _add_finalizers(fixturedef: FixtureDef, *finalizers: Callable[[], object]) -> None:
    """
    Regsiters the specified fixture finalizers in the fixture.

    Finalizers need to specified in the exact order in which they should be invoked.

    :param fixturedef: Fixture definition which finalizers should be added to
    :param finalizers: Finalizers to be added
    """
    for finalizer in reversed(finalizers):
        fixturedef.addfinalizer(finalizer)


_UNCLOSED_EVENT_LOOP_WARNING = dedent(
    """\
    pytest-asyncio detected an unclosed event loop when tearing down the event_loop
    fixture: %r
    pytest-asyncio will close the event loop for you, but future versions of the
    library will no longer do so. In order to ensure compatibility with future
    versions, please make sure that:
        1. Any custom "event_loop" fixture properly closes the loop after yielding it
        2. The scopes of your custom "event_loop" fixtures do not overlap
        3. Your code does not modify the event loop in async fixtures or tests
    """
)


def _close_event_loop() -> None:
    policy = asyncio.get_event_loop_policy()
    try:
        loop = policy.get_event_loop()
    except RuntimeError:
        loop = None
    if loop is not None:
        if not loop.is_closed():
            warnings.warn(
                _UNCLOSED_EVENT_LOOP_WARNING % loop,
                DeprecationWarning,
            )
        loop.close()


def _restore_event_loop_policy(previous_policy) -> Callable[[], None]:
    def _restore_policy():
        # Close any event loop associated with the old loop policy
        # to avoid ResourceWarnings in the _provide_clean_event_loop finalizer
        try:
            loop = _get_event_loop_no_warn(previous_policy)
        except RuntimeError:
            loop = None
        if loop:
            loop.close()
        asyncio.set_event_loop_policy(previous_policy)

    return _restore_policy


def _provide_clean_event_loop() -> None:
    # At this point, the event loop for the current thread is closed.
    # When a user calls asyncio.get_event_loop(), they will get a closed loop.
    # In order to avoid this side effect from pytest-asyncio, we need to replace
    # the current loop with a fresh one.
    # Note that we cannot set the loop to None, because get_event_loop only creates
    # a new loop, when set_event_loop has not been called.
    policy = asyncio.get_event_loop_policy()
    new_loop = policy.new_event_loop()
    policy.set_event_loop(new_loop)


def _get_event_loop_no_warn(
    policy: Optional[AbstractEventLoopPolicy] = None,
) -> asyncio.AbstractEventLoop:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        if policy is not None:
            return policy.get_event_loop()
        else:
            return asyncio.get_event_loop()


@pytest.hookimpl(tryfirst=True, hookwrapper=True)
def pytest_pyfunc_call(pyfuncitem: Function) -> Optional[object]:
    """
    Pytest hook called before a test case is run.

    Wraps marked tests in a synchronous function
    where the wrapped test coroutine is executed in an event loop.
    """
    if pyfuncitem.get_closest_marker("asyncio") is not None:
        if isinstance(pyfuncitem, PytestAsyncioFunction):
            pass
        else:
            pyfuncitem.warn(
                pytest.PytestWarning(
                    f"The test {pyfuncitem} is marked with '@pytest.mark.asyncio' "
                    "but it is not an async function. "
                    "Please remove the asyncio mark. "
                    "If the test is not marked explicitly, "
                    "check for global marks applied via 'pytestmark'."
                )
            )
    yield
    return None


def wrap_in_sync(
    func: Callable[..., Awaitable[Any]],
):
    """Return a sync wrapper around an async function executing it in the
    current event loop."""

    # if the function is already wrapped, we rewrap using the original one
    # not using __wrapped__ because the original function may already be
    # a wrapped one
    raw_func = getattr(func, "_raw_test_func", None)
    if raw_func is not None:
        func = raw_func

    @functools.wraps(func)
    def inner(*args, **kwargs):
        coro = func(*args, **kwargs)
        _loop = _get_event_loop_no_warn()
        task = asyncio.ensure_future(coro, loop=_loop)
        try:
            _loop.run_until_complete(task)
        except BaseException:
            # run_until_complete doesn't get the result from exceptions
            # that are not subclasses of `Exception`. Consume all
            # exceptions to prevent asyncio's warning from logging.
            if task.done() and not task.cancelled():
                task.exception()
            raise

    inner._raw_test_func = func  # type: ignore[attr-defined]
    return inner


_MULTIPLE_LOOPS_REQUESTED_ERROR = dedent(
    """\
        Multiple asyncio event loops with different scopes have been requested
        by {test_name}. The test explicitly requests the event_loop fixture, while
        another event loop with {scope} scope is provided by {scoped_loop_node}.
        Remove "event_loop" from the requested fixture in your test to run the test
        in a {scope}-scoped event loop or remove the scope argument from the "asyncio"
        mark to run the test in a function-scoped event loop.
    """
)


def pytest_runtest_setup(item: pytest.Item) -> None:
    marker = item.get_closest_marker("asyncio")
    if marker is None:
        return
    scope = _get_marked_loop_scope(marker)
    if scope != "function":
        parent_node = _retrieve_scope_root(item, scope)
        event_loop_fixture_id = parent_node.stash[_event_loop_fixture_id]
    else:
        event_loop_fixture_id = "event_loop"
    fixturenames = item.fixturenames  # type: ignore[attr-defined]
    if event_loop_fixture_id not in fixturenames:
        fixturenames.append(event_loop_fixture_id)
    obj = getattr(item, "obj", None)
    if not getattr(obj, "hypothesis", False) and getattr(
        obj, "is_hypothesis_test", False
    ):
        pytest.fail(
            f"test function `{item!r}` is using Hypothesis, but pytest-asyncio "
            "only works with Hypothesis 3.64.0 or later."
        )


_DUPLICATE_LOOP_SCOPE_DEFINITION_ERROR = """\
An asyncio pytest marker defines both "scope" and "loop_scope", \
but it should only use "loop_scope".
"""

_MARKER_SCOPE_KWARG_DEPRECATION_WARNING = """\
The "scope" keyword argument to the asyncio marker has been deprecated. \
Please use the "loop_scope" argument instead.
"""


def _get_marked_loop_scope(asyncio_marker: Mark) -> _ScopeName:
    assert asyncio_marker.name == "asyncio"
    if asyncio_marker.args or (
        asyncio_marker.kwargs and set(asyncio_marker.kwargs) - {"loop_scope", "scope"}
    ):
        raise ValueError("mark.asyncio accepts only a keyword argument 'scope'.")
    if "scope" in asyncio_marker.kwargs:
        if "loop_scope" in asyncio_marker.kwargs:
            raise pytest.UsageError(_DUPLICATE_LOOP_SCOPE_DEFINITION_ERROR)
        warnings.warn(PytestDeprecationWarning(_MARKER_SCOPE_KWARG_DEPRECATION_WARNING))
    scope = asyncio_marker.kwargs.get("loop_scope") or asyncio_marker.kwargs.get(
        "scope", "function"
    )
    assert scope in {"function", "class", "module", "package", "session"}
    return scope


def _retrieve_scope_root(item: Union[Collector, Item], scope: str) -> Collector:
    node_type_by_scope = {
        "class": Class,
        "module": Module,
        "package": Package,
        "session": Session,
    }
    scope_root_type = node_type_by_scope[scope]
    for node in reversed(item.listchain()):
        if isinstance(node, scope_root_type):
            assert isinstance(node, pytest.Collector)
            return node
    error_message = (
        f"{item.name} is marked to be run in an event loop with scope {scope}, "
        f"but is not part of any {scope}."
    )
    raise pytest.UsageError(error_message)


@pytest.fixture
def event_loop(request: FixtureRequest) -> Iterator[asyncio.AbstractEventLoop]:
    """Create an instance of the default event loop for each test case."""
    new_loop_policy = request.getfixturevalue(event_loop_policy.__name__)
    asyncio.set_event_loop_policy(new_loop_policy)
    loop = asyncio.get_event_loop_policy().new_event_loop()
    # Add a magic value to the event loop, so pytest-asyncio can determine if the
    # event_loop fixture was overridden. Other implementations of event_loop don't
    # set this value.
    # The magic value must be set as part of the function definition, because pytest
    # seems to have multiple instances of the same FixtureDef or fixture function
    loop.__original_fixture_loop = True  # type: ignore[attr-defined]
    yield loop
    loop.close()


@pytest.fixture(scope="session")
def _session_event_loop(
    request: FixtureRequest, event_loop_policy: AbstractEventLoopPolicy
) -> Iterator[asyncio.AbstractEventLoop]:
    new_loop_policy = event_loop_policy
    with _temporary_event_loop_policy(new_loop_policy):
        loop = asyncio.new_event_loop()
        loop.__pytest_asyncio = True  # type: ignore[attr-defined]
        asyncio.set_event_loop(loop)
        yield loop
        loop.close()


@pytest.fixture(scope="session", autouse=True)
def event_loop_policy() -> AbstractEventLoopPolicy:
    """Return an instance of the policy used to create asyncio event loops."""
    return asyncio.get_event_loop_policy()


def is_async_test(item: Item) -> bool:
    """Returns whether a test item is a pytest-asyncio test"""
    return isinstance(item, PytestAsyncioFunction)


def _unused_port(socket_type: int) -> int:
    """Find an unused localhost port from 1024-65535 and return it."""
    with contextlib.closing(socket.socket(type=socket_type)) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@pytest.fixture
def unused_tcp_port() -> int:
    return _unused_port(socket.SOCK_STREAM)


@pytest.fixture
def unused_udp_port() -> int:
    return _unused_port(socket.SOCK_DGRAM)


@pytest.fixture(scope="session")
def unused_tcp_port_factory() -> Callable[[], int]:
    """A factory function, producing different unused TCP ports."""
    produced = set()

    def factory():
        """Return an unused port."""
        port = _unused_port(socket.SOCK_STREAM)

        while port in produced:
            port = _unused_port(socket.SOCK_STREAM)

        produced.add(port)

        return port

    return factory


@pytest.fixture(scope="session")
def unused_udp_port_factory() -> Callable[[], int]:
    """A factory function, producing different unused UDP ports."""
    produced = set()

    def factory():
        """Return an unused port."""
        port = _unused_port(socket.SOCK_DGRAM)

        while port in produced:
            port = _unused_port(socket.SOCK_DGRAM)

        produced.add(port)

        return port

    return factory
