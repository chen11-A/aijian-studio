from fractions import Fraction
from uuid import UUID, uuid4

import pytest
from aijian_api.main import create_app
from aijian_api.media_contracts import (
    MediaTimestampData,
    ProxyFrameMapEntryData,
    ProxyTimeMapV1,
    RationalData,
    SequenceFrameRateData,
    SequenceTimebaseData,
    sequence_frame_to_audio_sample,
)
from fastapi.testclient import TestClient
from pydantic import ValidationError

HASH_A = f"sha256:{'a' * 64}"
HASH_B = f"sha256:{'b' * 64}"


@pytest.mark.parametrize(
    ("numerator", "denominator"),
    [(24000, 1001), (24, 1), (25, 1), (30000, 1001)],
)
def test_phase0_sequence_rates_are_exact_reduced_rationals(
    numerator: int,
    denominator: int,
) -> None:
    rate = SequenceFrameRateData(num=numerator, den=denominator)

    assert rate.model_dump() == {"num": numerator, "den": denominator}


@pytest.mark.parametrize(
    "payload",
    [
        {"num": 24.0, "den": 1},
        {"num": 24, "den": 1.0},
        {"num": True, "den": 1},
        {"num": 1, "den": 0},
        {"num": 24, "den": -1},
        {"num": 48, "den": 2},
        {"num": 0, "den": 1001},
    ],
)
def test_rational_contract_rejects_float_invalid_and_non_canonical_values(
    payload: dict[str, int | float],
) -> None:
    with pytest.raises(ValidationError):
        RationalData.model_validate(payload)


def test_sequence_rate_rejects_a_canonical_but_unsupported_rate() -> None:
    with pytest.raises(ValidationError, match="not supported"):
        SequenceFrameRateData(num=30, den=1)


@pytest.mark.parametrize(
    "payload",
    [
        {"num": 2**53, "den": 1},
        {"num": -(2**53), "den": 1},
        {"num": 1, "den": 2**31},
    ],
)
def test_rational_contract_rejects_values_outside_json_safe_integer_ranges(
    payload: dict[str, int],
) -> None:
    with pytest.raises(ValidationError):
        RationalData.model_validate(payload)


@pytest.mark.parametrize(("numerator", "denominator"), [(0, 1), (-1, 90_000)])
def test_media_timestamp_requires_a_positive_time_base(
    numerator: int,
    denominator: int,
) -> None:
    with pytest.raises(ValidationError):
        MediaTimestampData(
            ticks=0,
            time_base={"num": numerator, "den": denominator},
        )


def test_timestamp_and_proxy_frame_reject_values_outside_json_safe_integer_range() -> None:
    with pytest.raises(ValidationError):
        MediaTimestampData(ticks=2**53, time_base={"num": 1, "den": 1000})

    with pytest.raises(ValidationError):
        ProxyFrameMapEntryData(
            proxy_frame_index=2**53,
            source_frame_index=0,
            source_pts=_timestamp(0),
        )


def test_contract_accepts_exact_safe_integer_boundaries_and_forbids_extra_fields() -> None:
    assert RationalData(num=2**53 - 1, den=1).num == 2**53 - 1
    assert RationalData(num=1, den=2**31 - 1).den == 2**31 - 1
    assert (
        ProxyFrameMapEntryData(
            proxy_frame_index=2**53 - 1,
            source_frame_index=2**53 - 1,
            source_pts=_timestamp(0),
        ).proxy_frame_index
        == 2**53 - 1
    )

    with pytest.raises(ValidationError, match="Extra inputs"):
        RationalData.model_validate({"num": 1, "den": 1, "unexpected": True})


def _timebase(
    numerator: int = 25,
    denominator: int = 1,
    mode: str = "NON_DROP_FRAME",
) -> SequenceTimebaseData:
    return SequenceTimebaseData(
        frame_rate={"num": numerator, "den": denominator},
        timecode_mode=mode,
    )


def _timestamp(ticks: int, *, numerator: int = 1, denominator: int = 90_000) -> MediaTimestampData:
    return MediaTimestampData(
        ticks=ticks,
        time_base={"num": numerator, "den": denominator},
    )


