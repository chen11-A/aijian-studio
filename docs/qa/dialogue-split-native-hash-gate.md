# 拆镜哈希竞态测试的真实 native 完成边界

基线 `3a366cc`，仅修改拆镜宿主测试及本文，不改产品、5 秒上限、保存协议、raw/备份校验或 provider 路径。

新实际失败：source `2f`、run `42336888119` 的 Windows job `128295696476`，原 foreign retained-draft 哈希守卫用例整体 5000ms timeout。它等待 `v === retained` 的 hash gate，却仅以磁盘已出现八镜判断 native 完成。

受控真实因果：在原 history `withDialogueSplitBackup` 已写完结构后、返回给 native apply 之前留住 Promise。raw 已八镜，但同 factory 的 active 尚未释放；真实 `verifyBackup` 返回 `FAILED/BUSY`，产品正确保留 unknown 并在哈希保留稿之前返回。原测试继续等一个没有进入的 gate，复现原 **5000ms FAIL**。

证据是 `/tmp/split-hash-gate-controlled-before.log` 和 `/tmp/split-hash-gate-controlled-before.json`：固定阶段 `backup-gate-busy-before-draft-hash`，`nativePostWrite=true`、`retainedHashEntered=false`、`verifyBusy=true`。不把它写成已读到云端未公开的执行阶段。

修正保留两阶段：先证实 active 时 BUSY、unknown 不清、零重复 apply、尚未进入 retained hash；随后等本次实际 main producer Promise 返回 `APPLIED`（包括 finally 释放 active，而非丢失的 transport ACK），再明确点击核对、进入同一 retained hash，制造原工程新稿并切回同一 foreign 对象，验证最终同步 guard 保住新稿和 unknown。相邻 current-ref 哈希守卫及其他期待成功完整 delta 的回归，也使用本次真实 producer 终态后再核 raw；不是把“有八镜”当作全部完成。

原媒体、完整 raw、foreign 当前引用与零新增 foreign write、独立备份 proof 和零 provider 断言均保留。修后两条原哈希竞态通过：`/tmp/split-hash-gate-controlled-after.log`。最终目标与正式类型/静态结果随冻结交付记录；正常双平台 CI 尚待新候选。

冻结前：原两宿主含既有新增例共 **44 项通过**（`/tmp/split-hash-gate-host-final.log`），两条哈希竞态最终类型收口后再跑 **2 项通过**，不与 44 累加。正式 web `typecheck` exit 0（`/tmp/split-hash-gate-typecheck.log`），目标 ESLint、Prettier、diff check 均通过。未将阶段结果写成 Windows 全量或正常 Chrome 通过。
