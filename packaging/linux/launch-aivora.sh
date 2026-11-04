#!/bin/sh
# Standalone AIVORA desktop. No Node, Python, or system FFmpeg install is required.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
case "${1-}" in
  --check)
    exec "$ROOT/.venv/bin/python" "$ROOT/check-runtime.py"
    ;;
  --help|-h)
    printf '%s\n' 'AIVORA Linux x64 桌面' './launch-aivora.sh        打开桌面软件' './launch-aivora.sh --check 检查内置后端和 FFmpeg'
    exit 0
    ;;
  '') ;;
  *) printf '%s\n' '未知参数。使用 --help 查看用法。' >&2; exit 2 ;;
esac
if [ "$(uname -s)" != Linux ] || [ "$(uname -m)" != x86_64 ]; then
  printf '%s\n' '此包仅适用于 Linux x64。' >&2
  exit 1
fi
if [ "$(id -u)" = 0 ]; then
  printf '%s\n' '请使用普通桌面用户启动。此启动器保留 Electron 沙箱。' >&2
  exit 1
fi
if [ -z "${DISPLAY-}" ] && [ -z "${WAYLAND_DISPLAY-}" ]; then
  printf '%s\n' '未检测到桌面会话。请在图形桌面的终端运行本启动器。' >&2
  exit 1
fi
unset ELECTRON_RUN_AS_NODE NODE_OPTIONS AIJIAN_E2E_USER_DATA_DIR
export AIJIAN_DRAFT_MEDIA_TOOL_ROOT="$ROOT/runtime/ffmpeg/bin"
export AIJIAN_DRAFT_MEDIA_TOOLCHAIN_LOCK="$ROOT/config/linux-desktop-media-lock.json"
cd "$ROOT"
exec "$ROOT/runtime/electron/electron" "$ROOT/apps/desktop"
