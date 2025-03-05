# -*- coding: utf-8 -*-
"""
Higher level functions that comprise parts of
the public monkey patching API.


"""


def get_original(mod_name, item_name):
    """
    Retrieve the original object from a module.

    If the object has not been patched, then that object will still be
    retrieved.

    :param str|sequence mod_name: The name of the standard library module,
        e.g., ``'socket'``. Can also be a sequence of standard library
        modules giving alternate names to try, e.g., ``('thread', '_thread')``;
        the first importable module will supply all *item_name* items.
    :param str|sequence item_name: A string or sequence of strings naming the
        attribute(s) on the module ``mod_name`` to return.

    :return: The original value if a string was given for
             ``item_name`` or a sequence of original values if a
             sequence was passed.
    """
    from ._state import _get_original

    mod_names = [mod_name] if isinstance(mod_name, str) else mod_name
    if isinstance(item_name, str):
        item_names = [item_name]
        unpack = True
    else:
        item_names = item_name
        unpack = False

    for mod in mod_names:
        try:
            result = _get_original(mod, item_names)
        except ImportError:
            if mod is mod_names[-1]:
                raise
        else:
            return result[0] if unpack else result

_NONE = object()

def patch_item(module, attr, newitem):
    from ._state import _save

    olditem = getattr(module, attr, _NONE)
    if olditem is not _NONE:
        _save(module, attr, olditem)
    setattr(module, attr, newitem)


def remove_item(module, attr):
    from ._state import _save

    olditem = getattr(module, attr, _NONE)
    if olditem is _NONE:
        return
    _save(module, attr, olditem)

    delattr(module, attr)

def patch_module(target_module, source_module, items=None,
                 _warnings=None,
                 _patch_kwargs=None,
                 _notify_will_subscribers=True,
                 _notify_did_subscribers=True,
                 _call_hooks=True):
    """
    patch_module(target_module, source_module, items=None)

    Replace attributes in *target_module* with the attributes of the
    same name in *source_module*.

    The *source_module* can provide some attributes to customize the process:

    * ``__implements__`` is a list of attribute names to copy; if not present,
      the *items* keyword argument is mandatory. ``__implements__`` must only have
      names from the standard library module in it.
    * ``_gevent_will_monkey_patch(target_module, items, warn, **kwargs)``
    * ``_gevent_did_monkey_patch(target_module, items, warn, **kwargs)``
      These two functions in the *source_module* are called *if* they exist,
      before and after copying attributes, respectively. The "will" function
      may modify *items*. The value of *warn* is a function that should be called
      with a single string argument to issue a warning to the user. If the "will"
      function raises :exc:`gevent.events.DoNotPatch`, no patching will be done. These functions
      are called before any event subscribers or plugins.

    :keyword list items: A list of attribute names to replace. If
       not given, this will be taken from the *source_module* ``__implements__``
       attribute.
    :return: A true value if patching was done, a false value if patching was canceled.

    .. versionadded:: 1.3b1
    """
    from gevent import events
    from ._errors import _BadImplements
    from ._util import _notify_patch

    if items is None:
        try:
            items = source_module.__implements__
        except AttributeError as e:
            raise _BadImplements(source_module) from e

        if items is None:
            raise _BadImplements(source_module)

    try:
        if _call_hooks:
            __call_module_hook(source_module, 'will', target_module, items, _warnings)
        if _notify_will_subscribers:
            _notify_patch(
                events.GeventWillPatchModuleEvent(target_module.__name__, source_module,
                                                  target_module, items),
                _warnings)
    except events.DoNotPatch:
        return False

    # Undocumented, internal use: If the module defines
    # `_gevent_do_monkey_patch(patch_request: _GeventDoPatchRequest)` call that;
    # the module is responsible for its own patching.
    do_patch = getattr(
        source_module,
        '_gevent_do_monkey_patch',
        _GeventDoPatchRequest.default_patch_items
    )
    request = _GeventDoPatchRequest(target_module, source_module, items, _patch_kwargs)
    do_patch(request)

    if _call_hooks:
        __call_module_hook(source_module, 'did', target_module, items, _warnings)

    if _notify_did_subscribers:
        # We allow turning off the broadcast of the 'did' event for the benefit
        # of our internal functions which need to do additional work (besides copying
        # attributes) before their patch can be considered complete.
        _notify_patch(
            events.GeventDidPatchModuleEvent(target_module.__name__, source_module,
                                             target_module)
        )

    return True

class _GeventDoPatchRequest(object):

    get_original = staticmethod(get_original)

    def __init__(self,
                 target_module,
                 source_module,
                 items,
                 patch_kwargs):
        self.target_module = target_module
        self.source_module = source_module
        self.items = items
        self.patch_kwargs = patch_kwargs or {}

    def __repr__(self):
        return '<%s target=%r source=%r items=%r kwargs=%r>' % (
            self.__class__.__name__,
            self.target_module,
            self.source_module,
            self.items,
            self.patch_kwargs
        )

    def default_patch_items(self):
        for attr in self.items:
            patch_item(self.target_module, attr, getattr(self.source_module, attr))

    def remove_item(self, target_module, *items):
        if isinstance(target_module, str):
            items = (target_module,) + items
            target_module = self.target_module

        for item in items:
            remove_item(target_module, item)

def __call_module_hook(gevent_module, name, module, items, _warnings):
    # This function can raise DoNotPatch on 'will'

    def warn(message):
        from ._util import _queue_warning
        _queue_warning(message, _warnings)

    func_name = '_gevent_' + name + '_monkey_patch'
    try:
        func = getattr(gevent_module, func_name)
    except AttributeError:
        func = lambda *args: None


    func(module, items, warn)