def _entry(
    proxy_frame: int,
    source_frame: int,
    source_pts: int,
    *,
    pts_numerator: int = 1,
    pts_denominator: int = 90_000,
) -> ProxyFrameMapEntryData:
    return ProxyFrameMapEntryData(
        proxy_frame_index=proxy_frame,
        source_frame_index=source_frame,
        source_pts=_timestamp(
            source_pts,
            numerator=pts_numerator,
            denominator=pts_denominator,
        ),
    )


def _mapping(*entries: ProxyFrameMapEntryData) -> ProxyTimeMapV1:
    return ProxyTimeMapV1(
        source_asset_sha256=HASH_A,
        proxy_asset_sha256=HASH_B,
        source_video_stream_index=0,
        sequence_timebase=_timebase(),
        entries=entries,
    )


def test_drop_frame_is_an_addressing_mode_only_for_30000_over_1001() -> None:
    assert _timebase(30000, 1001, "NON_DROP_FRAME").timecode_mode == "NON_DROP_FRAME"
    assert _timebase(30000, 1001, "DROP_FRAME").timecode_mode == "DROP_FRAME"

    with pytest.raises(ValidationError, match="only supported"):
        _timebase(25, 1, "DROP_FRAME")


@pytest.mark.parametrize(
    ("numerator", "denominator", "frame_index", "expected_sample"),
    [
        (24, 1, 1, 2000),
        (25, 1, 1, 1920),
        (24000, 1001, 1, 2002),
        (30000, 1001, 0, 0),
        (30000, 1001, 1, 1602),
        (30000, 1001, 2, 3203),
        (30000, 1001, 5, 8008),
    ],
)
def test_frame_to_audio_sample_uses_absolute_rational_nearest_ties_up(
    numerator: int,
    denominator: int,
    frame_index: int,
    expected_sample: int,
) -> None:
    sequence_timebase = _timebase(numerator, denominator)

    assert sequence_frame_to_audio_sample(frame_index, sequence_timebase) == expected_sample


def test_frame_to_audio_sample_does_not_accumulate_rounding_drift() -> None:
    frame_index = 53_946
    timebase = _timebase(30000, 1001)

    actual = sequence_frame_to_audio_sample(frame_index, timebase)
    exact = Fraction(frame_index * 48_000 * 1001, 30_000)

    assert abs(Fraction(actual) - exact) <= Fraction(1, 2)


@pytest.mark.parametrize("frame_index", [-1, 2**53])
def test_frame_to_audio_sample_rejects_invalid_frame_index(frame_index: int) -> None:
    with pytest.raises(ValueError, match="safe non-negative integer"):
        sequence_frame_to_audio_sample(frame_index, _timebase())


def test_frame_to_audio_sample_rejects_a_json_unsafe_result() -> None:
    with pytest.raises(ValueError, match="sample position exceeds JSON safe integer"):
        sequence_frame_to_audio_sample(2**53 - 1, _timebase(24, 1))


def test_proxy_time_map_records_every_proxy_frame_and_source_pts() -> None:
    mapping = _mapping(
        _entry(0, 0, 0),
        _entry(1, 1, 3600),
        _entry(2, 1, 3600),
        _entry(3, 3, 10_800),
    )

    assert mapping.schema_version == 1
    assert mapping.source_timestamp_kind == "PTS"
    assert mapping.sampling_rule == "HOLD_LAST_PRESENTED_FRAME_AT_PROXY_FRAME_START"
    assert mapping.entries[-1].proxy_frame_index == 3


@pytest.mark.parametrize(
    ("entries", "message"),
    [
        ((_entry(1, 0, 0),), "first proxy frame"),
        ((_entry(0, 1, 0),), "first source frame"),
        ((_entry(0, 0, 0), _entry(2, 1, 3600)), "cover every proxy frame"),
        ((_entry(0, 0, 0), _entry(1, 0, 3600)), "repeated source frame"),
        ((_entry(0, 0, 0), _entry(1, 1, 0)), "increasing source frame"),
        (
            (_entry(0, 0, 0), _entry(1, 1, 3600), _entry(2, 0, 7200)),
            "source frame index must not decrease",
        ),
        ((_entry(0, 0, 3600), _entry(1, 1, 0)), "source PTS must not decrease"),
        ((_entry(0, 0, 0), _entry(1, 1, 40, pts_denominator=1000)), "one source time base"),
    ],
)
def test_proxy_time_map_rejects_ambiguous_or_incomplete_entries(
    entries: tuple[ProxyFrameMapEntryData, ...],
    message: str,
) -> None:
    with pytest.raises(ValidationError, match=message):
        _mapping(*entries)


