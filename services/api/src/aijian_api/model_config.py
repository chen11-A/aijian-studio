"""Model ids live here so a retirement does not require a hunt through callers.

An image model is scheduled to retire on 2026-11-02. This file names the id we
call today and the date. It does not guess the replacement id.
"""

from __future__ import annotations

IMAGE_MODEL = "grok-imagine-image-2.0"
IMAGE_MODEL_RETIRES_ON = "2026-11-02"
VIDEO_MODEL = "grok-imagine-video-1.5"
VIDEO_DRAFT_MODEL = "grok-imagine-video-1.5-lite"
EDIT_MODEL = "grok-imagine-video"
TEXT_MODEL = "grok-4.7"
TTS_MODEL = "grok-tts"

# Proven on the subscription login: image generation, video generation, speech.
# Not proven, so callers must not depend on them: reference images, pinned
# frames, video edits, video extensions, vision review, response_format JSON.
UNPROVEN = (
    "reference_images",
    "last_frame",
    "video_edit",
    "video_extend",
    "vision_qc",
    "json_schema",
)
