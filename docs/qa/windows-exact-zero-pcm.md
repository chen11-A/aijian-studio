# Windows 全零旁白被动态 loudnorm 变为满幅的窄修

实际证据来自 source `463a8b1` 的 Windows 定向 run `42333496541` / job `128285089813`：两种原测试参数均失败于最终 PCM 非零的原 any 断言。原始 silent#1 是 16k/mono/s16、3200 samples、nonzero=0/peakAbs=0/RMS=0；首个异常 loudnorm#2 为 48k/stereo/s16、19200 samples 全部非零、peakAbs=32768/RMS=32768。signed16 只有 −32768 能达到这个绝对峰值，属于满幅 DC，不是细小 dither。final 为 19200 个异常样本加尾部静音，短片 samples=199680/RMS=10160.925458，带参考 samples=967680/RMS=4615.669103。未据此声称知道 FFmpeg 构建内部具体浮点机制。

修复只在 `_normalize_film_media` 原声音格式/时钟转换前，流式识别完整真实 signed16 PCM WAV 的精确全零。普通文件、PCM 格式、正帧数、完整数据、80MiB 上限及读前后同一 fd 身份/大小/mtime 均核对；任何一个非零位、截断/空数据、未知格式均不认作静音。确证全零时仅将响度滤镜换成 anull，保留原 48k/stereo/pcm_s16le 转换、完整时长和原 fit/pad/cap。不会以 measurement=None 判断静音：短/低声/MP3 等仍走原响度政策。

不修改原 any 断言、speech-window 标记、模型 cap、缓存 key、原始供应商视频/配音、旧 artifact/proof/恢复或幂等回执。没有额外 TTS/video 调用；旧媒体不会被后台重写。透明失败数值诊断仍保留，真实 Windows 正向结果待新 CI。

验证：

- 新 5 项与原 speech-window 17 项联合：22 passed / 68.78s（`/tmp/silent-pcm-fix-window-tests.log`）。原 17 项原样保留，涵盖两种空对白、真实 cap/decoded frames、原 raw/cache、无额外 TTS/video、每镜留白与聚合。
- 原 MP3 伪 WAV、低声旁白响度/完整性、过短时长不截对白：另 3 passed / 7.56s（`/tmp/silent-pcm-fix-spoken-regressions.log`），与上面分别计数。
- 故障对照通过真实 FFmpeg 注入双声道 −1 重现 observed PCM：旧决策路径造成19200样本/peakAbs32768/RMS32768，fit后精确199680样本/19200非零/RMS10160.925458；新精确零分支不调用 measurement/loudnorm，输出仍逐样本为零。最后补核数值断言的新5项通过 / 4.20s，日志 `/tmp/silent-pcm-fix-final-physical-tests.log`（属上面22的子集，不累加）。
- 精确检测扫描末块中的一个 −1 LSB 仍判非零；unsigned8、截断、空/未知文件不被提升为静音；原 raw/provider bytes 保留。
- 正式 `pnpm typecheck:py` 按仓库 Python 3.12 配置 exit 0，313 source files（`/tmp/silent-pcm-fix-formal-mypy.log`）；目标 Ruff check/format、QA Prettier 和 diff 均 exit 0。一次误指定 Python3.10 的附加命令遇既有3.12语法，未计为有效仓库验证。

这是本机确定全零输入的处理修复，没有放宽原质量/覆盖阈值，也没有付费/供应商实测。Linux 定向通过不能替代 Windows 全质量通过。
