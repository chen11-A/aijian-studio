"""Deterministic primitives shared by immutable artifact versions."""

import hashlib
import json


def canonical_content_bytes(value: object) -> bytes:
    """Serialize validated JSON-compatible content to its canonical UTF-8 form."""

    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def canonical_content_hash(value: object) -> str:
    """Return the stable, algorithm-qualified digest for artifact content."""

    digest = hashlib.sha256(canonical_content_bytes(value)).hexdigest()
    return f"sha256:{digest}"
