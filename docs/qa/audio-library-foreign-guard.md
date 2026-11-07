# 素材回包：跨作品保留稿的最终同步守卫

基线 dev `d02d2fc`。仅修原单资源添加/核对的共享 `settle`，不含批量组 UI、不改原单条追加证明、native/DTO、保存队列或退出协议。

原路径在 foreign 保留稿与写前稿内容相等时，先异步算 hash，再直接 `external.confirm(saved)` 并返回可清除 pending 的 `stale`。hash 等待期间若回到原作品，真实 confirm 会拒绝但调用方忽略 false；若编辑原稿后又回到同一个 foreign ref，则旧 ref 检查也无法发现新的保留稿。前者可能失去可核对入口，后者可能清掉新稿的保留状态。

新增两项通过公开 `addLibraryAsset`、真实 `createFilmPersistence`、受控 native ADDED 与微任务调度复现；两个 before 均失败（实际 stale，预期 unknown），日志 `/tmp/audio-library-foreign-guard-before.log`。这是保存生命周期/调度验证，不是 Chrome 用户点击、真实文件复制或试听证据。

修复在 hash 后重新读取 retained draft，在最终无 await 段同时核对当前 live ref、原作品实际 external draft 的引用版本及 confirm 返回值。失败保留 unknown 和原 pending；正常 rebase 仅允许本 lease 生成的那个确切合并稿引用，不能借此接受任意新稿。成功确认与清 pending 之间不再插入 await；跨作品新稿不被旧回包覆盖。

验证：五文件 42 项通过（新增 single 两项、原真实 Pro 手动库 19 项、原 external/quit 队列与退出宿主），日志 `/tmp/audio-library-foreign-guard-after.log`；正式 web `typecheck`（`tsc -b`）、目标 ESLint、Prettier 与 diff 检查通过。没有调整超时、重试、门槛或删除原断言。
