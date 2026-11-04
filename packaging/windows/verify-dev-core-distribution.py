"""Fail closed before binary upload until exact native-input license evidence exists."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
from urllib.parse import urlsplit


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def local_file(root: Path, value: str) -> Path:
    relative = Path(value)
    if (
        relative.is_absolute()
        or ".." in relative.parts
        or "\\" in value
        or ":" in value
        or any(part in {"", "."} for part in value.split("/"))
    ):
        raise ValueError("Evidence paths must stay within the development stage")
    path = root / relative
    for cursor in (path, *path.parents):
        if cursor.is_symlink() or cursor.is_junction():
            raise ValueError("License evidence cannot follow a link")
        if cursor == root:
            break
    if not path.is_file():
        raise ValueError("Referenced distribution evidence is absent")
    return path


def verify(stage: Path, review: dict) -> None:
    if (
        review.get("schema_version") != 1
        or review.get("profile") != "DEVELOPMENT_CORE"
        or review.get("status") != "MATERIALS_VERIFIED"
        or review.get("release_approved") is not False
    ):
        raise ValueError(
            "Installer upload blocked: " + str(review.get("reason", "missing material review"))
        )
    actual = {
        path.relative_to(stage).as_posix(): digest(path)
        for path in (stage / "resources/sidecar").rglob("*")
        if path.is_file() and path.suffix.lower() in {".dll", ".pyd", ".exe"}
    }
    if not actual:
        raise ValueError("No real frozen native components to verify")
    declared = {}
    for component in review.get("native_components", []):
        binary = component["path"]
        if binary in declared:
            raise ValueError("Duplicate native-component review")
        declared[binary] = component["sha256"]
        if digest(local_file(stage, binary)) != component["sha256"]:
            raise ValueError("Reviewed native component changed")
        url = urlsplit(component["source_url"])
        if url.scheme != "https" or url.username or url.password:
            raise ValueError("Native component needs a verified primary HTTPS source")
        if (
            not component.get("name")
            or not component.get("version")
            or not component.get("licenses")
        ):
            raise ValueError("Component name/version/license evidence is incomplete")
        for item in component["licenses"]:
            if not item["path"].startswith("resources/licenses/"):
                raise ValueError("License material must be shipped with the application")
            if digest(local_file(stage, item["path"])) != item["sha256"]:
                raise ValueError("License material changed")
    if declared != actual:
        raise ValueError(
            "Every actual frozen native file needs exact reviewed source/license mapping"
        )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", type=Path, required=True)
    parser.add_argument("--review", type=Path, required=True)
    parser.add_argument("--frozen-receipt", type=Path, required=True)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--installer-receipt", type=Path, required=True)
    args = parser.parse_args()
    review = json.loads(args.review.read_text())
    verify(args.stage, review)
    spec = importlib.util.spec_from_file_location(
        "native_materials", Path(__file__).parent / "map-dev-native-materials.py"
    )
    assert spec and spec.loader
    mapper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mapper)
    if mapper.make_review(args.stage, args.frozen_receipt, args.cache) != review:
        raise ValueError("Generated material receipt differs from reverified exact inputs")
    spec = importlib.util.spec_from_file_location(
        "core_nsis", Path(__file__).parent / "nsis-dev-core.py"
    )
    assert spec and spec.loader
    core = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(core)
    core.verify(args.stage, json.loads(args.installer_receipt.read_text()))
    print(
        "Exact development input/material hashes and plugin-free installer verified; "
        "formal release remains unapproved"
    )


if __name__ == "__main__":
    main()
