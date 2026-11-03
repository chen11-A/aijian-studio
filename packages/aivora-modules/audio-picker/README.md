# 配乐和音效挑选器

纯本地确定性规则，不调用模型或网络。输入 `Scene` 与素材清单 `AudioAsset[]`，输出 `Selection`。

输入场景含 `emotions` 情绪标签、`description` 场景描述、`duration` 秒数、`previousMusicId` 上一场配乐 ID，以及镜头 `shots`。镜头有 `duration`、`hasDialogue`、可选 `description`，动作节点为 `{ time, label? }`。镜头总时长必须等于场景时长（允许 0.01 秒误差）。

输出 `music` 为配乐方案或 `null`：素材 ID、路径、整场进入和退出秒数、素材起点、淡入淡出时间、是否循环，以及台词镜头压低 12 分贝的 `ducking` 区间。`shots` 按镜头返回环境音 `ambience` 与动作音效 `effects`，时间相对该镜头，`end` 为停止时间。所有数值为秒或分贝。

```ts
import { pickAudio } from './index.js';
import manifest from '../../../assets/audio-library/manifest.json';
const result = pickAudio({
  emotions: ['紧张'], description: '雨中的打斗', duration: 5,
  previousMusicId: '上一场音乐',
  shots: [{ duration: 5, hasDialogue: true, actions: [{ time: 2, label: '拳脚' }] }],
}, manifest);
console.log(result.music, result.shots);
```

素材字段：`id/path/type/category/name/tags/scene/duration/loop/loudness/source/license`，类型为 `music` 或 `sfx`。只选择 CC0 或公有领域素材。中文情绪、名字、分类和标签作字面关键词匹配，相同得分按 ID 排序。

安静、沉默、克制、独白且非紧张/打斗/史诗时保留留白；无匹配时也不配乐。相邻场去重由调用者传入上一场 ID。不可循环配乐必须覆盖整场。环境音仅播放一段，最长至素材末尾；动作音效精确从动作节点触发并在镜头末尾截断。本模块生成时间安排，实际混音、循环和音量包络由调用者执行，不能从台词布尔值推断句内停顿。

在上级目录运行 `npx vitest run audio-picker`。
