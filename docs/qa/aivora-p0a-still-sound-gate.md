# P0-A 第一小片：画面采用门与声音决定

基线 `b0efb51e79a71d96c718dcc8bd0de0b08dda4946`。分支 `cursor/native-p0a-gates-7ab5`。产品原文在 `docs/aivora/product/`，字节未改。

## 这一片

- 空名单暂时当作 `shotPolicy=establishing`。清单是「画面里没有人物」、地点、画面描述。有名单时列出应出现（含动物名）、不应出现、外貌要点、道具说明、地点、画面描述。
- 采用记录保存每条清单文字。改地点、外貌、道具说明或画面描述后，文字对不上，门重新挡住。记录坏了就当作未采用，不抛错。新画面记录 id 用 `still_` 加随机值，不用 `still-${shot.id}`。
- 还没有画面的镜头不能采用，也不会写入 `stillUrl` 为空的记录。`stillUrl` 为空一律未采用。分镜页这时只显示「生成画面」，不显示「核对并采用」。出画面是单独一步，同一轮不会接着出视频；采用真实画面之后才能出视频。已采用的记录仍可打开查看。
- 新提交和 `resume=true` 都过同一道门。失败「重试」「全部重试」和「继续排队」在已采用时放行；未采用或清单已失效时停下，provider 调用数为 0。`ensureBillingProject()` 返回后会再用当时的镜头再判一次。将要发送的首帧与门用同一地址，不认旧 take 预览图。衔接前镜末帧或现场换上的图，也要先核对采用；出视频流程不再现场生成首帧。换帧之后、标成 running 之前再判一次。前镜选定版本和视频路径都没变、且当前画面就是已提取末帧时，不再重新提取。
- 一键成片若提交返回 `STILL_NOT_ACCEPTED`，结果是 blocked，提示「镜头 N 的画面还没核对」，不会记成 MEDIA_RESULT_MISSING。镜头上还留着旧成品版本时也一样，不靠「没有新成品」来推断。provider 调用数为 0。
- 核对采用只记下人对当前画面的结论。流水线指纹不算这条采用记录，所以出画面之后采用，一键成片还能继续。
- 本片没有做：单一主下一步、不合格镜头怎么处理、外貌冲突留下的那一片。
- 声音门只看 `audioDecision` 是否已是 `SILENT_BY_USER` 或 `WITH_AUDIO`。零片段也要选。不能用路径或增益推出有声。`VOLUME_STOPS` 的最低档只在时间线上作诊断，不参与禁用。选「本片静音」或「确认有声导出」之后，改声音设置不会清掉这个决定。镜头都齐且已选本片静音时，导出摘要写「本片静音」。
- G7e（用户裁决②）已由导出小片接上：`audioDecision=SILENT_BY_USER` 时成片写入恰一条静音 AAC，时长取视频流实测秒数，导出记录带同一个字段。`WITH_AUDIO` 仍走原混音。旧记录缺字段仍可读取。粗剪和试听遇到过期配声仍只提示「未混入」；只有导出会失败（`MATERIALS_STALE`），没有「确认后仍导出」。
- 剪辑页「建议 · 未生成」只在确有未生成的声音建议时出现。`soundRowLabel` 接到时间线里这些建议行。

## 定向

改过的 ts 文件过了 eslint，`pnpm --filter @aijian/studio-web typecheck` 通过。全量 vitest（`--coverage=false`）：studio-web 478 文件、5663 项通过；desktop 177 文件、2522 项通过。另外核对过这些会出视频的用例是否先有真实画面再采用：`ProWorkspace.generation-execution.test.tsx`、`ProWorkspace.persistent-history.test.tsx`、`PipelineWorkspace.integration.test.tsx`（出画面后在界面上采用再继续）、`pipeline-workspace-host.test.ts`、`ProWorkspace.test.tsx`、`ProWorkspace.batch-scope.test.tsx`、`actions/generation-run.test.ts`、`actions/generation-run.video-review.test.ts`、`apps/desktop/src/film-dialogue-limit.test.ts`。

两条审计在点「检查成片」之前先点一次「确认有声导出」：`apps/studio-web/e2e/pro-audio-mix-cases.mjs` 的 mix-solo-export，以及 `apps/studio-web/e2e/pro-evidence-legacy-cases.mjs` 的 `review()`。没有改断言、阈值或截图规则。

没有改 timeout、覆盖门、skip。必须改掉的旧期望句记在 PR 说明里。
