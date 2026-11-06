# Windows 媒体回归：夹具身份与异步入口

依据 dev `1917e85` 的 Windows run `42308175970` / job `128202728640` 的实际失败注释修复测试，不改产品、来源归属、SHA、QC 严重度、全局 timeout/workers 或供应商调用。本机为 Linux；以下结果不是 Windows CI 已恢复的声明。

## target 源替换

原注入条件 `path === source && count === 2` 将路径字符串当文件身份。生产 resolver 使用真实 canonical 路径，夹具使用临时目录输入路径，目录别名可使两个字符串不同而指向同一文件。注入没有发生时返回 TARGET 是合理结果，不能据此认定最终 SHA 复核失效。

保留旧条件，仅增加真实目录 alias 的前后对照：原 native/clean 两项通过，alias native/clean 两项均报“期望 PROJECT_CHANGED，实际 TARGET”。日志 `/tmp/windows-target-alias-before.log`，预期 exit 1，2 passed / 2 failed / 8 skipped。最终夹具在 POSIX 使用 symlink、Windows 使用 junction；匹配 BigInt dev/ino，并核真实 bytes，保留实际 FFmpeg 替换。

最终四项均明确要求：命中恰一次、原/替换 SHA 确实不同、alias 确实造成不同路径字符串、duration 和工程 JSON 不变而实际结果必须 PROJECT_CHANGED。没有 lower-case 路径或比较同一 API 的字符串来替代文件身份。

## QC prepare 入口

原 `vi.waitFor` 默认 1 秒等待 release 变量没有证明 engine 是否真正进入，也无法区分准备早退和仍在 I/O。改为 engine 入口显式 started Promise，与 pending 早退结果竞争，仍受原外层 30 秒测试上限约束。早退仅输出固定 QC code 的安全注释；finally 释放 gate、await pending 并 dispose。

保留重复 prepare 为 BUSY、迟到工程修改拒绝、临时文件清理、已 dispose receipt 不可发布等全部断言。增加 1200ms 的受控 engine startup，与原 0ms 情况执行相同真实链路，未提高上限。实际 Windows 原失败究竟是否早退，仍以下轮注释为准。

## clean recovery 5 秒失败仍待 Windows 复验

`rejects invalid final owner/path/sha/assembly` 使用小文件和 SQLite，不调用 FFmpeg 工具链。独立本机四项实际约 66/30/46/86ms，未复现 Windows 的 5 秒超时，不能据此猜测磁盘慢、提高 timeout 或修改恢复产品逻辑。原 5 秒和 owner/path/SHA/assembly、原文件不变等断言保持。

只在该类失败时增加固定阶段名与有界耗时注释：fixture directory/media/database/project、restore source、remake、edit/verify evidence、record/original verification。最多 16 条已完成阶段，时长上限 3,600,000ms；不输出路径、工程 ID、SQL、文本或异常内容。临时真实失败 probe 验证了该注释，预期 exit 1，且检查输出不含路径/ID/SQL；`/tmp/windows-clean-diagnostic-probe.log`，probe 文件已删除。正常通过时不产生错误注释。

## 最终本机检查

- 三个实际测试文件联合：44 passed，41.11 秒，exit 0，日志 `/tmp/windows-media-regression-final-tests.log`。包括原完整 clean recovery、原 QC 的所有断言及新增路径别名/受控启动延迟。
- 正式 desktop TypeScript、目标 ESLint/Prettier、`git diff --check`：通过。
- 未重跑不相关全仓、未删旧 case、未修改生产源码/全局门；Windows 原生下一 run 仍需确认，尤其 clean recovery 超时现在只有诊断而非已证实修复。
