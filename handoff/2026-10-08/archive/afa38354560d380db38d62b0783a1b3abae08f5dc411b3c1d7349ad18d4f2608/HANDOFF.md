# DEV04 W1 TS RED 单文件修复交接（2026-09-29）

唯一写文件：`apps/studio-web/src/aivora/adapters/episodeMediaAssembly.ts`，作者树 `C:\Users\Administrator\.codex\worktrees\s2-q1-g1-d00-default-deny-59f-20260923\sp`。Git 状态仍为 `??`，没有写 c19、W0 或 QA 目录。

- 写前源 SHA-256：`3EA0FF966B45CB0850B25C558296B250B890F04AE0FC19A26AE6CFAA89044253`，8431 字节；与 W0 source-02 旧源一致。备份：同目录 `episodeMediaAssembly.ts.before`，8431 字节、同 SHA。
- 写后源 SHA-256：`66292488A83F6311CC454FD6F41302E6C9E088202032F7898E362DBDC489B04E`，8685 字节；同目录 `.after` 同 SHA，`.patch` 为 4323 字节、SHA-256 `6FCC79649DC89AF683BCB119FCA8C17263949F4DEB3EB8B8FCC6558CFC693677`。
- 旧 W1 原始 RED：`app tsc` 在旧源第 156 行报 TS18046/TS7006；node 第二步未跑。原 RED 证据保留，不覆盖。

根因：`data.media_checks` 来自未信任回执，虽然先判断了 `Array.isArray` 并逐元素检查，后续 nested callback 仍重新访问类型为 `unknown` 的字段，且回调参数没有稳定的元素类型。修复将原数组引用固定为局部 `rawMediaChecks`，逐元素经 `mediaCheck` 类型守卫验证后填入 `AssemblyVersion["media_checks"]` 局部；后续引用匹配与 `DRAFT_STATIC_ANIMATIC` 放行只读取这个局部。`for...of` 对稀疏槽位产生 `undefined`，守卫拒绝；非数组、畸形元素同样拒绝。原有 `VERIFIED`、权利非 `RESTRICTED` 和 DRAFT_STATIC 语义未放松。

QA 影响闭包：在新的隔离源码快照中先核该单文件 SHA，再分别审签 W0 与 W1。W1 按原顺序重跑 `app tsc`，通过后才跑原定 node 第二步，并记录原始 stdout/stderr、退出码、所用源码 SHA。W0 以同一新源 SHA 重新取件并独立审签，不能用 W1 结果替代。针对解析合同核有效媒体检查、非数组、畸形元素、稀疏数组、缺失媒体引用、非 VERIFIED、RESTRICTED 和非静帧 DRAFT_STATIC 负例。DEV04 按指令未运行 build、tests、provider 或可见 UI；静态 patch 核对不代表 TS GREEN。
