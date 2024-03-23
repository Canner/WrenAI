# to pass data between tests
# https://github.com/pytest-dev/pytest/issues/3403#issuecomment-526554447
class ValueStorage:
    semantics_preperation_id = None
    contexts = None
    query_id = None
