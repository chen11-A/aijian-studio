# 声音组跨作品核对：等待真实预览与保存就绪

正常 Chrome `run42330600537/job128276000841` 的四个 `audio-groups-unknown` 组合在完整另一集 raw 相等后，写入次数不变断言失败（当时第 342 行）。这与先前完整 renderer 的 `continuity` 初始化差异不同。

使用同一合成 ABI、真实 Pro 作品菜单与保存队列复现，受控暂停另一集真实混音预览的回包。闭合调用来源跟踪表明：另一集 current 引用和 edit 阶段均不变；波形 hook 在读前/读后先保存两次，旧 baseline 紧随其后；80ms 正常混音预览再经原队列保存一次。第三次发生在原作品 recovery lease 准入之前，不是核对写了另一集。

- `/tmp/audio-groups-readiness-controlled-before.log`：旧就绪判断可复现 `2 → 3` 写入次数，1 项失败。
- `/tmp/audio-groups-readiness-controlled-after.log`：等待另一集实际预览回执、可见“重试音轨试听”和“刷新音频波形”、页脚正常保存完成后取完整 baseline，1 项通过，原作品恢复前后另一集 `4 → 4`，恢复不增写。
- 临时真实宿主 probe 已移出仓库，仅保留 `/tmp/audio-groups-readiness-probe-{before,after}.tsx` 与受控日志，不纳入产品或常规测试。

QA fixture 只登记通过原 hash 验证且已经完成的 mix 回执，不改变现返回值、默认模式、保存次数、当前作品选择或调用流程。浏览器仍保留完整 raw 与精确写入计数、原组完整恢复、另一集可见标题、一次 add、零付费和所有几何断言；没有 sleep、强制 flush、调超时或忽略字段。

新增 Node 契约验证默认 wrapper 的完成回执与 hash 拒绝，旧 profile 保持原样。此次是 QA 就绪修正，正常 Chrome 四组合后证仍待 CI；jsdom 受控结果不算像素或真实媒体试听通过。
