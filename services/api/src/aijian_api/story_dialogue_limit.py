"""Structured facts from a verified pre-target-video speech limit; never file authority."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True, slots=True)
class StoryDialogueLimit:
    required_seconds: float
    max_seconds: int
    shot_index: int | None
    request_sha256: str
    raw_audio_saved: bool
    raw_audio_sha256: str | None
    schema_version: Literal[1] = 1
    speech_window: Literal[1] = 1
    # This target during this request only, not the whole batch or past attempts.
    target_video_submitted: Literal[False] = False


def dialogue_request_sha256(
    model: str,
    voice_id: str,
    delivery: str,
    narration: str,
    lines: tuple[tuple[str, str, str], ...],
    speech_model: str = "grok-tts",
) -> str:
    """Fixed ordered string arrays match main JSON.stringify, without paths or cache keys."""
    value = [model, voice_id, delivery, narration, lines, speech_model]
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()
