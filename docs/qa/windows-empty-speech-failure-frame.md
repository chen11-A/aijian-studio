# Windows 空对白失败的精确取证

已知 source `f960bbe` 的独立 Windows speech-window job 失败，公开安全注释仅到 `test_empty_spoken_text_has_no_synthetic_window_or_policy:354`。354 是测试定义行，不是失败断言，且参数被正确隐去。不能据此把 Windows 失败猜成 cap、静音样本、调用次数或生产状态。

本地精确执行原测试两参数，2 passed / 7.58s：`/tmp/windows-empty-speech-linux-repro.log`。没有修改生产、测试条件、17 项数量、超时、worker 或原完整质量门；Linux 通过不能代替 Windows。

新增诊断仅在标准 pytest `FAILURES` 段内，识别仓内 `services/api/tests/test_*.py:<line>:<closed Error kind>` 的实际 failure frame。canonical 源码文件及实际行号范围验证后，只输出相对文件、行号和固定异常类别；保留原测试定义定位以区分两者。段外、未知文件/行号、开放异常名和任意正文不输出。原六条上限、pytest 调用、原始 streams/exit 不变；定向 Windows workflow 无改动。

验证：

- 原诊断 + 新两项回归，`--self-test` 共 22 项通过（`/tmp/windows-empty-speech-frame-tests.log`）。
- 临时隔离真实 pytest 失败夹具 `/tmp/aivora-pytest-frame-probe-qb3mx5lp`：原始 stdout 含受控参数/断言标记，真实 child exit 1；注释准确给实际失败行 4 与函数定义行 3，均无参数、异常值和原始正文（`/tmp/windows-empty-speech-real-frame-probe.log`）。不是用模拟 FAIL 文本冒称真实 pytest 验证。
- 目标 ESLint/Prettier/Node 语法与 diff 检查随交付记录。真实 Windows 仍待下一独立定向结果；本片段不是业务修复。

## 已取得实际失败断言，继续物理数据取证

独立 Windows source `b1f0dff` 的安全 frame 已确认原第 395 行：最终 voice WAV 的 `assert not any(...)` 失败；此前成功状态、无 speech_window、三次 transport 断言已先通过。仍不知道参数或非零幅度，不能直接称 dither、改阈值或放松 any。

后续只加该原测试的透明本机取证：原 `_silent_wav` 返回后与原 `_ffmpeg` 的已完成 loudnorm/fit 阶段只读有界 PCM，未知格式不输出；原参数、返回、媒体处理、三次 transport 与 any 条件不变。只有最终 any 失败才输出首个非零阶段、final、silent 控制的固定格式数值，最多三条。字段只含 schema、referenced 布尔、封闭 stage/ordinal、rate/channels/width/samples/nonzero/peakAbs/RMS；不输出路径、PCM、异常或文字。诊断解析严格拒绝未知字段/阶段/格式、秘密字符串、NaN/无穷和物理界外值，原六条注释总上限不变。

- 带透明取证的原两个参数仍通过，完整文件仍只收集原 17 项；这是 Linux 行为不变证据，尚无新的 Windows 幅度证据。
- 原 self-test 加数值白名单回归共 24 项通过。独立标准库 PCM 夹具 `[0,1,-2,1]` 真测得 samples=4/nonzero=3/peakAbs=2/RMS=1.224745，验证统计计算；不是实际 Windows 数据。
- 临时真实 pytest 失败 stdout 经同包装，六条安全注释同时保住实际 frame、首个非零和 final 数值，真实 child exit 1，受控 PRIVATE 参数/断言仅在原 stdout，不进入注释（`/tmp/windows-empty-speech-real-pcm-probe.log`）。Windows 数值仍待下一快门，未修改生产或声称根因已修。
