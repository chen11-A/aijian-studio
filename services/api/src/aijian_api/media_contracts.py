"""Versioned media time, conform, and proxy-mapping contracts."""

from math import gcd
from typing import Annotated, Any, Literal, Self, cast
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.json_schema import JsonSchemaValue

CONTENT_HASH_PATTERN = r"^sha256:[0-9a-f]{64}$"
TimecodeMode = Literal["NON_DROP_FRAME", "DROP_FRAME"]
PHASE0_SEQUENCE_FRAME_RATES = (
    (24000, 1001),
    (24, 1),
    (25, 1),
    (30000, 1001),
)
PHASE0_SEQUENCE_TIMEBASES: tuple[tuple[int, int, TimecodeMode], ...] = (
    (24000, 1001, "NON_DROP_FRAME"),
    (24, 1, "NON_DROP_FRAME"),
    (25, 1, "NON_DROP_FRAME"),
    (30000, 1001, "NON_DROP_FRAME"),
    (30000, 1001, "DROP_FRAME"),
)


def _exact_frame_rate_schema(numerator: int, denominator: int) -> JsonSchemaValue:
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "num": {"type": "integer", "const": numerator},
            "den": {"type": "integer", "const": denominator},
        },
        "required": ["num", "den"],
    }


FRAME_RATE_ONE_OF: list[JsonSchemaValue] = [
    _exact_frame_rate_schema(numerator, denominator)
    for numerator, denominator in PHASE0_SEQUENCE_FRAME_RATES
]
TIMEBASE_ONE_OF: list[JsonSchemaValue] = [
    {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "frame_rate": _exact_frame_rate_schema(numerator, denominator),
            "timecode_mode": {"type": "string", "const": mode},
        },
        "required": ["frame_rate", "timecode_mode"],
    }
    for numerator, denominator, mode in PHASE0_SEQUENCE_TIMEBASES
]
JSON_SAFE_INTEGER_MAX = 2**53 - 1
JSON_SAFE_INTEGER_MIN = -JSON_SAFE_INTEGER_MAX
SIGNED_32_MAX = 2**31 - 1
StrictInteger = Annotated[
    int,
    Field(strict=True, ge=JSON_SAFE_INTEGER_MIN, le=JSON_SAFE_INTEGER_MAX),
]
NonNegativeStrictInteger = Annotated[
    int,
    Field(strict=True, ge=0, le=JSON_SAFE_INTEGER_MAX),
]


class RationalData(BaseModel):
    """Canonical integer rational safe across Python, JSON, and TypeScript."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    num: StrictInteger
    den: Annotated[int, Field(strict=True, gt=0, le=SIGNED_32_MAX)]

    @model_validator(mode="after")
    def require_reduced_form(self) -> Self:
        if gcd(abs(self.num), self.den) != 1:
            raise ValueError("rational values must be reduced to canonical form")
        return self


class PositiveRationalData(RationalData):
    """Reduced rational whose physical time direction is strictly positive."""

    @model_validator(mode="after")
    def require_positive_numerator(self) -> Self:
        if self.num <= 0:
            raise ValueError("time base numerator must be positive")
        return self


class SequenceFrameRateData(PositiveRationalData):
    """Frame rate accepted for Phase 0 fixed-rate sequences."""

    model_config = ConfigDict(
        json_schema_extra=cast(Any, {"oneOf": FRAME_RATE_ONE_OF}),
    )

    @model_validator(mode="after")
    def require_supported_phase0_rate(self) -> Self:
        if (self.num, self.den) not in PHASE0_SEQUENCE_FRAME_RATES:
            raise ValueError("sequence frame rate is not supported by the Phase 0 contract")
        return self


class SequenceTimebaseData(BaseModel):
    """Frame timing plus an independent human-readable timecode addressing mode."""

    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        json_schema_extra=cast(Any, {"oneOf": TIMEBASE_ONE_OF}),
    )

    frame_rate: SequenceFrameRateData
    timecode_mode: TimecodeMode

    @model_validator(mode="after")
    def require_valid_drop_frame_combination(self) -> Self:
        if self.timecode_mode == "DROP_FRAME" and (
            self.frame_rate.num,
            self.frame_rate.den,
        ) != (30000, 1001):
            raise ValueError("drop-frame timecode is only supported for 30000/1001")
        return self


class MediaTimestampData(BaseModel):
    """Source presentation timestamp represented as ticks and a positive time base."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    ticks: StrictInteger
    time_base: PositiveRationalData


