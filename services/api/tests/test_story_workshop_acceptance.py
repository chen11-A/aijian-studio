import copy
import hashlib
import json
from collections.abc import Callable
from pathlib import Path
from runpy import run_path
from typing import Any, cast

import pytest

REPOSITORY_ROOT = Path(__file__).parents[3]
FIXTURE_PATH = REPOSITORY_ROOT / "docs/quality/evidence/story-workshop-fixture.json"
validate_fixture = cast(
    Callable[[dict[str, Any]], None],
    run_path(str(REPOSITORY_ROOT / "scripts/accept_story_workshop.py"))["validate_fixture"],
)


def _fixture() -> dict[str, Any]:
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def test_story_workshop_fixture_has_valid_semantic_evidence() -> None:
    validate_fixture(_fixture())


def test_story_workshop_fixture_rejects_quote_outside_bound_block() -> None:
    fixture = copy.deepcopy(_fixture())
    span = fixture["story_version"]["data"]["version"]["source_spans"][0]
    source = next(item for item in fixture["sources"] if item["id"] == span["source_document_id"])
    block = next(item for item in source["blocks"] if item["id"] == span["source_block_id"])
    span["start_byte"] = block["normalized_start_byte"] - 1
    span["end_byte"] = block["normalized_start_byte"]
    span["quote_hash"] = f"sha256:{hashlib.sha256(b'').hexdigest()}"

    with pytest.raises(ValueError, match="outside the bound source block"):
        validate_fixture(fixture)
