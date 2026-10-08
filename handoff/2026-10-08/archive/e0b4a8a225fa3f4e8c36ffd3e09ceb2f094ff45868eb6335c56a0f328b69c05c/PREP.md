# DemoApp 正式/演示控制独立 QA 准备（只读）

状态：仅定位 c19 当前 49 路径固定包；等待 DEV03 精确文件接口、AUTHOR_FROZEN 与 MGR04 快照后，在本 QA work 目录写外置 jsdom/本地合同测试。此阶段未跑测试、未启 Electron、未编辑 c19。

## 当前入口与已知测试

- `apps/studio-web/src/aivora/DemoApp.tsx` SHA-256 `070F266491BE6DC6F4E9CC0AD049B65B36BE358438F496758D4201F2762D5A0E`：`DemoApp({fixture?})`，内部 `DemoProvider`；`Workspace` 由 `useDemo()` 获 `isFixture`、项目等状态。现在顶栏服务按钮固定显示“未连接真实服务”，演示下拉固定显示“UI 演示 · 样例”，重置只改 URL 并重挂 provider。DEV03 的正式行为须以冻结新文件为准。
- `model.tsx` SHA-256 `0B2F661BFB9F156489667603F070DA04AE3F28633452201236D65249996CE211`：正式项目由 `connectRealWorkspace` / `createRealProject` / `selectRealProject` 管理，选择保存在本地 workspace selection；`fixture` 决定样例模式。复测必须证明 UI 控件不会清除或替换已有正式项目及其选择。
- 现有 `C19WorkspaceInteractions.test.tsx` 已测 fixture 演示下拉重置、服务按钮路由、作品/剧集切换；`production-empty-state.test.tsx` 已测无 fixture 时不泄漏样例数据；`HomePages.test.tsx` 已有真实本地 bridge 的项目读回和错误恢复。新 QA 用这些入口与 helper，补真实缺口，不重复既有浅层断言。

## 外置回归矩阵（新接口冻结后定稿）

| 场景 | 独立可判证据 |
| --- | --- |
| production / fixture | 无 fixture 时不显示可写样例控制，正式服务状态从实际本地 bridge/状态获得；传入 fixture 时演示控件可见且不冒称正式项目或服务。 |
| 已有项目保护 | 预置两个真实项目与持久选中 ID；切页、服务状态失败或点击演示/重置相关控制后，项目列表、原选中 ID、既有正文/来源状态不被样例覆盖；无授权的创建/导入 POST 调用次数为零。 |
| 服务未知/错误 | bridge 缺失、读取 pending、失败或结果未知时显示准确状态和可行下一步；不把未知说成“已连接”或“未连接”事实，原始错误可由 UI/证据追溯且不自动重试写请求。 |
| 按钮行为 | 逐一检查顶栏服务入口、演示控制、重置与相关按钮：有真实导航/动作及可观察结果，或 disabled 且显示具体不可用原因和下一步；不能仅凭 click 返回签可用。 |
| 稳定性 | 旧异步服务/项目回包在切项目、重置或卸载后不能覆盖当前页面；保留原始错误状态，fixture 与 production 不串。 |

先用旧固定包运行能区分当前缺口的少量 RED，保留测试 SHA/raw/exit/HEAD/status；DEV03 新文件经 MGR04 同步后核快照，运行同组至 GREEN，按新改动追加必要 typecheck/build。页面原生 Electron、真实 Provider 与最终用户验收单列，不由 jsdom 代替。
