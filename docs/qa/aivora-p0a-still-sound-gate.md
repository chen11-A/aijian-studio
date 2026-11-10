# P0-A 第一小片：画面采用门与声音决定

基线 `b0efb51e79a71d96c718dcc8bd0de0b08dda4946`。分支 `cursor/native-p0a-gates-7ab5`。产品原文在 `docs/aivora/product/`，字节未改。

## 这一片

- 空名单暂时当作 `shotPolicy=establishing`。清单是「画面里没有人物」、地点、画面描述。有名单时列出应出现（含动物名）、不应出现、外貌要点、道具说明、地点、画面描述。
- 采用记录保存每条清单文字。改地点、外貌、道具说明或画面描述后，文字对不上，门重新挡住。记录坏了就当作未采用，不抛错。新画面记录 id 用 `still_` 加随机值，不用 `still-${shot.id}`。
- 还没有画面的镜头不能采用，也不会写入 `stillUrl` 为空的记录。`stillUrl` 为空一律未采用。分镜页这时只显示「生成画面」，不显示「核对并采用」。出画面是单独一步，同一轮不会接着出视频；采用真实画面之后才能出视频。已采用的记录仍可打开查看。
- 新提交和 `resume=true` 都过同一道门。失败「重试」「全部重试」和「继续排队」在已采用时放行；未采用或清单已失效时停下，provider 调用数为 0。`ensureBillingProject()` 返回后会再用当时的镜头再判一次。
- 声音门只看 `audioDecision` 是否已是 `SILENT_BY_USER` 或 `WITH_AUDIO`。零片段也要选。不能用路径或增益推出有声。`VOLUME_STOPS` 的最低档只在时间线上作诊断，不参与禁用。选「本片静音」或「确认有声导出」之后，改声音设置不会清掉这个决定。镜头都齐且已选本片静音时，导出摘要写「本片静音」。
- G7e（用户裁决②：写出恰一条静音 AAC）本片没有满足。`audioDecision` 只在作品对象上，导出记录不带它。
- 剪辑页「建议 · 未生成」只在确有未生成的声音建议时出现。`soundRowLabel` 接到时间线里这些建议行。

## 定向

`pnpm exec eslint` 覆盖本片改过的文件，以及 `pnpm lint:ts`（`eslint .`）。`pnpm --filter @aijian/studio-web typecheck` 与 `pnpm --filter @aijian/desktop typecheck`。vitest：`still-acceptance`、`StillAcceptanceDialog`、`sound-export-decision`、`ExportSoundChoice`，以及 `ProWorkspace.test.tsx` 里「生成这一场」不调用 provider。

没有改 timeout、覆盖门、skip。生成用例改为先出真实画面再采用，再出视频。必须改掉的旧期望句记在 PR 说明里。
