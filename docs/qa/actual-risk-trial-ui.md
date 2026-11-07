# 实际版本试片审核 UI

本片实际合入稳定合同 `f65b703`、producer `1758d4b` 与当前修复源 `6c5eee3`；独立树 `aivora-actual-risk-trial-ui`。没有修改 API/native producer、自动生产供应商提示、请求数量或原手工继续入口。

## 实际入口与人工边界

剪辑页属性区“审核实际版本试片”进入真实 Pro dialog；单镜画面说明助手也复用该工具。默认不调用试片四桥，只有用户打开才短暂取得原保存队列、完成真实 write receipt/readback 校验，并释放 owner，再请求 main prepare/media。播放事件、ended、main READY、旧人工记录都不代替本次选择；接受还须用户明确勾选人工核对。没有自动记录或自动继续。

说明按原文保存，空串允许；长度按实际 JS UTF-16 `.length` 上限500，超限保留全文并禁止记录，不 trim/截断。媒体读取有80MiB有界检查，返回 bytes 生成临时 Blob URL；关闭、换范围、过期和卸载撤销本组件的 URL，不写入作品。实际源/时长、标签与 limitations 来自主进程；素材读取或浏览器播放失败分别说明，不称已完整观看、试听、技术验收或最终混音通过。

只有本次完整核对保存且仍有效的 accepted 事实，才在 dialog 显示原 `PipelineSteps` checkpoint，使用原完整范围/数量/会员额度说明和原 canContinue 门。显式继续进入 controls 的项目/当前 checkpoint/单忙门，再走现 `continueAfterTrial` 和 main 全范围、逐目标检查。原外部手工继续不变；`batchShotCount` 只是所绑定范围，不是新增视频数、价格或费用许可。needs-changes、旧记录、未知或已失验事实不显示受控继续。

## 保存、未知与迟到

- 复用原 B07 receipt-checked checkpoint，仅导出该原函数、缩窄其需要的 host 类型，保存引擎/队列/锁不另建。正常人工查看不长期持 owner，不阻碍原 quit 保存。
- native record 只显式一次。完整 canonical 必须只追加一个匹配本次意图的人工事实，原决定顺序/全项目非保存时间字段/所有镜头与媒体不变；全局决定ID唯一、完整绑定摘要仅作完整性检查，不授予继续权限。不得把 raw 再 upgrade 而悄悄改动其它镜头。
- 丢 ACK、BUSY、非法输入或传输失败保留原 external unknown 和全局待核对入口，退出沿原未知保护，不重发 record。合法已知 scope 的 main prepare 同factory gate与两次 fresh raw 是完成核对条件；未知不靠定时器、路径存在或单独 rtd/binding 解锁。
- fresh READY.existingDecision 完整匹配才显示有效人工记录。若完整事实确已写入但实际源已不能核实，最多说明“人工决定已记录，试片需重新核对”，不能据此继续。确证未写必须两次完整原 raw 相同且有合法 post-gate 回执；INVALID_INPUT/泛错误不是完成证明。
- 所有 hash await 后同步复核 current 与 retained-draft 引用，apply/confirm 同步收尾且检查 confirm 返回。页面/作品变化后的写结果先登记账，再丢旧 UI；晚编辑不被旧快照覆盖。冲突保留两份并可查看安全文字备忘，显式采用保存版仍 fresh 重新核对。核对结果在全局面板明确可见。
- native 已确认后，仅 release 保存后来的新编辑失败时，保留普通保存失败/原 quit 失败，不制造无 external 的假 unknown，不自动重加。

## 文件与验证

Owned：`ActualRiskTrialReview.tsx/.css/.test.tsx`、`use-actual-risk-trial.tsx`、`actions/actual-risk-trial.ts/.test.ts`、`actions/actual-risk-trial-record.ts`、`actions/dialogue-split-native.ts` 的上述导出、`ProWorkspace.tsx` 接线及新 `ProWorkspace.actual-risk-trial.test.tsx`、`pipeline-controls.ts/.test.ts`、本文。

同源联合 **15文件161项通过**：`/tmp/actual-risk-trial-final-joint.log`。包括新 actual Pro5、actions17、view6、controls9，以及原 B07、原queue/quit/manual库/history、原只读候选、pipeline宿主和架构规则。此为一次联合计数，不与此前37等阶段相加。随后仅补 unknown 核对终态显示，实际Pro5再验见 `/tmp/actual-risk-trial-feedback-host.log`。

真实 Pro 跨层测试走 main factory、临时文件、原 persistence 队列与 canonical read/write；本片媒体 probe 受控，文件 bytes 并非真实编码验收，不声称 FFmpeg/codec/听感/人眼完整观看已通过。测试覆盖默认四桥0调用、原文needs-changes保存、真main仍active时BUSY保未知、producer完成后global fresh恢复、关闭晚读、保存失败0prepare、接受/ended不继续，以及同路径实际视频 bytes 改变后显式继续被真实main拒绝、0provider与原媒体保留。actions还锁住两种hash微任务、confirm false、真实释放阶段新稿保存失败与非授权错误不能解锁。

正式 `tsc -b`/web build 和目标静态以本树最终日志为准。原完整覆盖率门由 root 在冻结联合源运行，不预先排除任何生产源码；跨workspace main源码由实际测试读取不等于可以降低原90门。本片尚无新增正常 Chrome 试片专项/实际 Electron 播放或真实会员费用证据；后续独立门需保原所有矩阵和几何，并明确合成 IPC 边界。

## 同版本换源的 UI 退休

root审阅确认中立 `riskTrialTarget` 特意不含 takes，旧本地 key 因而不足以识别同takeId换源。本片另在本地 key 绑定仅所选试片的 id/shotId/status/videoPath/cleanVideoPath/index/prompt/createdAt，和 main 的实际所选源/版本消费对齐；不渲染路径或持久化 key，不据此授信，也不误伤其他独立目标的普通输出。savedAt/directory保存元数据仍不触发失效。同路径外部bytes变化没有文件watch，仍由main record/check真实重核，不能冒称 UI 后台监控全部文件。

实际Pro旧key的两条videoPath/cleanVideoPath回归均失败，保留 `/tmp/actual-trial-source-key-before.log`。补后立即退休旧Blob、撤销objectURL、隐藏旧表单且0record/check/provider；版本字段变化和独立目标输出/保存元数据对照同测。四目标最终 **40项通过**：`/tmp/actual-trial-source-key-after.log`，取代前37对应目标快照而不相加；原161联合仍按此前来源记录。
