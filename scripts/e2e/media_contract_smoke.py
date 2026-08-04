"""Record deterministic evidence for the Phase 0 media time contract."""

import hashlib
import json
import sys
from importlib import import_module
from pathlib import Path

from fastapi.testclient import TestClient

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "services" / "api" / "src"))
media_contracts = import_module("aijian_api.media_contracts")
create_app = import_module("aijian_api.main").create_app
RESULT_PATH = REPOSITORY_ROOT / "docs" / "quality" / "evidence" / "media-contract-smoke.json"
REQUEST_ID = "00000000-0000-0000-0000-000000000001"


def canonical_sha256(value: object) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode(
        "utf-8"
    )
    return hashlib.sha256(encoded).hexdigest()


def main() -> None:
    app = create_app()
    response = TestClient(app).get(
        "/api/v1/media/capabilities",
        headers={"X-Request-ID": REQUEST_ID},
    )
    response.raise_for_status()
    payload = response.json()
    if payload["request_id"] != REQUEST_ID or response.headers["X-Request-ID"] != REQUEST_ID:
        raise RuntimeError("media contract request ID was not preserved")

    source_time_base = media_contracts.PositiveRationalData(num=1, den=90_000)
    sequence_timebase = media_contracts.SequenceTimebaseData(
        frame_rate=media_contracts.SequenceFrameRateData(num=25, den=1),
        timecode_mode="NON_DROP_FRAME",
    )
    mapping = media_contracts.ProxyTimeMapV1(
        source_asset_sha256=f"sha256:{'a' * 64}",
        proxy_asset_sha256=f"sha256:{'b' * 64}",
        source_video_stream_index=0,
        sequence_timebase=sequence_timebase,
        entries=(
            media_contracts.ProxyFrameMapEntryData(
                proxy_frame_index=0,
                source_frame_index=0,
                source_pts=media_contracts.MediaTimestampData(
                    ticks=0,
                    time_base=source_time_base,
                ),
            ),
            media_contracts.ProxyFrameMapEntryData(
                proxy_frame_index=1,
                source_frame_index=1,
                source_pts=media_contracts.MediaTimestampData(
                    ticks=3600,
                    time_base=source_time_base,
                ),
            ),
        ),
    )
    openapi = app.openapi()
    operation = openapi["paths"]["/api/v1/media/capabilities"]["get"]
    contract_schema = {
        "operation": operation,
        "MediaCapabilitiesData": openapi["components"]["schemas"]["MediaCapabilitiesData"],
        "MediaCapabilitiesResponse": openapi["components"]["schemas"]["MediaCapabilitiesResponse"],
        "SequenceFrameRateData": openapi["components"]["schemas"]["SequenceFrameRateData"],
        "SequenceTimebaseData": openapi["components"]["schemas"]["SequenceTimebaseData"],
    }
    evidence = {
        "check": "phase0-media-contract-smoke",
        "passed": True,
        "endpoint": "/api/v1/media/capabilities",
        "operationId": operation["operationId"],
        "contract": payload["data"],
        "requestIdPreserved": True,
        "proxyMapV1Validated": len(mapping.entries) == 2 and mapping.schema_version == 1,
        "audioSampleBoundariesAt30000Over1001": {
            str(frame_index): media_contracts.sequence_frame_to_audio_sample(
                frame_index,
                media_contracts.SequenceTimebaseData(
                    frame_rate=media_contracts.SequenceFrameRateData(num=30000, den=1001),
                    timecode_mode="NON_DROP_FRAME",
                ),
            )
            for frame_index in (0, 1, 2, 5, 53_946)
        },
        "contractSchemaSha256": canonical_sha256(contract_schema),
        "externalMediaOrNetworkUsed": False,
    }
    rendered = json.dumps(evidence, ensure_ascii=False, indent=2, sort_keys=True)
    rendered = rendered.replace(
        '    "accepted_source_audio_sample_rates_hz": [\n      44100,\n      48000\n    ],',
        '    "accepted_source_audio_sample_rates_hz": [44100, 48000],',
    )
    RESULT_PATH.write_text(rendered + "\n", encoding="utf-8", newline="\n")
    print("Phase 0 media contract smoke: PASS")


if __name__ == "__main__":
    main()
