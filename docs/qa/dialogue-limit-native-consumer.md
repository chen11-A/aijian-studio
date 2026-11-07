# 真实对白超限回执的本机消费

本片段接通真实单目标视频请求 → API typed 超限事实 → 主进程会话回执 → 本机拆镜审核/原子结构接受。没有自动拆镜或额外配音、图片、视频调用；子镜时长仍是文字估算，不切原始音频，也不宣称逐词对齐。

## 信任与生命周期

- `createStoryFilm` 保留旧两参调用。新桌面 preload 声明 `supportsStoryFilmLocalScope`，可接第三个 IPC-only scope：`projectId/shotId/takeId/inputFingerprint`。它不进入 HTTP/provider body，也不是请求授权、预算或付费许可。
- 生产队列仍先持久保存 running take。创作摘要计算后重新检查取消、暂停与当前投影；编辑或取消发生在摘要等待中时不调用视频 IPC。摘要包括当前选版、对白/声音/模型、画面与参考身份，排除 own running→failed、保存时间等运行变化。
- 主进程只在真实 HTTP 回执之后异步读 canonical 记录，避免在原派发许可之后引入新读盘等待。必须 exact 本地工程 ID、backend ID、唯一 shot/take slot、running 状态、真实请求对白/声音/模型/创作摘要均匹配，并且实际返回 `DIALOGUE_VIDEO_LIMIT`、有效请求 SHA、pre-target-video typed 事实。scope 或回执验证失败只是不 mint，不改变原请求结果。
- 支持无 shots 的单目标（index=null），以及正式单镜队列每请求一条 shots（index=1）。多条 shots 请求即使文字相同也不猜目标、不 mint；不能把本次目标未提交视频说成整批从未提交。
- 回执是 owner-bound 的 `dle_…`，内存最多 64 条、30 分钟到期，窗口销毁和主文档导航清理；HTTP 前同步捕获文档 epoch，HTTP 后及 canonical 读取后均复核，旧请求不能在导航之后复活条目。renderer 只在模块内保存 ID。工程、take、历史、ZIP 都不保存可消费 ID；重新打开或导入工程没有会话授权。
- native prepare/apply 可带 `limitEvidenceId`，只认活 registry。正常本回执 running→failed 与失败说明变化允许；改创作/声音/选版/工程、错误 sender、重启与过期拒绝。主进程同一纯 runtime 生成审核计划并在 apply 重编，仍走原强制本机历史备份与队列 raw CAS。
- 真实超限可以触发文字估计仍在 cap 内的完整句界分镜。每个完整句子独立，不能安全分句则拒绝；各段仍仅 estimate，不称已满足真实语速 cap。`READY.actualLimit` 只返回 required/max 秒数、raw 是否确已保存、本次目标未提交视频；不返回 raw SHA/请求 SHA/声音 ID。原创建 IPC 的 typed fact 也仅投影安全数字/保存布尔，原始摘要留 main 内校验。
- apply 成功或写入结果不明会消费会话证据，不能自动重发。原镜与旧 take 完整保留在本机历史；工程包依旧只含当前稿，不含本机历史。

## 接口与显示边界

`pro/actions/dialogue-split.ts::nativeDialogueSplitInput(film,shotId,expectedHash,versions)` 组装 native input 并从 session memory 附加提示 ID。主进程复核仍是唯一授权依据。离线纯 planner 保持原 WITHIN_CAP 行为；只有 live native evidence 路径允许实际超限触发。

本片段不新增拆镜 UI、不自动确认新生成预算、不把结构接受变成付费派发。旧 pipeline/range 或未声明新 scope 的桥保留原调用，不伪造可消费回执。原 bearer 获取期间的既有取消窗口没有在本片段扩展为新的 shutdown/双阶段请求协议。

## 本机证据

测试使用真实本机工程 JSON、保存队列、历史备份、主进程审核/结构 CAS与真实 renderer runGeneration/applyVideoResponse；仅 HTTP/provider 回包为受控替身，无真实会员或外部供应商调用。

- registry/native/IPC/原 client/history 定向：7 文件 92 项通过（`/tmp/dialogue-consumer-final-desktop-tests.log`，含同文件 24 项新回归，子集不累加）。
- 真实 Pro 所选批次/原生成/拆镜/队列/operations/声音预算定向：7 文件 80 项通过（`/tmp/dialogue-consumer-final-web-tests.log`）。
- `pnpm typecheck:ts` 与 `pnpm build` 全部 exit 0（`/tmp/dialogue-consumer-final-checks.log`）。本片段没有 Python 修改，没有重跑或引用旧 Python 全量结果。
- 目标 ESLint（包括 `.d.ts`）、Prettier 与 `git diff --check` exit 0（`/tmp/dialogue-consumer-final-static.log`）。
- 原 shipping builder 真实构建 37 public CJS exports（`/tmp/dialogue-consumer-final-runtime.log`）；复制实际 desktop dist + 该 contracts 包到无源码、无 renderer 的隔离 app，真实 IPC mint→wrong-owner 拒绝→native prepare/apply→历史备份→单次消费 exit 0（`/tmp/dialogue-consumer-final-isolated-cjs.log`）。HTTP 仅一条本机回包替身；原视频 bytes 不变、ID 不入工程/历史。
- 尚未验证真实会员/用户工程或 Windows/Electron 窗口交互，本片段没有新增 UI 自动接受流程。原 API 合同生成检查在本片段提交后按原命令验证。
