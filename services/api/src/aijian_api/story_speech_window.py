"""Versioned local speech padding; provider cache bytes are never passed as output."""

from __future__ import annotations

import wave
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class SpeechWindow:
    version: str = "speech-window-48k-v1"
    sample_rate: int = 48000
    head_samples: int = 19200
    tail_samples: int = 28800

    def required_seconds(self, body_seconds: float) -> float:
        return body_seconds + (self.head_samples + self.tail_samples) / self.sample_rate


SPEECH_WINDOW = SpeechWindow()


def pad_pcm(source: Path, destination: Path, policy: SpeechWindow) -> float:
    """Add exact silent samples to normalized PCM without modifying any body samples."""
    with wave.open(str(source), "rb") as audio:
        if audio.getframerate() != policy.sample_rate or audio.getsampwidth() != 2:
            raise ValueError("Speech window requires 48 kHz signed 16-bit PCM")
        width = audio.getnchannels() * audio.getsampwidth()
        frames = audio.getnframes()
        with wave.open(str(destination), "wb") as result:
            result.setparams(audio.getparams())
            result.writeframesraw(bytes(policy.head_samples * width))
            # A decoded, bounded clip is streamed rather than copied into a second buffer.
            while body := audio.readframes(8192):
                result.writeframesraw(body)
            result.writeframesraw(bytes(policy.tail_samples * width))
    return (frames + policy.head_samples + policy.tail_samples) / policy.sample_rate
