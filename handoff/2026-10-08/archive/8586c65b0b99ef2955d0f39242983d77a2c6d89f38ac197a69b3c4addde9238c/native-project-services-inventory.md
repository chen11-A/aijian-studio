# PROJECT01 原生窗口 QA 准备清单

状态：第四轮原生 smoke 在 AI 服务页标题处停止；详见 `native-project-smoke-review-20260924.md`。当前只准备包含 DEV03 导航修复的复验脚本，等待 QA03 对新 dist 完成同源构建并提供完整 SHA 清单后，才冻结新计划、profile 并交 MGR02 审批。旧 dist 和旧四轮 profile 不属于复验输入；AC05 尚不得同步 c19。

## 启动门禁

1. MGR02 提供固定 build/source/dist 文件清单及 SHA、批准的 `plan.json` 和绑定 runner/helper SHA 的 `approval.json`。`plan.files` 必须覆盖当时全部 Git 工作树改动路径和两处 dist 的全部文件；`plan.gitStatus` 保存精确输出。runner 在启动前复算清单、HEAD、工作树状态；AC05 或其他漂移使哈希不符时直接停止。
2. `plan.profile` 是 `c19/.aijian-dev/<runId>` 的全新严格子目录；`plan.evidenceDir` 位于 c19 外且不存在。首次启动前确认没有 c19 相关进程。
3. 使用已安装的 Playwright Core 1.62.1 `_electron.launch` 和 `firstWindow()`。每个操作限定在该 `Page` 的 locator；校验唯一窗口、main PID、HWND、webContents ID、Win32 HWND owner PID、c19 Electron 文件真实路径及其到 Playwright launcher 的祖先链。窗口快照先写证据再断言。Win32 前台 HWND/PID 与最后输入 tick 只读留证。没有全局指针、键盘注入或强制置前。

## 两次启动的检查

| 时点 | 操作与判据 | 主要证据 |
| --- | --- | --- |
| 首次 ready | main 与 sidecar PID、窗口 HWND、renderer file URL、前台 HWND/PID；无“UI 演示 · 样例”控件、演示存储进度条及“128 GB / 1 TB”假配额 | ready 截图、OS 快照、事件流 |
| 项目空态 | 用窗口内按钮连接本地工作区，看到“还没有项目” | 项目/服务状态、截图 |
| AI 服务 | 从主导航进入 AI 服务，先记录导航后截图、URL hash、main 标题与文本、表单是否存在，再判“AI 服务”标题和“还没有模型连接” | locator 结果、导航后 DOM/截图、空态截图、renderer/main 控制台错误 |
| 无效地址 | 选择 Sub2API，填虚构 `https://qa-native-project.invalid/v1`、假的业务 key 和 TEXT 模型；点“保存连接”只触发本地格式错误，连接数仍为零 | 错误文本、截图 |
| 本地保存 | 改为 `https://qa-native-project.invalid` 并保存；看到连接名、origin、模型 ID 和“密钥已配置” | 列表回显、截图；不记录 key 明文 |
| 首次关闭 | `electronApp.close()` 正常完成，main/sidecar 退出，profile 锁可独占只读打开 | 关闭和 OS 后验 |
| 同 profile 重开 | 再次由 Playwright 拥有新进程和实际窗口；连接工作区后在 AI 服务列表读回同一连接及凭据状态，项目仍空 | 新 PID/HWND、读回截图、事件流 |
| 最终关闭 | 正常关闭，相关进程零、锁释放；只读检查隔离 SQLite 为 v22、仅一条 SUB2API 连接、项目数零、FK/完整性正常且 DB 不含假 key | postflight、DB SHA/读回、原始 stdout/stderr/exit |

仅允许这两次 Electron 启动；不点模型探测、生成、来源上传或任何 provider 请求。renderer 若尝试非 loopback HTTP(S)，runner 会阻断并记失败。测试 `.invalid` 地址不证明真实 provider 可用、会员权益、额度或远端资产能力。

## 交付文件

- 外置 runner：`native-project-services-once.mjs`；Win32 只读 helper：`native-project-os-readonly.ps1`。
- 正式运行后单独保留 `plan.json`、`approval.json`、前后 source/dist SHA、main/sidecar/前台快照、事件 JSONL、`result.json`、原始 stdout/stderr/exit、隔离 profile/SQLite 和截图。每次关闭后单独核进程与锁。
- Page 与 Electron main 的 console error、Page 未捕获错误会入 `result.json`；任何错误使本次 smoke 停止。事件监听从 Playwright 取得应用/Page 后开始，早于监听器的启动日志不在此范围。
- 若窗口 locator 需要改用全局指针或用户手动置前，先停在对应动作前，报告具体动作与当前窗口证据；不把旧 M1 焦点失败当作本次结论。
