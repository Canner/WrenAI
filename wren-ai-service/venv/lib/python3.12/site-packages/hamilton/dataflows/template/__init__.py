# --- START LICENSE (optional)
# --- END LICENSE
# --- START IMPORT SECTION
import logging

from hamilton import contrib

logger = logging.getLogger(__name__)

with contrib.catch_import_errors(__name__, __file__, logger):
    # non-hamilton imports go here
    pass

# hamilton imports go here; check for required version if need be.

# --- END IMPORT SECTION

# --- START HAMILTON DATAFLOW


# --- END HAMILTON DATAFLOW
# --- START MAIN CODE
if __name__ == "__main__":
    # Code to create an imaging showing on DAG workflow.
    # run as a script to test Hamilton's execution
    import __init__ as MODULE_NAME

    from hamilton import base, driver

    dr = driver.Driver(
        {},  # CONFIG: fill as appropriate
        MODULE_NAME,
        adapter=base.DefaultAdapter(),
    )
    # saves to current working directory creating dag.png.
    dr.display_all_functions("dag", {"format": "png", "view": False})
# --- END MAIN CODE
