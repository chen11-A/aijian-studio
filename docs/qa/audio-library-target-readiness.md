# 本地声音目录：初次时长核对诊断

基线 `5ebe8c5`。正常沙箱 Chrome 的 run `42321038556`、job `128245386950` 中，1920 两画幅的 catalog/add-remove/unknown-recovery 共六态在等待“当前版本已核对：2.25 秒。”失败。1280 及受控 target-guard 未报同错。尚不能由此认定时钟、保存或界面守卫的具体故障。

本补丁只补可观测证据，不改产品、等待条件、四态十六组合、几何阈值、目标时钟和派发次数：

- 原 inspect 回包同步记录固定 `TARGET/PROJECT_CHANGED/SOURCE_UNVERIFIED/BUSY/PENDING` 分类，不加 await，不改变准入或返回结果。
- 失败时把实际对话框状态归为封闭枚举，另记录匹配/调用/写入/试听核对/本地合成次数。公开注释再按枚举与 `0..1000` 整数过滤，最多仍八条；不输出 DOM、正文、路径、身份、哈希、原始错误或堆栈。
- `TARGET` 但界面空态、零 inspect 的保存失败、实际 CAS 不匹配将可区分。完整正常 Chrome 结果待下一 CI，本机没有绕过浏览器沙箱运行正向。

源码排除：当前合成桥受控拒绝，本地合成失败只发提示；编辑页播放器元数据只更新局部播放时长。两者本身不是已证明的 filmRef 改写原因，未据此放宽任何保护。

验证：`node --test apps/studio-web/e2e/pro-audio-library-fixture.contract.mjs` 十项通过，包括默认准入/原 ABI 和恶意正文、路径、凭据标记的注释安全检查；目标 ESLint、Node 语法、Prettier 与 `git diff --check` 通过。此为诊断交付，不是问题已修复或十六态新正向通过。
