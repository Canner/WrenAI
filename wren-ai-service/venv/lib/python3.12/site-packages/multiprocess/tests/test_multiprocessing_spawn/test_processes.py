import unittest
from multiprocess.tests import install_tests_in_module_dict

install_tests_in_module_dict(globals(), 'spawn', only_type="processes")

if __name__ == '__main__':
    unittest.main()
