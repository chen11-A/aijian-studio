"""Deterministic, provider-free ingestion for the first UTF-8 TXT slice."""

import hashlib
import re
import unicodedata
from dataclasses import dataclass
from typing import Literal

from aijian_api.domain import SourceBlockKind

MAX_SOURCE_BYTES = 5 * 1024 * 1024
_CHAPTER_HEADING = re.compile(
    r"^(?:第[零〇一二三四五六七八九十百千万0-9]+[章节回卷部篇]|序章|楔子|尾声|后记|番外(?:[零〇一二三四五六七八九十0-9]+)?).*$"
)

type SourceErrorCode = Literal["INVALID_SOURCE_FILE", "SOURCE_TOO_LARGE"]


class SourceValidationError(ValueError):
    def __init__(self, code: SourceErrorCode) -> None:
        self.code = code
        message = (
            "Source file is invalid"
            if code == "INVALID_SOURCE_FILE"
            else "Source file is too large"
        )
        super().__init__(message)


@dataclass(frozen=True, slots=True)
class SourceBlockDraft:
    ordinal: int
    kind: SourceBlockKind
    chapter_index: int
    text: str
    normalized_start_byte: int
    normalized_end_byte: int
    content_sha256: str


@dataclass(frozen=True, slots=True)
class ParsedSource:
    filename: str
    media_type: Literal["text/plain"]
    encoding: Literal["utf-8"]
    byte_size: int
    raw_sha256: str
    normalized_text: str
    chapter_count: int
    blocks: tuple[SourceBlockDraft, ...]


def _validate_filename(filename: str) -> None:
    unsafe = (
        not filename
        or len(filename) > 255
        or "/" in filename
        or "\\" in filename
        or not filename.casefold().endswith(".txt")
        or any(ord(character) < 32 or ord(character) == 127 for character in filename)
    )
    if unsafe:
        raise SourceValidationError("INVALID_SOURCE_FILE")


def _decode_and_normalize(content: bytes) -> str:
    try:
        decoded = content.decode("utf-8-sig", errors="strict")
    except UnicodeDecodeError as error:
        raise SourceValidationError("INVALID_SOURCE_FILE") from error
    normalized = unicodedata.normalize("NFC", decoded.replace("\r\n", "\n").replace("\r", "\n"))
    if not normalized.strip():
        raise SourceValidationError("INVALID_SOURCE_FILE")
    return normalized


def _build_blocks(normalized: str) -> tuple[tuple[SourceBlockDraft, ...], int]:
    blocks: list[SourceBlockDraft] = []
    explicit_chapters = 0
    byte_cursor = 0
    for source_line in normalized.splitlines(keepends=True):
        line = source_line[:-1] if source_line.endswith("\n") else source_line
        text = line.strip()
        if text:
            leading_characters = len(line) - len(line.lstrip())
            start_byte = byte_cursor + len(line[:leading_characters].encode())
            end_byte = start_byte + len(text.encode())
            is_heading = _CHAPTER_HEADING.fullmatch(text) is not None
            if is_heading:
                explicit_chapters += 1
            chapter_index = explicit_chapters if explicit_chapters > 0 else 1
            blocks.append(
                SourceBlockDraft(
                    ordinal=len(blocks),
                    kind="chapter_heading" if is_heading else "paragraph",
                    chapter_index=chapter_index,
                    text=text,
                    normalized_start_byte=start_byte,
                    normalized_end_byte=end_byte,
                    content_sha256=hashlib.sha256(text.encode()).hexdigest(),
                )
            )
        byte_cursor += len(source_line.encode())
    return tuple(blocks), explicit_chapters or 1


def ingest_text_file(*, filename: str, content: bytes) -> ParsedSource:
    """Validate and parse one immutable UTF-8 source payload."""

    _validate_filename(filename)
    if len(content) > MAX_SOURCE_BYTES:
        raise SourceValidationError("SOURCE_TOO_LARGE")
    normalized = _decode_and_normalize(content)
    blocks, chapter_count = _build_blocks(normalized)
    return ParsedSource(
        filename=filename,
        media_type="text/plain",
        encoding="utf-8",
        byte_size=len(content),
        raw_sha256=hashlib.sha256(content).hexdigest(),
        normalized_text=normalized,
        chapter_count=chapter_count,
        blocks=blocks,
    )
