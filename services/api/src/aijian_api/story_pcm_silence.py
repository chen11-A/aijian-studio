"""Exact digital silence only; an unavailable loudness measurement is not silence."""

from __future__ import annotations

import os
import stat
import wave
from pathlib import Path

MAX_EXACT_ZERO_PCM_BYTES = 80 * 1024 * 1024


def is_exact_zero_pcm(path: Path) -> bool:
    """Recognize complete signed-16 PCM WAV zeros without loading the whole file.

    Unknown formats, empty/truncated input and any nonzero sample keep the normal
    spoken-audio path. In particular unsigned 8-bit zero bytes are not silence.
    """
    try:
        info = path.stat()
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_EXACT_ZERO_PCM_BYTES:
            return False
        with path.open("rb") as stream:
            before = os.fstat(stream.fileno())
            if not stat.S_ISREG(before.st_mode) or before.st_size > MAX_EXACT_ZERO_PCM_BYTES:
                return False
            with wave.open(stream, "rb") as audio:
                channels, rate, width = (
                    audio.getnchannels(),
                    audio.getframerate(),
                    audio.getsampwidth(),
                )
                if (
                    audio.getcomptype() != "NONE"
                    or width != 2
                    or not 1 <= channels <= 8
                    or not 8000 <= rate <= 192000
                ):
                    return False
                frame_bytes = channels * width
                remaining = audio.getnframes() * frame_bytes
                if not 0 < remaining <= MAX_EXACT_ZERO_PCM_BYTES:
                    return False
                while remaining:
                    data = audio.readframes(min(4096, remaining // frame_bytes))
                    if not data or len(data) % frame_bytes or any(data):
                        return False
                    remaining -= len(data)
                if audio.readframes(1):
                    return False
            after = os.fstat(stream.fileno())
            return (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) == (
                after.st_dev,
                after.st_ino,
                after.st_size,
                after.st_mtime_ns,
            )
    except (OSError, wave.Error, EOFError, ValueError, ZeroDivisionError):
        return False
