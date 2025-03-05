import re
import typing as t
from dataclasses import dataclass

from ragas.testset.graph import Node
from ragas.testset.transforms.base import Extractor


@dataclass
class RegexBasedExtractor(Extractor):
    pattern: str = ""
    is_multiline: bool = False
    property_name: str = "regex"

    async def extract(self, node: Node) -> t.Tuple[str, t.Any]:
        text = node.get_property("page_content")
        if not isinstance(text, str):
            raise ValueError(
                f"node.property('page_content') must be a string, found '{type(text)}'"
            )

        matches = re.findall(self.pattern, text, re.MULTILINE)
        return self.property_name, matches


# This regex pattern matches URLs, including those starting with "http://", "https://", or "www."
links_extractor_pattern = r"(?i)\b(?:https?://|www\.)\S+\b"
links_extractor = RegexBasedExtractor(
    pattern=links_extractor_pattern, is_multiline=True, property_name="links"
)

# This regex pattern matches emails, which typically follow the format "username@domain.extension".
emails_extractor_pattern = r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+"
emails_extractor = RegexBasedExtractor(
    pattern=emails_extractor_pattern, is_multiline=False, property_name="emails"
)

# This regex pattern matches Markdown headings, which start with a number sign (#) followed by a space,
# and the rest of the line is the heading text.
markdown_headings_pattern = r"^(#{1,6})\s+(.*)"
markdown_headings_extractor = RegexBasedExtractor(
    pattern=markdown_headings_pattern, is_multiline=True, property_name="headings"
)
