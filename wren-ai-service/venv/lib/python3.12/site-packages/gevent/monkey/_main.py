# -*- coding: utf-8 -*-
"""
The real functionality to run this package as a main module.

"""


def main():
    # TODO: Now that this is its own module, see if
    # we can refactor.
    # pylint:disable=too-many-locals
    import sys
    from . import patch_all

    args = {}
    argv = sys.argv[1:]
    verbose = False
    run_fn = "run_path"
    script_help, patch_all_args, modules = _get_script_help()
    while argv and argv[0].startswith('--'):
        option = argv[0][2:]
        if option == 'verbose':
            verbose += 1
        elif option == 'module':
            run_fn = "run_module"
        elif option.startswith('no-') and option.replace('no-', '') in patch_all_args:
            args[option[3:]] = False
        elif option in patch_all_args:
            args[option] = True
            if option in modules:
                for module in modules:
                    args.setdefault(module, False)
        else:
            sys.exit(script_help + '\n\n' + 'Cannot patch %r' % option)
        del argv[0]
        # TODO: break on --
    if verbose:
        import pprint
        import os
        print('gevent.monkey.patch_all(%s)' % ', '.join('%s=%s' % item for item in args.items()))
        print('sys.version=%s' % (sys.version.strip().replace('\n', ' '), ))
        print('sys.path=%s' % pprint.pformat(sys.path))
        print('sys.modules=%s' % pprint.pformat(sorted(sys.modules.keys())))
        print('cwd=%s' % os.getcwd())

    if not argv:
        print(script_help)
        return

    sys.argv[:] = argv
    # Make sure that we don't get imported again under a different
    # name (usually it's ``__main__`` here) because that could lead to
    # double-patching, and making monkey.get_original() not work.
    try:
        mod_name = __spec__.name
    except NameError:
        # Py2: __spec__ is not defined as standard
        mod_name = 'gevent.monkey'
    sys.modules[mod_name] = sys.modules[__name__]
    # On Python 2, we have to set the gevent.monkey attribute
    # manually; putting gevent.monkey into sys.modules stops the
    # import machinery from making that connection, and ``from gevent
    # import monkey`` is broken. On Python 3 (.8 at least) that's not
    # necessary.
    assert 'gevent.monkey' in sys.modules

    # Running ``patch_all()`` will load pkg_resources entry point plugins
    # which may attempt to import ``gevent.monkey``, so it is critical that
    # we have established the correct saved module name first.
    patch_all(**args)

    import runpy
    # Use runpy.run_path to closely (exactly) match what the
    # interpreter does given 'python <path>'. This includes allowing
    # passing .pyc/.pyo files and packages with a __main__ and
    # potentially even zip files. Previously we used exec, which only
    # worked if we directly read a python source file.
    run_meth = getattr(runpy, run_fn)
    return run_meth(sys.argv[0], run_name='__main__')


def _get_script_help():
    # pylint:disable=deprecated-method
    import inspect
    from . import patch_all
    getter = inspect.getfullargspec

    patch_all_args = getter(patch_all)[0]
    modules = [x for x in patch_all_args if 'patch_' + x in globals()]
    script_help = """gevent.monkey - monkey patch the standard modules to use gevent.

USAGE: ``python -m gevent.monkey [MONKEY OPTIONS] [--module] (script|module) [SCRIPT OPTIONS]``

If no MONKEY OPTIONS are present, monkey patches all the modules as if by calling ``patch_all()``.
You can exclude a module with --no-<module>, e.g. --no-thread. You can
specify a module to patch with --<module>, e.g. --socket. In the latter
case only the modules specified on the command line will be patched.

The default behavior is to execute the script passed as argument. If you wish
to run a module instead, pass the `--module` argument before the module name.

.. versionchanged:: 1.3b1
    The *script* argument can now be any argument that can be passed to `runpy.run_path`,
    just like the interpreter itself does, for example a package directory containing ``__main__.py``.
    Previously it had to be the path to
    a .py source file.

.. versionchanged:: 1.5
    The `--module` option has been added.

MONKEY OPTIONS: ``--verbose %s``""" % ', '.join('--[no-]%s' % m for m in modules)
    return script_help, patch_all_args, modules

main.__doc__ = _get_script_help()[0]

if __name__ == '__main__':
    main()
