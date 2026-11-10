# desktop prepareSlots 接线

分支 `cursor/native-prepare-slots-wiring-7ab5`。base 是集成线 `grok/aivora-next-integration-20261109`（合入时 `35d86b52`）。本片只做整表冻结和公共中性标签。

`STORYFILM_CACHE` 槽里的 cache 消费还没有接。当前遇到无法核验的缓存会以既有 `CREATION_INPUT_UNVERIFIABLE` 失败关闭，不发 image/arm，零预算。后续片才能消费该槽，并且不得在核验失败后退化成重新生成。

`prepareSlots` 失败或冻结表缺槽时，已 register 的 execution 会 retire，避免留在后端旧兼容 arm 路径上。公共 `PREPARED` 仍只有 `CLIENT_IMAGES | STORYFILM_CACHE`。

真实 sidecar 用例仍是 `it.skipIf(!ffmpegOnPath())`。是否执行以该 HEAD 的 Ubuntu/Windows quality 日志为准，不改条件。

`77e0222e` 的两个 Windows quality 失败都不在本 PR diff 内，登记为未关闭的 Windows 时序问题，未修。push run `42792284324` job `129748457158`：`test_local_executor.py:404` heartbeat `assert False`（`renewed_past_original_expiry.wait(timeout=1)`）。PR run `42792293991` job `129748489309`：`film-audio-owner.test.ts:12` 5000ms 超时；同一测试在 push job 里 1127ms 通过。没有阶段行，不指定卡在哪一步。timeout、断言和 skip 都没有改。
