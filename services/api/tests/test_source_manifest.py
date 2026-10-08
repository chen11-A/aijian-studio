from collections.abc import Callable
from typing import Any

import pytest
from aijian_api.source_manifest import SourceManifestContentV1
from pydantic import ValidationError


def manifest_payload() -> dict[str, Any]:
    return {
        "scope_type": "full_work",
        "documents": [
            {
                "source_document_id": f"src_{'1' * 32}",
                "import_order": 1,
                "filename": "雾城😀.txt",
                "media_type": "text/plain",
                "encoding": "utf-8",
                "byte_size": 18,
                "raw_sha256": "a" * 64,
                "normalized_sha256": "b" * 64,
                "chapter_count": 1,
                "blocks": [
                    {
                        "source_block_id": f"srcb_{'2' * 32}",
                        "ordinal": 0,
                        "kind": "paragraph",
                        "chapter_index": 1,
                        "start_byte": 0,
                        "end_byte": 18,
                        "content_sha256": "c" * 64,
                    }
                ],
            }
        ],
        "exclusions": [],
    }


def test_source_manifest_v1_round_trips_strict_typed_content() -> None:
    content = SourceManifestContentV1.model_validate(manifest_payload())

    assert content.documents[0].filename == "雾城😀.txt"
    assert content.model_dump(mode="json") == manifest_payload()


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (
            lambda payload: payload["documents"][0].update(import_order=2),
            "import order",
        ),
        (
            lambda payload: payload["documents"][0]["blocks"][0].update(start_byte=18),
            "byte range",
        ),
        (
            lambda payload: payload.update(unexpected=True),
            "Extra inputs",
        ),
    ],
)
def test_source_manifest_v1_rejects_invalid_or_unknown_structure(
    mutate: Callable[[dict[str, Any]], None], message: str
) -> None:
    payload = manifest_payload()
    mutate(payload)

    with pytest.raises(ValidationError, match=message):
        SourceManifestContentV1.model_validate(payload)
