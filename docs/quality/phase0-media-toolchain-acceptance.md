# Phase 0 M02 媒体工具链收尾验收

日期：2026-08-14

Backlog：M02 `media-fixtures`

基线：`f460f0a`，分支：`codex/m02-closeout`

规格：[Phase 0 FFmpeg 工具链与黄金媒体规格](../specs/phase0-ffmpeg-toolchain.md)

## 结论

M02 可作为后续时间线/成片工作的媒体基础继续使用，但只关闭媒体工具链本身，不扩展到 M03、CAS 或 K01。

仓库锁定 FFmpeg/ffprobe `8.1.2` 作为可重复基线；这不是“当前稳定版”声明。当前锁定 profile 是 Gyan full build GPL 开发构建，状态为 `DEV_GPL`，只能用于开发和证据生成。未来可打包状态必须使用独立的 `RELEASE_LGPL_REVIEWED` profile，并带 LGPL 构建、来源、源代码/配置和发行声明证据；未满足时默认拒绝发行打包。

## M02 成功条件复验表

| 条目                                                          | 状态     | 证据                                                                                                                                                                                    |
| ------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 未锁定、版本不符、hash 不符、许可不符、超时和异常输出确定失败 | 已证实   | `services/api/tests/test_media_toolchain.py` 26 项通过；`discover_media_toolchain` 先 hash 匹配 lock，再执行 `-version`。                                                               |
| `8.1.2` 可继续作为仓库可重复基线                              | 已证实   | `config/media-toolchain-lock.json` 固定 `expected_version=8.1.2` 与 ffmpeg/ffprobe SHA-256；文档不再称其为当前稳定版。                                                                  |
| `DEV_GPL` 与未来 `RELEASE_LGPL_REVIEWED` 语义分离             | 已证实   | `MediaToolchainProfileData` 拒绝 GPL profile 标成 `RELEASE_LGPL_REVIEWED`；发行打包守卫默认拒绝当前 `DEV_GPL`。                                                                         |
| 当前机器 `uv` 缺失不得静默降级                                | 环境阻塞 | `Get-Command uv` 无结果；未用 pnpm/uv 脚本伪造通过。可用 `python` 只跑了无需 uv 的专项测试。                                                                                            |
| PATH FFmpeg 可能与锁不符时不得静默降级                        | 环境阻塞 | PATH `ffmpeg.exe` SHA-256 为 `09948d4c...0f73`，锁期望 `ad8f211b...942e`；PATH `ffprobe.exe` SHA-256 为 `a6618e99...2be2`，锁期望 `9df3b0b5...5015`。真实工具链复跑应拒绝该 PATH pair。 |
| 五个黄金媒体夹具与 manifest hash 入库                         | 已证实   | `services/api/tests/fixtures/media/manifest.json` 与 `docs/quality/evidence/media-fixtures.json` 覆盖 24000/1001、24、25、30000/1001 和 VFR source。                                    |
| Unicode/长路径探测                                            | 已证实   | `media-fixtures.json` 记录 `unicodeLongPathProbe=true`，路径字符数 320。                                                                                                                |
| 损坏输入被拒绝且无残留进程                                    | 已证实   | `media-fixtures.json` 记录 `truncatedInputRejected=true`；探测命令使用 bounded process、stdin disabled、输出上限和超时。                                                                |
| VFR 转选定 CFR，代理音频为 48 kHz                             | 已证实   | `media-proxy.json` 记录 25 fps CFR proxy、`audioSampleRateHz=48000`、`mappingCoversEveryProxyFrame=true`。                                                                              |
| 逐代理帧映射覆盖完整且与源 PTS 一致                           | 已证实   | `media-proxy.json` 记录 64 个 proxy frame / 64 个 mapping entry，`mappedFramePixelsMatchSource=true`，非零源 PTS smoke 通过。                                                           |
| 30 分钟整数边界                                               | 已证实   | `services/api/tests/test_media_contracts.py` 使用 30000/1001 的 53,946 帧边界验证绝对有理数换算误差不超过半个 48 kHz 样本，并拒绝 JSON unsafe 结果。                                    |
| Electron/Chromium 媒体元素达到 `canplay` 并推进播放时间       | 已证实   | `docs/quality/evidence/media-playback-electron.json` 记录 `canPlayReached=true`、`playbackAdvanced=true`、`seekAndResumePassed=true`、hash 复核通过。                                   |
| 所有证据重放后再校验 SHA-256                                  | 环境阻塞 | `docs/quality/evidence/SHA256SUMS` 随本次语义字段更新已重算；但当前机器缺 `uv` 且 PATH FFmpeg 不匹配锁，不能复跑 `pnpm evidence:*`。                                                    |
| 发行包可携带 FFmpeg                                           | 发布阻塞 | 当前 profile 是 `DEV_GPL`。未提供 LGPL 构建、对应源码、构建配置、license notice、About/EULA 文案和发行审查记录，默认拒绝打包。                                                          |

## 本轮复验命令

```powershell
git merge-base HEAD f460f0a
Get-Command uv -ErrorAction SilentlyContinue
Get-Command ffmpeg, ffprobe
Get-FileHash -Algorithm SHA256 (Get-Command ffmpeg).Source
Get-FileHash -Algorithm SHA256 (Get-Command ffprobe).Source
python -m pytest services/api/tests/test_media_toolchain.py -q
python -m pytest services/api/tests/test_media_probe.py services/api/tests/test_media_proxy.py services/api/tests/test_media_fixtures.py services/api/tests/test_media_proxy_evidence.py -q
```

## 未复跑原因

```powershell
uv run pytest ...
pnpm fixtures:media:verify
pnpm evidence:media-fixtures
pnpm evidence:media-proxy
pnpm evidence:check
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

上述命令依赖当前机器可用的 `uv` 或锁定 FFmpeg profile。本机 `uv` 缺失，PATH FFmpeg/ffprobe 与锁定 SHA-256 不一致，因此必须标为环境阻塞，而不是降级到 PATH 工具继续生成新证据。
