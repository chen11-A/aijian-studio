"""The closed, versioned literal subtitle repertoire and layout profile.

This profile deliberately excludes emoji, combining marks and scripts needing
shaping. Text is preserved verbatim; unsupported input is never substituted.
"""

SUBTITLE_PROFILE = "noto-cjk-sc-bottom-v1"
SUBTITLE_FONT_NAME = "NotoSansCJKsc-Regular.otf"
SUBTITLE_FONT_SHA256 = "2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b"
SUBTITLE_LICENSE_SHA256 = "6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2"
MAX_SUBTITLE_CUES = 128


def supported_subtitle_character(character: str) -> bool:
    value = ord(character)
    return (
        0x20 <= value <= 0x7E
        or 0x4E00 <= value <= 0x9FFF
        or 0x3000 <= value <= 0x3029
        or 0x3030 <= value <= 0x303F
        or 0xFF01 <= value <= 0xFF5E
        or character in "\n‘’“”—…"
    )


def validate_subtitle_text(text: str) -> str:
    lines = text.split("\n")
    if not 1 <= len(lines) <= 2 or any(not line.strip() or len(line) > 28 for line in lines):
        raise ValueError("Subtitles need one or two nonblank lines, at most 28 characters each")
    if any(not supported_subtitle_character(character) for character in text):
        raise ValueError("Subtitle profile supports basic Han, ASCII and Chinese punctuation only")
    return text