class ProxyFrameMapEntryData(BaseModel):
    """Exact source presentation frame selected for one CFR proxy frame."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    proxy_frame_index: NonNegativeStrictInteger
    source_frame_index: NonNegativeStrictInteger
    source_pts: MediaTimestampData


class ProxyTimeMapV1(BaseModel):
    """Immutable mapping required to reconnect a CFR proxy to its VFR source."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[1] = 1
    source_asset_sha256: str = Field(pattern=CONTENT_HASH_PATTERN)
    proxy_asset_sha256: str = Field(pattern=CONTENT_HASH_PATTERN)
    source_video_stream_index: NonNegativeStrictInteger
    sequence_timebase: SequenceTimebaseData
    source_timestamp_kind: Literal["PTS"] = "PTS"
    sampling_rule: Literal["HOLD_LAST_PRESENTED_FRAME_AT_PROXY_FRAME_START"] = (
        "HOLD_LAST_PRESENTED_FRAME_AT_PROXY_FRAME_START"
    )
    entries: tuple[ProxyFrameMapEntryData, ...] = Field(min_length=1, max_length=1_000_000)

    @model_validator(mode="after")
    def require_total_monotonic_mapping(self) -> Self:
        first = self.entries[0]
        if first.proxy_frame_index != 0:
            raise ValueError("first proxy frame index must be zero")
        if first.source_frame_index != 0:
            raise ValueError("first source frame index must be zero")

        source_time_base = first.source_pts.time_base
        previous = first
        for current in self.entries[1:]:
            if current.source_pts.time_base != source_time_base:
                raise ValueError("proxy map entries must share one source time base")
            if current.proxy_frame_index != previous.proxy_frame_index + 1:
                raise ValueError("proxy map entries must cover every proxy frame")
            if current.source_frame_index < previous.source_frame_index:
                raise ValueError("source frame index must not decrease")
            if current.source_pts.ticks < previous.source_pts.ticks:
                raise ValueError("source PTS must not decrease")
            if (
                current.source_frame_index == previous.source_frame_index
                and current.source_pts.ticks != previous.source_pts.ticks
            ):
                raise ValueError("repeated source frame must repeat its source PTS")
            if (
                current.source_frame_index > previous.source_frame_index
                and current.source_pts.ticks <= previous.source_pts.ticks
            ):
                raise ValueError("increasing source frame must have increasing source PTS")
            previous = current
        return self


class AudioFrameBoundaryPolicyData(BaseModel):
    """Deterministic sequence-frame to working-audio sample conversion policy."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    sample_rate_hz: Literal[48000] = 48000
    calculation: Literal["ABSOLUTE_FRAME_INDEX"] = "ABSOLUTE_FRAME_INDEX"
    rounding_mode: Literal["NEAREST_TIES_UP"] = "NEAREST_TIES_UP"
    maximum_json_safe_sample_position: Literal[9007199254740991] = 9007199254740991


def sequence_frame_to_audio_sample(
    frame_index: int,
    sequence_timebase: SequenceTimebaseData,
) -> int:
    """Map an absolute frame index to 48 kHz with nearest, ties-up rounding."""

    if (
        isinstance(frame_index, bool)
        or not isinstance(frame_index, int)
        or not 0 <= frame_index <= JSON_SAFE_INTEGER_MAX
    ):
        raise ValueError("frame index must be a safe non-negative integer")
    frame_rate = sequence_timebase.frame_rate
    numerator = frame_index * 48_000 * frame_rate.den
    denominator = frame_rate.num
    sample_position = (numerator + denominator // 2) // denominator
    if sample_position > JSON_SAFE_INTEGER_MAX:
        raise ValueError("audio sample position exceeds JSON safe integer")
    return sample_position


class MediaCapabilitiesData(BaseModel):
    """Stable Phase 0 editing-time policy, not runtime tool health."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    contract_version: Literal[1] = 1
    timeline_time_representation: Literal["REDUCED_RATIONAL"] = "REDUCED_RATIONAL"
    supported_sequence_timebases: tuple[SequenceTimebaseData, ...]
    accepted_source_audio_sample_rates_hz: tuple[Literal[44100, 48000], ...]
    working_audio_sample_rate_hz: Literal[48000] = 48000
    audio_frame_boundary_policy: AudioFrameBoundaryPolicyData = Field(
        default_factory=AudioFrameBoundaryPolicyData
    )
    variable_frame_rate_policy: Literal["CONFORM_TO_CFR_PROXY"] = "CONFORM_TO_CFR_PROXY"
    proxy_mapping_schema_version: Literal[1] = 1

    @classmethod
    def phase0(cls) -> Self:
        return cls(
            supported_sequence_timebases=tuple(
                SequenceTimebaseData(
                    frame_rate=SequenceFrameRateData(num=numerator, den=denominator),
                    timecode_mode=mode,
                )
                for numerator, denominator, mode in PHASE0_SEQUENCE_TIMEBASES
            ),
            accepted_source_audio_sample_rates_hz=(44100, 48000),
        )


class MediaCapabilitiesResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    data: MediaCapabilitiesData
    request_id: UUID
