import os.path
import sys
import unittest
from test import support
import glob
import subprocess as sp
python = sys.executable
try:
    import pox
    python = pox.which_python(version=True) or python
except ImportError:
    pass
shell = sys.platform[:3] == 'win'

if support.PGO:
    raise unittest.SkipTest("test is not helpful for PGO")

suite = os.path.dirname(__file__) or os.path.curdir
tests = glob.glob(suite + os.path.sep + 'test_*.py')


if __name__ == '__main__':

    failed = 0
    for test in tests:
        p = sp.Popen([python, test], shell=shell).wait()
        if p:
            failed = 1
    print('')
    exit(failed)
