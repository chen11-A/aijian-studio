# Python CI 的受限测试节点定位

本片段只改善失败注释，不修猜测的 Windows 产品问题。旧 source 539 的公开 Windows 页面只能定位到 `test_story_speech_window.py`，完整失败断言仍不可读；Linux 同源成功不能代替 Windows。

保持原 `pnpm test`、pytest 调用、覆盖门、输出字节和返回码。仍最多六条安全注释。新增只识别标准 `FAILED services/api/tests/test_*.py::test_*`：在本仓 canonical 根内的真实源码顶层 `def`/`async def` 声明白名单中找到后，输出相对文件、声明测试名和行号；参数 ID、异常、断言值、正文和绝对路径不进入注释。类方法、子目录及未知名称继续只显示原文件定位，不猜测。源码读取限定普通文件且不超过 1 MiB，越界目录别名/链接拒绝。

验证命令：

- `node --test scripts/ci-test-diagnostics.test.mjs`：原 15 项和新 4 项，共 19 项通过；包括真实 child exit 0/7/17/29、stdout/stderr 不变，旧调用及别名 launcher、六条上限、真实本仓 Python 声明、伪造名称、参数/异常秘密、越界/目录 junction 与过大文件。
- 原 `--self-test` 包装、目标 ESLint、Prettier、Node 语法检查和 `git diff --check` 按交付日志核验。

没有修改生产 API、speech-window 策略、测试断言、全局 timeout/workers 或依赖锁。真实 Windows 失败根因仍待新的精确注释；本地脚本通过不能称 Windows 全质量通过。

## 独立 Windows 快速定向

后续窄提交在 workflow 末尾追加 `speech-window (windows, targeted)`，原 workflow 全部字节前缀保持不变。复用既有 Node 24.15、Python 3.12、uv frozen、`ci_media_tools.py` 的原固定 Windows 工具 pin；无需安装全部 JavaScript 依赖。原完整 quality/pytest/覆盖门仍运行，独立定向成功不等于 Windows 全质量成功。

新固定 CLI `--speech-window-test` 只执行 `uv run pytest services/api/tests/test_story_speech_window.py`，拒绝额外参数；同 `shell:false` 包装保留真实 streams/exit 与受限注释。20 分钟仅为这个独立 CI job 的上限，没有修改原单测超时或 worker。

- 原 `--self-test` 20 项通过（原 19 + 新真实 CLI 子进程边界回归）：实际转发固定 uv/pytest argv，成功 0、失败 23 和额外参数拒绝，私有参数不进注释。
- 本地真实 uv/pytest 通过新 CLI 仅做 `PYTEST_ADDOPTS='--collect-only -q'`，17 项收集 exit 0（`/tmp/python-targeted-job-real-collect.log`）。没有把 collect-only 称为媒体测试通过；Windows 定向实际结果待 CI。
