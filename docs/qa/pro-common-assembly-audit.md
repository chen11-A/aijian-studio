# Pro 共享合成浏览器检查

本片在独立工作树准备，等待 B08 冻结产品基线后统一合入、静态与正常 Chrome CI 验证。旧 308 态和几何阈值保留；旧桌面夹具的合成调用改核新 `assembleFilmProject`，禁止回退 `assembleFilm`。没有把尚未运行的新页面写成通过。

新增四态 × 两窗口（1280×800、1920×1080）× 两画幅（16:9、9:16）：

| 状态                       | 真实 Pro 入口与检查                                                                                              |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `assembly-actual-clock`    | 剪辑页接收所选六镜的实际时钟；总长和第二镜跳转使用回执，区别于计划秒数；原版本与音轨保留。                       |
| `assembly-partial`         | 保留可请求播放的粗剪，明确声音或字幕阶段未完成；不自动 QC、发布或重新提交。                                      |
| `assembly-cancel-revision` | 真实版本选择改变输入；请求取消不等于停止，旧操作未停止前不准入串行新操作；主进程确认停止后只采用最新输入的回包。 |
| `assembly-missing-cache`   | 重启式已有本机粗剪但无会话时钟；整片播放与逐秒定位仍可请求，按镜头跳转与 I/O 不借计划比例伪造实际时钟。          |

每次 RPC 精确检查工程、完整原始记录 SHA、当前有视频的选版及顺序和唯一 operation ID。输入不含 renderer 提供的执行路径。元数据波形更新不视为新渲染输入；实际 mix、字幕或选版变化按受控序列逐项验证，不用放宽调用次数取得通过。初次合成必须等真实波形与混音预览的保存、读取结束后才取得保存队列。旧默认 Node 夹具与浏览器一致安装新 ABI；history 能力存在，但本 case 未授权的 capture/restore/verify 实际调用仍抛固定错误并计数，不用空成功掩盖调用。

foreign 基线只观测来自固定 ProWorkspace 文件的真实 400ms autosave：保持原 delay/调用时机，记录排队、取消或触发；按真实 header 的作品/集名唯一匹配合成 canonical 工程，绑定 stage/generation，同时等本次 native producer 与实际 write Promise 完成。不使用 activeId 副作用、sleep、强制 flush、React state 或筛掉普通写来求绿；同名歧义或未知 scope 不得借其他任务的就绪。基线之后原完整 raw/当前引用/零新增 foreign write 断言保留。

旧 native 请求 oracle 随真实消费语义调整：声音组或单素材添加/移除会产生对应 clips revision；mix 各真实滑块键按实际保存及 native 准入逐步串行，保原 -0.1/-0.2/-0.3/-0.4 与静音值、原旧版/停用配音负例。未完成的 stale preview 不得提前准入 assembly；foreign 新工程使用独立 projectId，不能因为复用相同媒体路径而跳过新请求。每次仍精确核 CAS/完整选版顺序/混音与字幕设置/唯一 operation ID，未放宽为任意次数。

所有页面从真实 Pro 导航进入，不替换组件或注入 CSS。外部 HTTP 和 `/api` 阻断，供应商/生成/旧导出调用禁止。保留原 probe 的溢出、裁切和遮挡规则及真实滚动入口。失败只输出固定状态、问题种类、有限控件标识与数值，完整报告和截图留给 artifact。

## 替身与验证边界

- 新桥返回合成的安全时钟、私有 artifact、partial 结果和请求/停止事件；不调用 FFmpeg、不创建实际成片。
- 对已声明的合成 artifact 仅记录 HTML video 的播放/暂停请求；通过受控 DOM metadata 事件和 currentTime 请求检查 Pro 的计算。没有绕过 Chromium 沙箱，没有修改 React 状态或自定义协议，没有声称浏览器已解码、播放或听过声音。
- 未知/缺缓存状态不会注入 session clock。fixture 只模拟输入工程和 native 回执；产品需自行派生本机播放 URL。
- Node 契约验证默认拒绝、精确 CAS/选版、实际时钟、部分结果、取消 ACK 与停止的区别、legacy 禁用及媒体 spy 的窄范围。它们不能替代正常 Chrome、真实 native 文件/FFmpeg、打包资源或 Electron 验收。

复跑入口：`node apps/studio-web/e2e/pro-assembly-audit.mjs`；可用既有 `--url`、`--browser`、`--out` 安全参数。新增独立普通 Ubuntu `pro-assembly` job（16 态），原 workflow 全前缀与旧 308 态不变，总目标 324。artifact 仅明确 report.json 与两个窗口的 PNG，隐藏目录、7 天保留；完整 source hash 固定覆盖 ABI、主进程/gateway、renderer 时钟/工作流/媒体映射、夹具与核心计算文件，不接受任意 hash 路径参数。

当前夹具日志：`/tmp/common-assembly-browser-fixture-contract.log`。旧契约联合阶段日志：`/tmp/common-assembly-browser-contracts-stage.log`；最终产品合入与 CI 结果另补，不能复用其他源码的通过结果。
