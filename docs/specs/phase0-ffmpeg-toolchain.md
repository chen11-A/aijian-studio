# Phase 0 FFmpeg 工具链与黄金媒体规格

状态：Implementing（M02）

依赖：[Phase 0 媒体时间基线契约](phase0-media-contract.md)

## 目标

M02 把“机器上可能装了 FFmpeg”升级为可审计、可重复、默认拒绝不明二进制的媒体工具链，
并用合成黄金媒体证明固定帧率、VFR、44.1/48 kHz、Unicode/长路径、损坏输入、CFR 代理和播放路径。

成功不等于命令返回零。完成时必须同时具备：精确版本与二进制指纹、许可分类、受限本地探测、
固定夹具及 SHA-256、逐帧/逐样本验证、代理回连证据和可重放的自动化报告。

## 已确认假设

- M02 仓库可重复基线锁定 FFmpeg/ffprobe `8.1.2`。该版本只作为本仓库锁文件和证据的可重复基线，
  不声明为今天的 FFmpeg 当前稳定版。历史下载来源记录为：
  <https://ffmpeg.org/download.html>。
- 本机 Gyan full build 启用了 `--enable-gpl --enable-version3`。它只用于开发和证据生成，
  不进入安装包，也不获得“可随 Apache-2.0 应用分发”的状态。
- FFmpeg 官方许可页说明默认主体为 LGPL 2.1+，启用 GPL 组件后整个 FFmpeg 构建适用 GPL；
  LGPL 分发还需要对应源码、构建配置和声明：<https://ffmpeg.org/legal.html>。
- 仓库不自动下载、替换或执行未知 FFmpeg。工具来自显式目录或 PATH，但必须与锁文件中的
  版本和两个可执行文件 SHA-256 完全匹配。
- 黄金媒体只使用 FFmpeg 的合成视频/音频源生成，不下载真实影片、音乐、字体或其他受版权素材。

## 工具链锁

`config/media-toolchain-lock.json` 是唯一版本/指纹来源，schema version 为 1。每个 profile 包含：

- profile ID、FFmpeg 基础版本、`ffmpeg`/`ffprobe` SHA-256；
- 构建来源、configure 许可分类和发行状态；
- `DEV_GPL` 或未来 `RELEASE_LGPL_REVIEWED`，没有自动 `RELEASE_APPROVED` 状态。

发现流程：

1. 显式根目录优先，否则分别从 PATH 定位 `ffmpeg` 和 `ffprobe`；
2. 解析符号链接后，两者必须来自同一目录且为普通文件；
3. 先计算 SHA-256 并匹配 lock profile，再执行 `-version`；
4. 两者基础版本、configure flags、许可分类必须一致并等于锁定值；
5. 任一步超时、输出异常、hash/版本/许可不匹配都返回稳定错误码，不降级使用其他工具。

## 进程安全边界

- 始终使用 argv 数组和 `shell=False`，禁用标准输入；用户路径不能成为命令片段。
- 媒体输入必须是已解析的本地普通文件；拒绝 URL、设备、pipe 和不存在路径。
- ffprobe 显式设置 `-protocol_whitelist file`。官方协议文档说明默认协议集合很宽，白名单用于限制输入协议：
  <https://ffmpeg.org/ffmpeg-protocols.html>。
- 探测设置 64 MiB `probesize`、10 秒 `analyzeduration`、进程超时和 2 MiB 输出上限。
  FFmpeg 官方文档说明更大的探测窗口会提高信息发现率，但增加延迟：
  <https://ffmpeg.org/ffprobe-all.html>。
- ffprobe 使用 JSON writer、`-show_format`、`-show_streams`、`-show_frames`/受限 entries 和 `-bitexact`；
  外部 JSON 始终经过严格 schema 验证。官方说明 JSON writer 面向机器解析，并提供 bitexact 回归模式：
  <https://ffmpeg.org/ffprobe.html>。
- ffmpeg 后台命令必须带 `-nostdin` 和显式 `-n`/临时输出；官方文档说明 `-nostdin` 用于禁止交互：
  <https://ffmpeg.org/ffmpeg.html>。

## 黄金媒体矩阵

仓库中的短夹具目标为 160×90、约 2 秒，体积优先于画质。manifest 对每个文件记录 SHA-256、
生成命令模板、预期视频帧率、帧数、PTS/time base、音频采样率和样本数。

| 夹具                       | 视频         | 音频     | 目的                   |
| -------------------------- | ------------ | -------- | ---------------------- |
| `cfr-24000-1001-44100.mkv` | 24000/1001   | 44.1 kHz | NTSC film 与重采样     |
| `cfr-24-48000.mkv`         | 24/1         | 48 kHz   | 整数电影帧率           |
| `cfr-25-44100.mkv`         | 25/1         | 44.1 kHz | 首个交付 profile 候选  |
| `cfr-30000-1001-48000.mkv` | 30000/1001   | 48 kHz   | 29.97 NDF/DF 时间推进  |
| `vfr-pattern-44100.mkv`    | 显式交替 PTS | 44.1 kHz | VFR conform 与逐帧映射 |
| 运行时 Unicode/长路径副本  | 同源 hash    | 同源     | Windows/跨平台路径     |
| 运行时截断副本             | 损坏         | 损坏     | 超时/崩溃/错误隔离     |

源夹具使用 FFV1 + PCM，避免有损编码影响逐帧判断。CFR 代理使用 WebM VP9 + Opus、48 kHz；
FFmpeg `fps` filter 的官方语义是按需要复制或丢弃帧形成固定帧率：
<https://ffmpeg.org/ffmpeg-filters.html#fps>。

## 验收命令

```powershell
uv run pytest services/api/tests/test_media_toolchain.py --cov=aijian_api.media_toolchain --cov-branch --cov-fail-under=100
pnpm fixtures:media:verify
pnpm evidence:media-fixtures
pnpm evidence:check
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

## 成功条件

- 未锁定、版本不符、hash 不符、许可不符、超时和异常输出都有确定失败测试。
- 五个黄金源夹具和 manifest hash 入库；Unicode/长路径探测通过，损坏输入被拒绝且无残留进程。
- VFR 代理为选定 CFR，音频为 48 kHz；逐代理帧映射覆盖完整且与源 PTS 一致。
- 30 分钟等价长时样本边界用整数数学验证，首尾 A/V 偏差不超过一个 Sequence 帧。
- WebM 代理在实际 Chromium/Electron 媒体元素中到达 `canplay` 并可推进播放时间；静态文件存在不算播放成功。
- 所有证据重放后再校验 SHA-256；报告明确区分开发工具可用与发行许可可用。

## 不在 M02 的范围

- 不把 FFmpeg 二进制放入仓库或安装包；LGPL 可发行构建、对应源码包和 About/EULA 声明是发行工作流的阻断项。
- 不实现完整时间线命令、CAS、最终 1080p 导出或代理持久化 API；这些分别属于 M03/CAS01。
- 不把合成夹具的通过结果宣传为真实手机 VFR 素材或完整影片质量验收。
