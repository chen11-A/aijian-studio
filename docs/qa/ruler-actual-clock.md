# 聚焦标尺的真实秒步进

基线 `96d5bfc` 的真实 Pro 受控复现：原 assembly 宿主夹具计划每镜 99 秒、main 返回实际两镜 2 秒和 1 秒。实际 artifact 已采用、标尺获得焦点后按 ArrowRight，期望 1 秒，实际 `0.020202…` 秒。`/tmp/ruler-clock-before.log` 记录 1 项失败/9 项未选；没有增加时限或付费调用。

原因是标尺已用 native actual headSeconds，却再次经 `xAtSeconds` 计划坐标与 `seekTo` 的实际时钟换算。`ProWorkspace.tsx` 的标尺键盘分支现仅改为委托原 `goTo(to)`：与既有 transport 同一秒语义、原边界钳制与选择逻辑；非 native/未 joined 沿原计划 fallback。native 无 session clock 时仅保原整片逐秒 seek，不推断按镜映射，原镜跳/I/O 仍拒绝。

永久真实 Pro 回归覆盖聚焦标尺的左右、跨切点、Home/End、两端钳制、Shift 步进；原生事件 defaultPrevented 且精确秒数证明没有向全局 handler 双跳；旧 shot/媒体原样、一次初始 assembly、零取消/额外 assembly/provider。另一例覆盖无 cache 可逐秒 seek但不能按镜跳/标范围。只控制 DOM metadata 与事件，不创建虚假 session clock，不改 currentTime getter，不冒称真实解码或播放。

验证：原 assembly 文件 11/11（`/tmp/ruler-clock-after-final.log`）；原 5-3-08/09/10 三项通过、138 未选（`/tmp/ruler-clock-original-keys.log`）；原时间线 19/19（`/tmp/ruler-clock-timeline.log`）。类型、构建、目标 ESLint/Prettier/diff 均通过。初次新无 cache 用例用了全页单一文本查询，因既有提示与状态栏同文触发重复元素；已改验实际 `.status-note`，保拒绝和未创建选区断言，产品未为该用例改门。jsdom pause 未实现提示保留；正常 Chrome 后续独立 legacy 专项，Windows/人工播放仍未验。
