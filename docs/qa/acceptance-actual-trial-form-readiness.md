# 实际试片审核表单的异步就绪观察

基线 `de2cb0629e4934ae9bbfd09e2da6f77a772cb97c`，独立分支 `codex/aivora-acceptance-trial-wait`。没有合入独立 auto-source 检查点939b4c9，也不改产品或root验收树。

## 真实失败与原因边界

CI run42415135411 / Linux job128531463916：原 `ProWorkspace.actual-risk-trial.test.tsx:466` 两个参数 `videoPath` / `cleanVideoPath` 的即时 enabled 断言失败。准确按钮是“保存本次人工决定”，不是继续按钮。本地原两目标 `/tmp/acceptance-trial-wait-before.log` 为2通过/5未选，没有把本地通过冒作复现云端失败。

旧 `review()` 仅等时长文字；组件可交互性另依赖 busy/stale/pending，disabled fieldset 早点击不会选择决定。生产 hook 完成实际 prepare/save-lease 与 readMedia 后才建立Blob/ready并结束busy；测试应等实际可交互边界，而不把文字出现等同于可以点击。此片不推测未观测到的具体CI调度点，不改busy保护。

## 纯测试修复

- helper保留原2.25秒文字，额外观察 dialog aria-busy=false、实际video已挂载、原radio/checkbox可用，再进行原明确点击。两参数原 enabled、Blob撤销、0record/check/provider、完整原媒体及原超时断言保留。
- 记录后继续按钮同样按真实挂载和 enabled 等待，仍原一次check、主检查REVIEW_STALE及0provider。
- 永久受控宿主用真实native media读取与文件/原保存队列，只延迟回执交付：pending时busy=true且没有可选/保存表单，队列可flush；实际回执交付后，未决定不可保存，只选“接受”仍不可保存，明确人工checkbox后才enabled。0record/check/provider且各prepare/mediaRead恰一次。不注入React state，不证明真实codec播放或人工观看。

## 本次验证

- `/tmp/acceptance-trial-wait-file.log`：整文件8项通过 / 5.34秒，exit0；原7项全部运行。
- `/tmp/acceptance-trial-wait-types.log`：正式web `tsc -b` exit0。
- `/tmp/acceptance-trial-wait-eslint.log`、`...-prettier.log`：owned ESLint/Prettier exit0，diff0。
- 没有增加原超时、skip或放宽阈值；没有运行完整web。修后完整web/新CI由root验收，不提前称云端问题已闭环。
