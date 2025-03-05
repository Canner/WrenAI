# SPDX-FileCopyrightText: 2022-present deepset GmbH <info@deepset.ai>
#
# SPDX-License-Identifier: Apache-2.0

from abc import ABC, abstractmethod
from typing import Any, Dict, List

from haystack import logging
from haystack.dataclasses import ChatMessage

logger = logging.getLogger(__name__)


class ChatMessageStore(ABC):
    """
    Stores ChatMessages to be used by the components of a Pipeline.

    Classes implementing this protocol might store ChatMessages either in durable storage or in memory. They might
    allow specialized components (e.g. retrievers) to perform retrieval on them, either by embedding, by keyword,
    hybrid, and so on, depending on the backend used.

    In order to write or retrieve chat messages, consider using a ChatMessageWriter or ChatMessageRetriever.
    """

    @abstractmethod
    def to_dict(self) -> Dict[str, Any]:
        """
        Serializes this store to a dictionary.

        :returns: The serialized store as a dictionary.
        """

    @classmethod
    @abstractmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ChatMessageStore":
        """
        Deserializes the store from a dictionary.

        :param data: The dictionary to deserialize from.
        :returns: The deserialized store.
        """

    @abstractmethod
    def count_messages(self) -> int:
        """
        Returns the number of chat messages stored.

        :returns: The number of messages.
        """

    @abstractmethod
    def write_messages(self, messages: List[ChatMessage]) -> int:
        """
        Writes chat messages to the ChatMessageStore.

        :param messages: A list of ChatMessages to write.
        :returns: The number of messages written.

        :raises ValueError: If messages is not a list of ChatMessages.
        """

    @abstractmethod
    def delete_messages(self) -> None:
        """
        Deletes all stored chat messages.
        """

    @abstractmethod
    def retrieve(self) -> List[ChatMessage]:
        """
        Retrieves all stored chat messages.

        :returns: A list of chat messages.
        """
