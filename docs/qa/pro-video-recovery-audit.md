# 原视频素材找回：实际 Pro 正常浏览器专项

运行 `node apps/studio-web/e2e/pro-video-recovery-audit.mjs`。Node 专用契约为 `node --test apps/studio-web/e2e/pro-video-recovery-fixture.contract.mjs`，不会被 Vitest 当空用例收集。独立普通 Ubuntu `pro-video-recovery` job 使用 Node 24.15 与正常 Chrome 沙箱；复用原安全 CLI/Vite finally 生命周期、已有服务器 `--url`、临时/忽略产物限制，不使用 no-sandbox。

固定 4 态 × 1280×800 / 1920×1080 × 16:9 / 9:16，共 16 个组合。原 420 个组合的定义、workflow 完整前缀、几何阈值与执行步骤保持。新增后执行定义为 436，不代表已获得 436 个正常结果或独立页面。

| 状态                 | 实际用户操作与断言                                                                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| recovery-success     | 默认三桥零调用；作品→作品设置→查看记录才 list，单条显式 recover 后展示 main 文件事实；取消另存不成功，再明确另存才 SAVED，工程/所有版本不变                 |
| recovery-unknown     | WAITING 不变成功；再次明确核对返回找回未确认后禁重发，只 fresh list；另存未确认也禁止重复，刷新不自动另存                                                   |
| recovery-late        | 默认模式真正 hold 第一次 recover；关闭后通过真实作品菜单切另一集，等其真实 autosave 完成后取完整 raw/次数基线；释放旧回复不污染另一集，重新进入只列该集记录 |
| recovery-unavailable | 旧桥确实缺三个方法、控件不给虚假执行；关闭后受控 native 能力可用，通过真实菜单打开未关联的另一集仍零 RPC，不自动创建 API 作品                               |

最后一态的能力恢复仅模拟 native ABI 可用性，不改 React 状态、当前工程或 backendProjectId。所有工程/选版/晚回包均走真实 Pro。四态六镜三版、当前与另一集完整 raw 保留，零生成/建 API 作品/旧导出/assembly；每次 recover/save 精确核当前 API 作品与实际 opaque attempt，未知不会自动重试。人工单击“找回”在真实 main 中会查询原 provider GET；这里仅合成该 ABI 返回，不声称发生真实下载、目录选择、文件复制、解码、Windows 保存或人耳试听。

几何使用原 probe，对真实当前可操作 modal 检查溢出/裁切/遮挡，关闭/找回/另存/刷新另做真实滚动和 trial 可达性。外部 HTTP/API 全部阻断，不能借文件存在、文字结果、播放请求当完整观看或新稿使用许可。公开注释双白名单，仅固定 state/control/class、有限数值和固定 case 行号，最多 8 条；原始正文、opaque ID、地址、路径、凭据只可能在私有合成调用 artifact，不能进入注释。固定源码指纹包含真实恢复合同、main、IPC/preload、API 服务与实际 UI/hook。

新增默认契约阶段 10/10 已过：成功/取消、未知有限步骤、默认 hold、旧桥缺方法、seed 保原音轨及三版本、错误 scope/派发拒绝、CLI 和私密标记负例、16 组合/沙箱/缺浏览器退出 2。正常 Chrome 本片 16 态尚未运行，Node/静态不替代像素验收；root 的真实 main/API/文件测试与原完整门独立记录。

本地最终：旧新 12 个 `.contract.mjs` 共 120/120 通过（`/tmp/video-recovery-browser-all-contracts-final.log`），新 10/10（`/tmp/video-recovery-browser-contract-stage.log`）；包括最终 expectedResults 为数字 16 的实际源码分支核验。6 个变更 mjs 的语法/ESLint、8 个交付文件格式及 diff 检查通过，原 workflow 完整前缀逐字节一致。仅合成 QA/独立 job，无产品改动，正常 Chrome 16 待根推送执行。
