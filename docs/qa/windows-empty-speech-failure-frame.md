# Windows 空对白失败的精确取证

已知 source `f960bbe` 的独立 Windows speech-window job 失败，公开安全注释仅到 `test_empty_spoken_text_has_no_synthetic_window_or_policy:354`。354 是测试定义行，不是失败断言，且参数被正确隐去。不能据此把 Windows 失败猜成 cap、静音样本、调用次数或生产状态。

本地精确执行原测试两参数，2 passed / 7.58s：`/tmp/windows-empty-speech-linux-repro.log`。没有修改生产、测试条件、17 项数量、超时、worker 或原完整质量门；Linux 通过不能代替 Windows。

新增诊断仅在标准 pytest `FAILURES` 段内，识别仓内 `services/api/tests/test_*.py:<line>:<closed Error kind>` 的实际 failure frame。canonical 源码文件及实际行号范围验证后，只输出相对文件、行号和固定异常类别；保留原测试定义定位以区分两者。段外、未知文件/行号、开放异常名和任意正文不输出。原六条上限、pytest 调用、原始 streams/exit 不变；定向 Windows workflow 无改动。

验证：

- 原诊断 + 新两项回归，`--self-test` 共 22 项通过（`/tmp/windows-empty-speech-frame-tests.log`）。
- 临时隔离真实 pytest 失败夹具 `/tmp/aivora-pytest-frame-probe-qb3mx5lp`：原始 stdout 含受控参数/断言标记，真实 child exit 1；注释准确给实际失败行 4 与函数定义行 3，均无参数、异常值和原始正文（`/tmp/windows-empty-speech-real-frame-probe.log`）。不是用模拟 FAIL 文本冒称真实 pytest 验证。
- 目标 ESLint/Prettier/Node 语法与 diff 检查随交付记录。真实 Windows 仍待下一独立定向结果；本片段不是业务修复。
