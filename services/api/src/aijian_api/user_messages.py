"""Stable message codes with short text fallbacks for older desktop clients."""

from typing import NotRequired, TypedDict


class UserMessage(TypedDict):
    code: str
    text: str
    detail: NotRequired[str]


def user_message(code: str, text: str, detail: str = "") -> UserMessage:
    result: UserMessage = {"code": code, "text": text}
    if detail:
        result["detail"] = detail
    return result
