# Freesound CC0 原始素材（第三轮用，未处理）

这些是给 GPT 第三轮补素材用的**未处理原始文件**，从 Freesound 页面上的 HQ 预览（约 128kbps MP3）原样下载，没有剪辑、转码、调音量。**预览文件就是来源文件**（原始 WAV 需要登录，未使用）。

- 下载日期：2026-11-04；每个页面下载时都重新确认了许可证为 CC0 1.0（https://creativecommons.org/publicdomain/zero/1.0/）。
- 每个文件的页面标题、作者、页面链接、预览链接、许可证、SHA-256 和时长见 `sources.json`。
- 许可证据：`<类别>/evidence/fs-<编号>.html` 是下载时保存的整页 HTML，`fs-<编号>.txt` 是摘录（标题、作者、链接、许可证）。
- 处理（剪辑、循环、转 48kHz Ogg、响度和峰值）由 GPT 在第三轮完成，处理后的文件放到正式目录并写进 manifest.json；manifest 的 downloadSource 写预览链接，source 写页面链接。
- 这个目录不进 manifest，check.py 不检查它。

| 目录 | 类别 | 文件数 |
| --- | --- | ---: |
| umbrella | 雨伞开合 | 4 |
| night-street | 夜晚街道/小巷底噪 | 4 |
| steel-bar-hit | 钢管击打 | 3 |
| steel-bar-drag | 钢管拖地 | 3 |
| body-fall | 人体倒地 | 3 |
| hospital-corridor | 医院走廊底噪 | 4 |
