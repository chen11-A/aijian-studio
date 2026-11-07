# 本机试片人工决定：原生与批次消费者

本片交付原生 producer、固定合同与实际 pipeline/Pro 检查消费者。新的试片展示/记录按钮由后续 UI 联合片接入；当前旧候选导航和手工继续保持原行为，不宣称用户入口已经全部完成。

## 输入、决定与继续

- `prepareFilmRiskTrial` 只收 exact project/raw hash/shot/take。main 读取实际同 ID canonical 工程，拒绝 series fallback；复用既有 `resolveAudioMix` 的路径、归属、SHA、固定工具与真实 native/clean 画面时钟。显示标签来自真实场镜号和版本记录，不显示路径或原始对象。
- source SHA 保留 native/visual 角色；参考图包含实际 poster、`[id,url]` still tuples、人物/场景引用及各自 SHA。准备前后复核同一已解析文件，不能把换角色的 SHA 集合冒作同一源。
- `rtr_` 仅为 owner/document 内存中的媒体/记录访问键，导航、关窗和新审阅退休旧键；dispose 会透传已有 managed probe 的 abort signal。该键不进入 FilmProject/history/工程包。
- 接受/需修改是**用户人工决定**，不证明完整播放、试听、像素/口型/技术质量通过，也不证明该素材最初由当前输入或模型生成。所选 clean/画面素材不等于最终四轨混音和字幕成片。
- 记录只追加 `riskTrialDecisions`，走原 `transactFilmProject` raw CAS/write/readback。旧镜头、take、文件、音轨及迟到的未选版都保留。最新同一试片身份的人工决定退休旧接受 ID。`rtd_` 与绑定摘要均不是费用或媒体授权；每次检查重新读取源。
- 原 video checkpoint 增加 `continueAfterTrial` 受控变体：首次核全镜范围，每个真正 video action 前核该目标及始终固定的试片。target-only 检查要求 canonical pipeline 已 running/video/continued、该目标 running，且镜序一致。
- 原 engine 先持久化 target running，再 execute；Pro 从该 canonical 文件取 fresh hash，不为检查重放 renderer snapshot。原 owner/current/cancel 仍保护整批；用户回改刚完成镜头也会挡住下一请求。已经完成的独立镜头通过实际 `applyVideoResponse` 新增 poster/take/dub/seconds，不会自使下一目标失效；修改下一目标参考仍失效。
- **记录接受绝不顺带 continue。** UI 必须在原数量/费用 checkpoint 明确触发受控变体。`batchShotCount` 仅为全镜范围，不是新增请求数、价格或额度；原会员、费用、历史备份及数量门不变。原手工 continue/start/retry/recover 不新增全局试片门。

## 失败和范围

真实写入后 readback 旧/空/错工程返回 `WRITE_UNCONFIRMED, unchanged:false`，保留已记录事实；不得自动重录或报未改。同 factory prepare 在 record 等队列、写入、读回整个生命周期均 BUSY。合法同项目 prepare 的 PROJECT_CHANGED/SOURCE_UNVERIFIED/TOOLS_UNAVAILABLE/UNSUPPORTED_SCOPE/REVIEW_STALE 发生于 active gate 之后；INVALID_INPUT、BUSY、transport 和泛 WRITE_FAILED 不作完成证明。完成证明后仍需 fresh canonical 全 delta，不能凭 ID/binding 报成功或继续。

首片限制为独立镜头的既有 video checkpoint：明确 `continuityFromShotId` 的跨镜动态末帧引用不支持，不猜未来素材。最多 256 镜/场、64 条人工决定，满时不覆盖旧记录；预览 80 MiB，引用图 12 MiB。备注原样保存最多 500 UTF-16 单元，不截断。main 当前只提供所选画面素材；其他镜头仍需逐一审阅。工程包既有白名单不携带本机决定；history 保留原项目记录，任何再次使用仍会 fresh recheck。

## 定向证据与边界

- `risk-binding-native-final3.log`：原生/IPC/沙箱/原 history 四文件 32 项通过；含实际 pinned FFmpeg 的 native 1.25s / clean 0.75s 对比计划 99s、原字节不变，旧 ID/参考字节/CAS/owner/重启、真实写入后的三类 unknown、最新人工决定、延迟未选 take。
- `risk-binding-web-final2.log`：四文件 30 项通过，包含原候选/手工流程、新 Pro 与原 pipeline 消费者及真实 producer 投影。
- 真实 Pro 跨层用例执行原 createFilmPersistence lease/queue、main FS write/read、实际 createFilmHistory.capture、真实 createFilmRiskTrials.check；在每次 maincheck 前从 project.json 断言 running/video/continued/当前 target running，两个独立目标依次完成。该时序用例仅 probe 与 provider 受控，不冒充真实视频质量；真实视频 clock 单独由 pinned FFmpeg 例证明。
- 最终 workspace TypeScript/build 与目标 ESLint/Prettier/diff 均通过；独立临时目录仅复制实际 desktop dist JS 和已编译 SDK44，成功 require factory/IPC 并验证非法输入 0 工具调用，无源码 fallback。
- 首失败日志保留：`risk-binding-native-stage.log` 捕获真实 poster/still tuple 字节漏绑并修产品；pipeline 初始新夹具未物化 data preview 被原 guard 阻止，跨层初始未等 recover lease/未提供完整 history 桥也被原 guard 阻止。未提高旧 timeout、弱化门或回退 legacy。

无 provider/会员/外网调用，未改 API/Python/预算/QC 规则/严重度。原完整 API 证据仍只对应冻结 6825。最终原完整 native/renderer、正常浏览器 UI 与真实安装窗口由 root 联合验证，不用本定向结果替代。
