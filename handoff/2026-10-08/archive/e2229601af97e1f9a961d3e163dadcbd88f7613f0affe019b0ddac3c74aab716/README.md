# QA03 SOURCE 项目名称 CAS overlay v3：component-02 静态封套

状态：`STATIC_FIX_FROZEN / NOT_APPROVED / COMPONENT_02_NOT_RUN`。仅修订外置 `run-component-once.ps1` 中 `Invoke-Captured` 的形参、ProcessStartInfo 参数循环及收据参数记录，将 PowerShell 自动变量 `$args` 改为 `$commandArgs`。五案测试与 Vitest 配置字节不变；不写 c19 产品树。

## 上一次原始失败

MGR02 仅批准 v2 `component-01` 运行一次。原始 `component-01/RECEIPT.json` SHA256 `4C14AC030512037B00D63097C96ADB91B5F95B9FBF5C01CA97F8E3049AC262D1`，状态 `PREFLIGHT_OR_TOOL_RED`，首 RED 为 `before fingerprint RED`。before 子进程退出码 0，但收据 `arguments=[]`，未生成 `before.json`；raw stdout/stderr 均 0 字节、SHA256 `E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855`。未执行五案、build、sidecar、Electron 或 provider。该结果是 QA wrapper 错误，不能记为产品测试 RED。旧批准、v2 runner 和 component-01 原始文件保持原样，不复用旧批准。

## v3 静态检查

`STATIC-ARG-CHECK-01.json` 保留首次检查脚本误取 `Body.ParamBlock.Parameters` 所致静态误报；`STATIC-ARG-CHECK-02.json` 改用 `FunctionDefinitionAst.Parameters` 后通过。PowerShell 解析错误 0；函数第 3 形参为 `$commandArgs`，ProcessStartInfo 的 ArgumentList 与收据 `arguments` 使用同一变量，runner 中不存在 `$args`；`Read-Fingerprint` 静态传入 `@($fingerprint, $path)`。按 v3 模板的输出目录，before 的预期参数为 `fingerprint.mjs` 与 `component-02/before.json`。这只证明源码调用形状，尚未证明真实进程参数或指纹输出。

v3 模板 `RUN-APPROVAL.template.json` 为 `NOT_APPROVED`，runId `qa03-source-name-cas-02`，输出目录是全新的 `cas-overlay-v3/component-02`。MGR02 须另行签署与本 `PACKET.json` SHA、v3 runner SHA、快照/同步回执、c19 HEAD/status、四源文件、source/dist 指纹及脚本/配置哈希匹配的单次批准封套；QA03 仅在取得该封套后运行一次。首 RED 立即停止。五案 5/5 且前后指纹无漂移，仅构成局部 mock 组件结果，不是新进程持久化、Electron 原生或最终验收。

固定 c19 候选：MGR04 快照 SHA256 `EE77C4EEB6B75A20C776CE9CF5C7048B14DEA23441F5F8B1F5B3F892DF5AF312`，保护同步回执 SHA256 `6CB98F12620EEBCCC244ACEAD6DC1888B1E7302A403AAACEBAC63B22881B2ACF`；StoryPages 新 SHA256 `34D272A7ED104E2A983BAB774212C17F6CF7F9913198212B7052E7487B67DA60`，HEAD `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`。其他约束见 `PACKET.json`。
