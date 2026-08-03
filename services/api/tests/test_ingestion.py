import hashlib

import pytest
from aijian_api.ingestion import MAX_SOURCE_BYTES, SourceValidationError, ingest_text_file


def test_ingests_utf8_bom_crlf_chinese_emoji_and_nfc_with_byte_spans() -> None:
    raw = (
        b"\xef\xbb\xbf"
        + "  第一章 初见\r\n\r\nCafe\u0301 与😀\r\n第二章 再会\r\n结束  \r\n".encode()
    )

    source = ingest_text_file(filename="长篇.txt", content=raw)

    assert source.filename == "长篇.txt"
    assert source.byte_size == len(raw)
    assert source.raw_sha256 == hashlib.sha256(raw).hexdigest()
    assert source.normalized_text == "  第一章 初见\n\nCafé 与😀\n第二章 再会\n结束  \n"
    assert source.chapter_count == 2
    assert [(block.kind, block.chapter_index, block.text) for block in source.blocks] == [
        ("chapter_heading", 1, "第一章 初见"),
        ("paragraph", 1, "Café 与😀"),
        ("chapter_heading", 2, "第二章 再会"),
        ("paragraph", 2, "结束"),
    ]

    normalized_bytes = source.normalized_text.encode()
    for ordinal, block in enumerate(source.blocks):
        assert block.ordinal == ordinal
        assert normalized_bytes[
            block.normalized_start_byte : block.normalized_end_byte
        ].decode() == (block.text)
        assert block.content_sha256 == hashlib.sha256(block.text.encode()).hexdigest()


def test_text_without_headings_uses_one_logical_chapter() -> None:
    source = ingest_text_file(filename="notes.TXT", content="第一段\n\n第二段".encode())

    assert source.chapter_count == 1
    assert [block.kind for block in source.blocks] == ["paragraph", "paragraph"]
    assert [block.chapter_index for block in source.blocks] == [1, 1]


@pytest.mark.parametrize(
    ("filename", "content", "expected_code"),
    [
        ("story.md", b"content", "INVALID_SOURCE_FILE"),
        ("../story.txt", b"content", "INVALID_SOURCE_FILE"),
        ("story\x00.txt", b"content", "INVALID_SOURCE_FILE"),
        ("story.txt", b"", "INVALID_SOURCE_FILE"),
        ("story.txt", b"  \r\n\t", "INVALID_SOURCE_FILE"),
        ("story.txt", b"\xff\xfe", "INVALID_SOURCE_FILE"),
    ],
)
def test_rejects_unsupported_or_unsafe_text_sources(
    filename: str,
    content: bytes,
    expected_code: str,
) -> None:
    with pytest.raises(SourceValidationError) as raised:
        ingest_text_file(filename=filename, content=content)

    assert raised.value.code == expected_code
    if content:
        assert content[:16].hex() not in str(raised.value)


def test_rejects_a_source_over_the_explicit_size_limit() -> None:
    with pytest.raises(SourceValidationError) as raised:
        ingest_text_file(filename="story.txt", content=b"a" * (MAX_SOURCE_BYTES + 1))

    assert raised.value.code == "SOURCE_TOO_LARGE"
