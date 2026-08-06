from pathlib import Path

import pytest

from scripts.media_proxy_evidence import ProxyEvidenceError, _canonical_path


@pytest.mark.parametrize(
    "relative_path",
    (
        "carrier.mkv:proxy.webm",
        "C:proxy.webm",
        "C:/proxy.webm",
        "\\\\?\\C:\\proxy.webm",
        "\\\\server\\share\\proxy.webm",
        "CON.webm",
        "proxy.webm.",
    ),
)
def test_proxy_manifest_rejects_windows_special_paths(tmp_path: Path, relative_path: str) -> None:
    with pytest.raises(ProxyEvidenceError, match="non-canonical"):
        _canonical_path(tmp_path, relative_path, ".webm")
