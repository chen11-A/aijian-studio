"""ZIP interchange with bounded extraction, no symlinks, and exclusive publication."""

import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import sys
import tempfile
import zipfile

MAX_FILES = 10000
MAX_BYTES = 8 * 1024**3


def safe_name(name):
    if not name or "\\" in name or "\x00" in name or ":" in name:
        raise ValueError("不安全的归档路径")
    parts = name.rstrip("/").split("/")
    if name.startswith("/") or any(p in ("", ".", "..") for p in parts):
        raise ValueError("归档路径穿越")
    return PurePosixPath(*parts)


def check_project(root):
    with (root / "project.json").open(encoding="utf-8") as handle:
        if not isinstance(json.load(handle), dict):
            raise ValueError("project.json 必须是 JSON 对象")


def pack(source, output):
    root = source.resolve(strict=True)
    if source.is_symlink() or not root.is_dir():
        raise ValueError("项目必须是普通目录")
    if output.resolve().is_relative_to(root):
        raise ValueError("归档输出必须位于项目目录外")
    check_project(root)
    entries = sorted(root.rglob("*"))
    if len(entries) > MAX_FILES:
        raise ValueError("项目文件过多")
    total = 0
    for entry in entries:
        mode = entry.lstat().st_mode
        if not (stat.S_ISREG(mode) or stat.S_ISDIR(mode)):
            raise ValueError("项目不能包含链接或特殊文件")
        safe_name(entry.relative_to(root).as_posix())
        total += entry.stat().st_size if entry.is_file() else 0
    if total > MAX_BYTES:
        raise ValueError("项目超过 8 GiB")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="aivora-zip-", dir=output.parent) as stage:
        temporary = Path(stage) / "project.zip"
        with zipfile.ZipFile(temporary, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
            for entry in entries:
                archive.write(entry, entry.relative_to(root).as_posix())
        os.link(temporary, output)  # Exclusive publication, never overwrite.


def restore(source, destination):
    if destination.exists() or destination.is_symlink():
        raise ValueError("恢复目录必须不存在")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(source) as archive:
        entries = archive.infolist()
        if len(entries) > MAX_FILES or sum(e.file_size for e in entries) > MAX_BYTES:
            raise ValueError("归档超过文件数或大小限制")
        seen = set()
        names = []
        for entry in entries:
            name = safe_name(entry.filename)
            key = str(name).casefold()
            if key in seen:
                raise ValueError("重复归档路径")
            seen.add(key)
            mode = entry.external_attr >> 16
            kind = stat.S_IFMT(mode)
            if kind not in (0, stat.S_IFREG, stat.S_IFDIR) or entry.flag_bits & 1:
                raise ValueError("拒绝链接、特殊文件或加密归档")
            if entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                raise ValueError("仅支持 STORE / DEFLATE ZIP")
            names.append(name)
        with tempfile.TemporaryDirectory(prefix="aivora-restore-", dir=destination.parent) as stage:
            root = Path(stage) / "project"
            root.mkdir()
            actual = 0
            for entry, name in zip(entries, names):
                target = root.joinpath(*name.parts)
                if entry.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(entry) as src, target.open("xb") as dst:
                    while chunk := src.read(1024 * 1024):
                        actual += len(chunk)
                        if actual > MAX_BYTES:
                            raise ValueError("解压大小超过限制")
                        dst.write(chunk)
            check_project(root)
            # Reserve the name exclusively before moving staged content.
            destination.mkdir()
            try:
                for entry in root.iterdir():
                    shutil.move(str(entry), destination / entry.name)
            except BaseException:
                shutil.rmtree(destination)
                raise


if __name__ == "__main__":
    action, source_arg, target_arg = sys.argv[1:]
    if action == "pack":
        pack(Path(source_arg), Path(target_arg))
    elif action == "restore":
        restore(Path(source_arg), Path(target_arg))
    else:
        raise ValueError("未知操作")
