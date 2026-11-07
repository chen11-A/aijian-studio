# 局部重做：派发许可测试里程碑

## 实际问题

Windows run `42315848425`、job `128228118703` 的 `film-range.test.ts` 迟到候选用例期望 `GENERATED`，实际为 `FAILED`。原夹具仅等待模拟 provider 被调用，而模拟函数第一步会 `await canDispatch()`。真实回调还要异步读 canonical 工程及复核原片/clean SHA，最后才设置已派发状态。因此函数被调用不代表通过付费派发门。在它完成前取消，生产代码正确拒绝派发。

Linux 受控复现：仅给原模拟函数在 `canDispatch()` 前增加 150ms 延迟，原断言复现 `FAILED`，1 失败、12 未选，日志 `/tmp/range-dispatch-old-milestone-repro.log`。该临时延迟没有进入提交。这个对照支持等待点存在竞态，并不替代后续真实 Windows CI 复验。

## 窄修正

仅修改测试，不修改生产门或接口：

- 正向用真实 `canDispatch()` 通过后的显式 admitted 信号等待。随后取消并编辑工程，模拟已付费候选迟到。仍检查完整候选保存、原版仍被选择、新标题不覆盖、源文件和候选 bytes 保留、禁止旧计划再拼回。
- 新增受控 pre-admission hold。先明确模拟函数已经进入，但尚未调用许可检查；取消后放行，真实检查必须拒绝。模拟付费派发计数为 0、`requestMayHaveRun=false`、canonical 工程与两媒体 bytes 不变、没有新增候选。
- 两条路径都在 finally 释放 hold 并 await pending，防失败后留下异步工作。提前结束只报告固定错误码，无路径、工程标识、SQL 或正文诊断。

沿用真实现有 FFmpeg 片段、历史备份、文件身份/SHA 和原 CAS。仅 provider 为本地替身，没有真实会员或付费调用。原 timeout、workers、cap、严重度和确认守卫均不变。

## 已执行

- frozen offline install：exit 0，`/tmp/range-dispatch-install.log`。
- 原 desktop range 整文件：14 项通过，24.64 秒，`/tmp/range-dispatch-final-tests.log`。保留真实拼接、帧率、音频、原片、来源及 QC 相关回归。
- 原 renderer 范围宿主与 action：2 文件 13 项通过，8.93 秒，`/tmp/range-dispatch-web-regressions.log`。
- 正式 desktop 类型检查、目标 ESLint、Prettier 和 diff 检查通过。

本机为 Linux；正常 Windows CI 尚待复验，不声称真实付费链已调用。
