import typing as t

from pydantic import BaseModel


class Message(BaseModel):
    """
    Represents a generic message.

    Attributes
    ----------
    content : str
        The content of the message.
    metadata : Optional[Dict[str, Any]], optional
        Additional metadata associated with the message.
    """

    content: str
    metadata: t.Optional[t.Dict[str, t.Any]] = None


class ToolCall(BaseModel):
    """
    Represents a tool call with a name and arguments.

    Parameters
    ----------
    name : str
        The name of the tool being called.
    args : Dict[str, Any]
        A dictionary of arguments for the tool call, where keys are argument names
        and values can be strings, integers, or floats.
    """

    name: str
    args: t.Dict[str, t.Any]


class HumanMessage(Message):
    """
    Represents a message from a human user.

    Attributes
    ----------
    type : Literal["human"]
        The type of the message, always set to "human".

    Methods
    -------
    pretty_repr()
        Returns a formatted string representation of the human message.
    """

    type: t.Literal["human"] = "human"

    def pretty_repr(self):
        """Returns a formatted string representation of the human message."""
        return f"Human: {self.content}"


class ToolMessage(Message):
    """
    Represents a message from a tool.

    Attributes
    ----------
    type : Literal["tool"]
        The type of the message, always set to "tool".

    Methods
    -------
    pretty_repr()
        Returns a formatted string representation of the tool message.
    """

    type: t.Literal["tool"] = "tool"

    def pretty_repr(self):
        """Returns a formatted string representation of the tool message."""
        return f"ToolOutput: {self.content}"


class AIMessage(Message):
    """
    Represents a message from an AI.

    Attributes
    ----------
    type : Literal["ai"]
        The type of the message, always set to "ai".
    tool_calls : Optional[List[ToolCall]]
        A list of tool calls made by the AI, if any.
    metadata : Optional[Dict[str, Any]]
        Additional metadata associated with the AI message.

    Methods
    -------
    dict(**kwargs)
        Returns a dictionary representation of the AI message.
    pretty_repr()
        Returns a formatted string representation of the AI message.
    """

    type: t.Literal["ai"] = "ai"
    tool_calls: t.Optional[t.List[ToolCall]] = None
    metadata: t.Optional[t.Dict[str, t.Any]] = None

    def to_dict(self, **kwargs):
        """
        Returns a dictionary representation of the AI message.
        """
        content = (
            self.content
            if self.tool_calls is None
            else {
                "text": self.content,
                "tool_calls": [tc.dict() for tc in self.tool_calls],
            }
        )
        return {"content": content, "type": self.type}

    def pretty_repr(self):
        """
        Returns a formatted string representation of the AI message.
        """
        lines = []
        if self.content != "":
            lines.append(f"AI: {self.content}")
        if self.tool_calls is not None:
            lines.append("Tools:")
            for tc in self.tool_calls:
                lines.append(f"  {tc.name}: {tc.args}")

        return "\n".join(lines)
