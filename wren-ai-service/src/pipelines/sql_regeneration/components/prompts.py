from haystack.components.builders.prompt_builder import PromptBuilder

sql_regeneration_system_prompt = """
"""

sql_regeneration_user_prompt_template = """
"""


def init_sql_regeneration_prompt_builder():
    return PromptBuilder(template=sql_regeneration_user_prompt_template)