@pytest.mark.parametrize(
    "overrides",
    [
        {"schema_version": 2},
        {"source_asset_sha256": "sha256:not-a-hash"},
        {"proxy_asset_sha256": "A" * 64},
        {"source_video_stream_index": -1},
    ],
)
def test_proxy_time_map_rejects_invalid_version_hashes_and_stream_index(
    overrides: dict[str, object],
) -> None:
    payload: dict[str, object] = {
        "source_asset_sha256": HASH_A,
        "proxy_asset_sha256": HASH_B,
        "source_video_stream_index": 0,
        "sequence_timebase": _timebase(),
        "entries": (_entry(0, 0, 0),),
    }
    payload.update(overrides)

    with pytest.raises(ValidationError):
        ProxyTimeMapV1.model_validate(payload)


def test_proxy_time_map_and_nested_values_are_immutable_after_validation() -> None:
    mapping = _mapping(_entry(0, 0, 0), _entry(1, 1, 3600))

    with pytest.raises(ValidationError, match="frozen"):
        mapping.entries[1].proxy_frame_index = 0
    with pytest.raises(ValidationError, match="frozen"):
        mapping.sequence_timebase.frame_rate.num = 24


def test_media_capabilities_publish_phase0_time_and_audio_policy() -> None:
    client = TestClient(create_app())
    request_id = str(uuid4())

    response = client.get(
        "/api/v1/media/capabilities",
        headers={"X-Request-ID": request_id},
    )

    assert response.status_code == 200
    assert response.headers["X-Request-ID"] == request_id
    payload = response.json()
    assert UUID(payload["request_id"])
    assert payload["data"] == {
        "contract_version": 1,
        "timeline_time_representation": "REDUCED_RATIONAL",
        "supported_sequence_timebases": [
            {"frame_rate": {"num": 24000, "den": 1001}, "timecode_mode": "NON_DROP_FRAME"},
            {"frame_rate": {"num": 24, "den": 1}, "timecode_mode": "NON_DROP_FRAME"},
            {"frame_rate": {"num": 25, "den": 1}, "timecode_mode": "NON_DROP_FRAME"},
            {"frame_rate": {"num": 30000, "den": 1001}, "timecode_mode": "NON_DROP_FRAME"},
            {"frame_rate": {"num": 30000, "den": 1001}, "timecode_mode": "DROP_FRAME"},
        ],
        "accepted_source_audio_sample_rates_hz": [44100, 48000],
        "working_audio_sample_rate_hz": 48000,
        "audio_frame_boundary_policy": {
            "sample_rate_hz": 48000,
            "calculation": "ABSOLUTE_FRAME_INDEX",
            "rounding_mode": "NEAREST_TIES_UP",
            "maximum_json_safe_sample_position": 2**53 - 1,
        },
        "variable_frame_rate_policy": "CONFORM_TO_CFR_PROXY",
        "proxy_mapping_schema_version": 1,
    }


def test_media_capabilities_publish_integer_only_timebases_in_openapi() -> None:
    schema = create_app().openapi()

    operation = schema["paths"]["/api/v1/media/capabilities"]["get"]
    response_schema = operation["responses"]["200"]["content"]["application/json"]["schema"]
    assert response_schema["$ref"] == "#/components/schemas/MediaCapabilitiesResponse"
    frame_rate_schema = schema["components"]["schemas"]["SequenceFrameRateData"]
    assert frame_rate_schema["properties"]["num"]["type"] == "integer"
    assert frame_rate_schema["properties"]["den"]["exclusiveMinimum"] == 0
    assert frame_rate_schema["properties"]["num"]["maximum"] == 2**53 - 1
    exact_rates = frame_rate_schema["oneOf"]
    assert [
        (item["properties"]["num"]["const"], item["properties"]["den"]["const"])
        for item in exact_rates
    ] == [(24000, 1001), (24, 1), (25, 1), (30000, 1001)]
    assert len(schema["components"]["schemas"]["SequenceTimebaseData"]["oneOf"]) == 5
