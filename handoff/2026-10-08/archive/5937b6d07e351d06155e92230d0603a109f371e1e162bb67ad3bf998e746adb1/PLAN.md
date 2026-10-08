# LAYOUT07 焦点能力探针与第二次送审门槛

状态：修订后的静态方案。前两次焦点探针分别在 PS5.1 数值转换和窗口可见时序门停止；均未调用 focus，也未进行来源动作。修订后的探针尚未启动；第二次送审尚未授权。

## 已有证据

第一次 LAYOUT07 短剧尝试在原生发送前停止。原生回执记录前台 HWND 262296、AIVORA 原生对话框 HWND 723076，`native_action_attempted=false`、`send=null`。12 次权威 bridge GET 的 `review_version_id`、`review_submission_id` 均为空。关闭后签名的 27 个产品文件、6 个 QA 文件和 73 个 dist 文件无漂移。

稍后的只读采样将同一 HWND 262296 映射到 VMware Workstation（PID 9656，session 1，Default 桌面）；句柄可能销毁或复用，不能据此确定第一次尝试瞬间的窗口所有者。原生回执缺少当时前台窗口的 PID、类名、标题和桌面。

第一次证据：[首轮总清单](../evidence/m1-layout07-native-submit-20260924T040958Z/first-round-review.json)。第一次 snapshot-key ledger 保留原样，SHA256 为 `8C2F15CFC225421736E52C4D4AD4060BA81BE5295F3686D634BD420D1A0726B0`。

## 焦点能力探针

脚本为 `focus-state.ps1`、`focus-ready-gate.mjs` 与 `run-focus-capability-once.mjs`，均位于本目录。它们只观察焦点或最多调用一次 `BrowserWindow.focus()`；不创建项目、不粘贴文本、不打开送审对话框、不调用原生确认按钮。Electron 启动自己的全新隔离 profile，保留全部原始 stdout/stderr、进程/PID、焦点快照和正常关闭证据。启动 Electron 会运行产品正常初始化和 sidecar，不能称为纯读。

执行入口必须带 `--attempt-id`、`--approval` 和 `--approval-sha256`。审批 JSON 必须逐项写明 `kind=QA02_FOCUS_CAPABILITY_ONLY`、`approved_by=MGR02`、唯一 attempt ID、HEAD、product/QA/build/sender/runner/input/第一次 ledger SHA、三个探针脚本 SHA（包括 `ready_gate_sha256`）、`max_focus_calls=1` 和 `idle_floor_ms=60000`。入口核对审批文件本身的 SHA 与所有字段。旧审批均绑定旧脚本，不能复用。

启动前先运行原签名 runner 的 `--preflight-only=true`：核对 HEAD、27/6/73 文件、冻结输入及脚本哈希；核对第一次 ledger 未变、c19 相关进程为 0、attempt ID 与 profile 路径从未使用。只读状态采集需确认探针、前台窗口属于同一 session/桌面，且该会话距离最后输入至少 60 秒。`GetLastInputInfo` 只提供调用者会话的数据，无法排除采样后的竞争；大于 24 小时或异常的空闲差值按未知拒绝。

Electron 启动后立即保存单个 BrowserWindow 的 PID、初始可见状态、`isFocused()` 和原生 HWND。产品主窗先以 `show:false` 创建，`ready-to-show` 时才调用 `show()`；`firstWindow()` 返回不代表此时已可见。脚本沿用现有 QA runner 的 `.demo-root` 等待：分别限时 30 秒等 `domcontentloaded` 和 `.demo-root` 可见，再限时 15 秒轮询 `BrowserWindow.isVisible()` 且主框架不在加载；单次主进程采样限时 2 秒，并逐条追加原始窗口状态。辅助进程限时 15 秒，其他主进程读回限时 5 秒。身份变化、采样异常或超时即停；脚本不额外调用 `show()`。就绪后，两次间隔 250 毫秒的 Win32 状态采样核对前台、桌面及最后输入 tick 未变。若主窗已获得前台并且 `isFocused()` 为真，记录 `ALREADY_FOCUSED_NO_CALL`，不调用 focus。若主窗未聚焦，最后一次状态采样再次核对无活跃输入与前台稳定，先持久化 `focus-intent.json`，再调用一次 `BrowserWindow.focus()`。调用后两次读取 `GetForegroundWindow()`、窗口 PID 和 `isFocused()`；只有同一主窗 HWND/PID 且没有新的输入，才记录 `FOCUS_CONFIRMED`。任何未知、争用或焦点不一致均停止，不再调用 focus。

最后正常关闭 Electron，再做一次完整签名预检，核对第一次 ledger、相关进程为 0、profile 无锁。保留独立 profile 和证据目录。`ALREADY_FOCUSED_NO_CALL` 只能说明启动后已聚焦；它不证明焦点恢复能力。`FOCUS_CONFIRMED` 只能证明主窗聚焦能力，不能替代原生对话框的前台门。

官方接口：[Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window)、[Playwright Electron](https://playwright.dev/docs/api/class-electron)、[GetLastInputInfo](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getlastinputinfo)、[GetForegroundWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getforegroundwindow)。

## 第二次短剧尝试的条件设计

焦点能力探针完成后，MGR02 需另签一次明确的第二次送审授权。焦点探针审批不能授权来源提交。第二次授权应绑定同一 LAYOUT07 snapshot、HEAD、27/6/73 文件、冻结短剧输入、新 sender/runner 脚本 SHA、焦点探针结果 SHA、第一次 ledger 和第一次原生回执/读回/关闭证据 SHA、唯一第二次 attempt ID。若探针只有 `ALREADY_FOCUSED_NO_CALL`，需另行判断是否具备恢复证据；不能默认为 `FOCUS_CONFIRMED`。

第二次 runner 在任何 Electron 启动前核对第一次证据：原生回执 `native_action_attempted=false` 且 `send=null`，12 次 GET 均无 review/submission，第一次正常关闭，ledger 字节未变，冻结文本/产品/QA/dist 均未漂移。随后以 `wx` 新建 `bm-click-short-submit-<snapshot>-attempt02-<attempt-id>.ledger.json`，记录管理授权 SHA、第一次 ledger SHA、脚本/输入 SHA 与 `UNKNOWN_UNTIL_READBACK`。第一次 ledger 只读，绝不覆盖、删除或改写。第二次 attempt ID、profile、证据目录均全新且唯一。

第二次 runner 不自动重试。若聚焦主窗的修复策略获签，可在打开原生对话框前按空闲/同桌面门执行；送审 sender 仍必须在发送前核对独立 GET 的项目、版本、hash、当前修订和原生 dialog 的 HWND/PID、可见/启用、唯一按钮、`GetForegroundWindow()==dialog HWND`。意图先落盘，最多一次 BM_CLICK。发送后只凭同项目权威 bridge GET 判定业务结果；超时、焦点争用或不明结果记 UNKNOWN，停止下一阶段。

此设计需要一份单独签名的第二次 runner 和审批回执。现有一次性 runner 的 snapshot-key `wx` ledger 门保持原样，不通过修改候选或复制 snapshot 绕开它。
