# 找回页面：作品设置的只读历史能力

正常 Chrome source a909 / run 42367161023 / job 128387526193 公开八条为 1280 两画幅四态，reached=1，均在 final forbidden 断言失败；不据此推断其余八组合。实际 Pro 受控 before `/tmp/recovery-history-controlled-before.log` 精确记录 `listFilmHistory` 一项。

原因是本审计装入 assembly 的完整桌面能力 stub。作品设置检测到 list/capture/restore 存在，真实 effect 会先读历史列表；旧 stub 将这次正常只读调用当成禁止派发。修复仅给 listFilmHistory 提供有界合成响应：必须是当前夹具确存且唯一的工程 ID，返回实际 LIST 合同的空 entries、unreadable=0，不制造备份、不写工程。capture/restore/verify 和生成/旧导出继续保原禁止状态，不是开放任意本机方法。

浏览器额外精确断言打开设置的历史调用序列：普通两态一次当前工程，切作品两态当前/另一工程各一次。原恢复/另存次数、未知禁重试、完整 raw/foreign 写次数、全部几何阈值和 16 态不变。

永久 actual-Pro Vitest 覆盖真实菜单→设置→找回、关闭重开；before 1 失败，最终 1/1 通过（`/tmp/recovery-history-host-final.log`），两次只读历史调用、零自动 recover/save、canonical 原样。全部 Node 契约 121/121（原 120 加一条只读列表 exact scope/无备份/零写负例，`/tmp/recovery-history-all-contracts-final.log`）。目标 ESLint、格式、Node syntax、diff 检查通过，workflow 完全未改。正常 Chrome 16 仍待根重跑；合成空历史不是用户机器历史检查、真实下载或试听证据。
