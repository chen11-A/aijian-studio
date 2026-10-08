import hashlib

import pytest
from aijian_api.artifacts import canonical_content_bytes, canonical_content_hash


def test_canonical_content_bytes_are_stable_for_unicode_and_key_order() -> None:
    first = {
        "title": "雾城😀",
        "facts": [],
        "note": "e\u0301\n下一行",
        "nested": {"z": 2, "a": 1},
    }
    second = {
        "nested": {"a": 1, "z": 2},
        "note": "e\u0301\n下一行",
        "facts": [],
        "title": "雾城😀",
    }

    expected = ('{"facts":[],"nested":{"a":1,"z":2},"note":"é\\n下一行","title":"雾城😀"}').encode()

    assert canonical_content_bytes(first) == expected
    assert canonical_content_bytes(second) == expected
    assert canonical_content_hash(first) == f"sha256:{hashlib.sha256(expected).hexdigest()}"
    assert canonical_content_hash(second) == canonical_content_hash(first)


def test_canonical_content_hash_changes_when_content_changes() -> None:
    original = {"facts": [{"statement": "旧车站有一封信"}]}
    revised = {"facts": [{"statement": "旧车站有两封信"}]}

    assert canonical_content_hash(original) != canonical_content_hash(revised)


@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf")])
def test_canonical_content_bytes_reject_non_finite_numbers(value: float) -> None:
    with pytest.raises(ValueError, match="Out of range float values"):
        canonical_content_bytes({"confidence": value})
