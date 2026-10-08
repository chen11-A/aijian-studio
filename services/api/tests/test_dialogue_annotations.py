from __future__ import annotations

import hashlib

import pytest
from aijian_api.dialogue_annotations import DialogueAnnotationV1
from aijian_api.media_contracts import SequenceFrameRateData, SequenceTimebaseData
from pydantic import ValidationError


def _timebase() -> SequenceTimebaseData:
    return SequenceTimebaseData(
        frame_rate=SequenceFrameRateData(num=24, den=1),
        timecode_mode="NON_DROP_FRAME",
    )


def _text_hash(text: str) -> str:
    return f"sha256:{hashlib.sha256(text.encode('utf-8')).hexdigest()}"


def _payload() -> dict[str, object]:
    text = "月光落在旧城墙上。"
    return {
        "project_id": "prj_0123456789abcdef0123456789abcdef",
        "media_sha256": "sha256:" + "a" * 64,
        "media_artifact_version_id": "ver_0123456789abcdef0123456789abcdef",
        "sequence_timebase": _timebase(),
        "media_frame_count": 240,
        "start_frame": 24,
        "end_frame": 72,
        "audio_stream_index": 0,
        "audio_sample_count": 480_000,
        "audio_start_sample_position": 48_000,
        "audio_end_sample_position": 144_000,
        "dialogue_text": text,
        "dialogue_text_sha256": _text_hash(text),
        "anchors": (
            {"observed_media_frame": 24, "observed_audio_sample_position": 48120},
            {"observed_media_frame": 48, "observed_audio_sample_position": 96120},
        ),
    }


def test_frozen_dialogue_annotation_binds_chinese_text_to_media_version_and_exact_av_anchors() -> (
    None
):
    annotation = DialogueAnnotationV1.model_validate(_payload())

    assert annotation.frame_range == (24, 72)
    assert annotation.anchors[0].observed_audio_sample_position == 48120
    assert annotation.observed_offset_samples == (120, 120)
    assert annotation.dialogue_text == "月光落在旧城墙上。"
    assert annotation.model_dump(mode="json")["dialogue_text_sha256"] == _text_hash(
        annotation.dialogue_text
    )
    assert DialogueAnnotationV1.model_validate(annotation.model_dump(mode="json")).model_dump(
        mode="json"
    ) == annotation.model_dump(mode="json")


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("dialogue_text_sha256", "sha256:" + "b" * 64, "dialogue text hash"),
        ("end_frame", 241, "frame range"),
        ("audio_end_sample_position", 480_001, "audio range"),
        (
            "anchors",
            (
                {"observed_media_frame": 48, "observed_audio_sample_position": 96120},
                {"observed_media_frame": 24, "observed_audio_sample_position": 48120},
            ),
            "strictly increase",
        ),
        (
            "anchors",
            (
                {"observed_media_frame": 24, "observed_audio_sample_position": 48120},
                {"observed_media_frame": 48, "observed_audio_sample_position": 48120},
            ),
            "strictly increase",
        ),
    ],
)
def test_dialogue_annotation_rejects_unbound_or_noncanonical_timing(
    field: str, value: object, message: str
) -> None:
    payload = _payload()
    payload[field] = value

    with pytest.raises(ValidationError, match=message):
        DialogueAnnotationV1.model_validate(payload)


def test_dialogue_annotation_rejects_invalid_utf8_bytes_before_text_hashing() -> None:
    with pytest.raises(UnicodeDecodeError):
        DialogueAnnotationV1.from_utf8_bytes(
            b"\xff\xfe",
            payload_without_text={
                key: value
                for key, value in _payload().items()
                if key not in {"dialogue_text", "dialogue_text_sha256"}
            },
        )


def test_dialogue_annotation_hashes_exact_utf8_bytes_and_refuses_review_verdicts() -> None:
    payload = _payload()
    payload_without_text = {
        key: value
        for key, value in payload.items()
        if key not in {"dialogue_text", "dialogue_text_sha256"}
    }

    annotation = DialogueAnnotationV1.from_utf8_bytes(
        "月光落在旧城墙上。".encode(),
        payload_without_text=payload_without_text,
    )

    assert annotation.dialogue_text_sha256 == _text_hash(annotation.dialogue_text)
    with pytest.raises(ValidationError, match="Extra inputs"):
        DialogueAnnotationV1.model_validate({**_payload(), "review_status": "PASS"})
