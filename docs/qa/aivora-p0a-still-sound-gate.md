# P0-A 第一小片：画面采用门与声音决定

基线 `b0efb51e79a71d96c718dcc8bd0de0b08dda4946`。分支 `cursor/native-p0a-gates-7ab5`。产品原文在 `docs/aivora/product/`，字节未改。

## 这一片

- 空名单暂时当作 `shotPolicy=establishing`。清单是「画面里没有人物」、地点、画面描述。有名单时列出应出现（含动物名）、不应出现、外貌要点、道具说明、地点、画面描述。
- 采用记录保存每条清单文字。改地点、外貌、道具说明或画面描述后，文字对不上，门重新挡住。记录坏了就当作未采用，不抛错。新画面记录 id 用 `still_` 加随机值，不用 `still-${shot.id}`。
- 没有采用就不能新出视频，包括还没有画面的镜头。`runGeneration` 在会员请求前停下，请求数是 0，状态写「镜头 N 的画面还没核对」，并留下「去核对镜头 N」。分镜页「生成这一场」、确认表、工具栏重做/改写都进这条新提交。一键成片出视频也调用同一个 `submitGeneration`。已经建好的 take 走 `resume=true` 时不再二次拦截，避免把重试当成一次新的未采用提交。
- 声音门只看 `audioDecision` 是否已是 `SILENT_BY_USER` 或 `WITH_AUDIO`。零片段也要选。不能用路径或增益推出有声。`VOLUME_STOPS` 的最低档只作诊断，不参与禁用。选「本片静音」或「确认有声导出」之后，改声音设置不会清掉这个决定。
- G7e（用户裁决②：写出恰一条静音 AAC）本片没有满足。`audioDecision` 只在作品对象上，导出记录不带它。
- 剪辑页「建议 · 未生成」只在确有未生成的声音建议时出现。`soundRowLabel` 接到时间线里这些建议行。

## 定向

`pnpm exec eslint` 覆盖本片改过的文件，以及 `pnpm lint:ts`（`eslint .`）。`pnpm --filter @aijian/studio-web typecheck` 与 `pnpm --filter @aijian/desktop typecheck`。vitest：`still-acceptance`、`StillAcceptanceDialog`、`sound-export-decision`、`ExportSoundChoice`，以及 `ProWorkspace.test.tsx` 里「生成这一场」不调用 provider。

没有改 timeout、覆盖门、skip，也没有改旧断言的期望句。已有生成/导出用例在点击前补了采用或「本片静音」，期望句仍是原来的。
