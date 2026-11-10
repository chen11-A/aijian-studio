# P0-A 第一小片：画面采用门与声音不说成完成

基线是集成线 `b0efb51e79a71d96c718dcc8bd0de0b08dda4946`。分支 `cursor/native-p0a-gates-7ab5`。产品原文在 `docs/aivora/product/`，内容未改。

## 这一片做了

- R13 / §4.4：每个已有画面的镜头可以打开「核对并采用」。有出场名单时列出应出现（含动物名）、不应出现、每个角色最多 4 条外貌要点、道具和地点。出场名单为空时清单是「画面里没有人物」和地点。任一项不符合不能采用。未采用时分镜页「生成视频」和生成页「生成 N 个版本」为 `aria-disabled`，旁边是原因和「去核对镜头 N」。点击、Enter、Space 不进入生成。
- D6 / G7e 反向 / §7：有路径或 AAC 且增益不高于 −40 dB，不算可听声音。未生成的声音建议写「建议 · 未生成」，不写完成。已有音轨但不可听时，导出前要选「本片静音」或「先去做声音」。选「本片静音」只把 `audioDecision=SILENT_BY_USER` 记在作品上。

## 定向

```
pnpm --filter @aijian/studio-web exec vitest run --coverage=false src/aivora/pro/still-acceptance.test.ts src/aivora/pro/StillAcceptanceDialog.test.tsx src/aivora/pro/sound-export-decision.test.ts src/aivora/pro/ExportSoundChoice.test.tsx
pnpm --filter @aijian/studio-web typecheck
pnpm --filter @aijian/desktop typecheck
```

新测试 8 项通过。studio-web 与 desktop typecheck exit 0。没有改 timeout、覆盖门、skip。旧断言的期望句没有改；少数已有画面再点生成的用例先走一遍采用，才能到达原来的生成断言。

## 未做

- 单一主下一步、不合格镜头不能放入、外貌冲突阻断。
- 恰一条静音 AAC 的导出写入。`applyDialogue` 里已有 `anullsrc`，没有接到这次「本片静音」决定，留到下一片。
- 一键成片内部的出视频步骤没有接这道门。已有未采用画面时，手动「生成视频」和「生成 N 个版本」会停。流水线里的 `submitGeneration` 仍按原断言执行。
- 没有任何音频片段时，不挡住原来的「检查成片」。有音轨或声音建议、但没有可听声音时才必须二选一。
- renderer 不接收 cache、路径或 SHA。清单只有人名、外貌句子、道具说明和地点文字。
