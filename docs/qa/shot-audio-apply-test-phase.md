# 配声 apply 测试：独立媒体生命周期

root 在冻结 `4b77b677a71ba10f76fe335905c6101ecf56fdf7` 的原完整 `pnpm test:ts` 中得到 desktop 148 文件、2261 通过/1 失败。唯一失败为 `film-audio-library.test.ts` 的组合用例，明确 `Test timed out in 5000ms`，5050ms；没有产品行为断言失败。证据：`/tmp/aivora-shot-apply-root-full-ts.log` 第 60–75 行。原媒体 17/QC 11 通过不替代该失败。

该用例串行覆盖两项互不依赖的业务：第一套真实 fixture/suggest/pending apply/BUSY/settled；第二套新真实 fixture/suggest，加六种非法 exact 输入（错误指纹/清单仍执行真实计划前置）。两项各自需要 FFmpeg 与文件校验，原用例把它们放在同一默认 5 秒窗口。

## 阶段证据

临时只加固定阶段名/毫秒诊断，以及每个 fixture 175ms 受控 startup，保留真实工具/文件与业务断言。原组合例累计：first-ready 1057ms，busy-complete 2921ms，second-ready 3900ms，invalid-complete 4968ms，已紧贴原 5 秒。日志 `/tmp/shot-audio-apply-phase-combined.jsonl`、`/tmp/shot-audio-apply-combined-phase-controlled.log`。

相同 coverage 与受控 startup 下，拆分后 BUSY 生命周期 3296ms，独立 unsafe exact 生命周期 2113ms，两例业务断言通过，各自仍用原 5 秒。日志 `/tmp/shot-audio-apply-phase-split.jsonl`、`/tmp/shot-audio-apply-split-phase-controlled.log`。

这些 focus coverage 命令整体 exit 1，因为仅选择媒体用例没有覆盖 auth 模块，触发原全局覆盖率门；没有放宽/绕过门，也不把该诊断当完整 coverage 通过。175ms 和临时计时写文件均不进入提交。原完整覆盖门由总控在合入后复验。

## 最小修改

仅把组合用例拆成两个独立业务用例并准确命名。保留每条原断言、真实 fixture/FFmpeg/source/SHA、零 copy/write 检查，第一例 finally 仍 release 并 await pending，然后各自 afterEach 清自有资源。没有产品、timeout、workers、coverage、依赖或执行路径变更。

最终原文件 32 项通过，71.20 秒，日志 `/tmp/shot-audio-apply-split-final.log`。正式 desktop 类型、目标 ESLint、Prettier/diff 检查通过。没有调用真实会员或付费服务。
