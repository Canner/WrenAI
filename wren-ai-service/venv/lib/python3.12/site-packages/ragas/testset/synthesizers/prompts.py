import typing as t

from pydantic import BaseModel

from ragas.prompt import PydanticPrompt
from ragas.testset.persona import Persona


class ThemesPersonasInput(BaseModel):
    themes: t.List[str]
    personas: t.List[Persona]


class PersonaThemesMapping(BaseModel):
    mapping: t.Dict[str, t.List[str]]


class ThemesPersonasMatchingPrompt(
    PydanticPrompt[ThemesPersonasInput, PersonaThemesMapping]
):
    instruction: str = (
        "Given a list of themes and personas with their roles, "
        "associate each persona with relevant themes based on their role description."
    )
    input_model: t.Type[ThemesPersonasInput] = ThemesPersonasInput
    output_model: t.Type[PersonaThemesMapping] = PersonaThemesMapping
    examples: t.List[t.Tuple[ThemesPersonasInput, PersonaThemesMapping]] = [
        (
            ThemesPersonasInput(
                themes=["Empathy", "Inclusivity", "Remote work"],
                personas=[
                    Persona(
                        name="HR Manager",
                        role_description="Focuses on inclusivity and employee support.",
                    ),
                    Persona(
                        name="Remote Team Lead",
                        role_description="Manages remote team communication.",
                    ),
                ],
            ),
            PersonaThemesMapping(
                mapping={
                    "HR Manager": ["Inclusivity", "Empathy"],
                    "Remote Team Lead": ["Remote work", "Empathy"],
                }
            ),
        )
    ]
