"""Closed reviewer input contract for ArtifactProposal rejection."""

import unicodedata
from typing import Literal

type ArtifactProposalRejectionReason = Literal[
    "SOURCE_EVIDENCE",
    "CREATIVE_DIRECTION",
    "CONTINUITY",
    "TECHNICAL_QUALITY",
    "RIGHTS_OR_SAFETY",
    "BUDGET_OR_COST",
    "OTHER",
]


def normalize_rejection_comment(value: str) -> str:
    """Return the canonical bounded comment stored in the immutable audit row."""

    normalized = unicodedata.normalize("NFC", value.replace("\r\n", "\n").replace("\r", "\n"))
    normalized = normalized.strip()
    if not normalized or len(normalized) > 4000:
        raise ValueError("rejection comment must contain 1 to 4000 characters")
    if len(normalized.encode("utf-8")) > 16 * 1024:
        raise ValueError("rejection comment must not exceed 16 KiB as UTF-8")
    if any(
        (ord(character) < 32 and character not in {"\t", "\n"}) or ord(character) == 127
        for character in normalized
    ):
        raise ValueError("rejection comment contains a prohibited control character")
    return normalized
