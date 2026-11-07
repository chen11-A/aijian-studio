# 验收：字段历史测试的初始checkpoint

基147aad4的独立验收分支。只改 `ProWorkspace.history.test.tsx` 与本说明，不改产品/消息、时限、历史算法或阈值。

## 真实失败分支

旧01db CI run42418376360 / Linux job128541288205：`does not announce success when every field conflicts` 期望“内容后来改过，这次没有覆盖。”，实际“这次改动不能安全撤销，已保留当前内容。”。后者只在 movePageHistory 的 committed/live前置比较不等、随后pageHistory.record返回conflicts时产生并直接返回；因此该次尚未进入原预seed receipt的undo字段冲突分支，不能改预期消息掩盖不同动作。

打开工程先把hydrate结果置为committed，再setFilm执行现有continuity/waveform派生，原500ms guarded checkpoint才提交实际当前baseline。旧helper仅等“这一场”label，两个用例用550ms固定睡眠，而all-conflict在open前先seed旧receipt并立即undo，初始化边界不一致。

`/tmp/acceptance-history-original.log` 原小文件本地4通过；没有把本地通过冒充重现旧CI。这里以实际CI消息对应的唯一源码分支作为机制证据，不假称已确定更细调度顺序。

## 最小纯测试修复

统一open只旁观原 `historyCheckpoint` 返回的真实timer callback：先调用原callback，只有其自身全部current/selection守卫通过并返回true后才通知测试就绪。保原500ms、不手调回调、不伪造true、不调用private commit。随后才执行用户动作或seed有意较旧的receipt。

移除两处550ms睡眠；all-conflict改为真实初始checkpoint完成后seed，仍断record成功、原完整正文、精确冲突消息及canUndo。原partial undo/redo原子冲突、redo可用性、私人内容不进入notice、实际持久化检查全保。

## 实测

- `/tmp/acceptance-history-final.log`：完整小文件4项 + 原history-checkpoint守卫4项，两文件8通过 / 5.59秒，exit0。原new-film/new-page/new-shot过期回调拒绝及合法callback提交全部运行。
- `/tmp/acceptance-history-types.log` 正式web类型；`...-eslint.log`、`...-prettier.log` owned静态/格式及diff0。
- 未跑完整web或额外native/API/installer；新CI由root验收，不提前称远端已闭环。
