# AIVORA 智能体提示词库

8 个角色，每个角色一个 JSON 文件：系统提示词（输出格式写在提示词里）、输入格式、严格的输出结构（都带 JSON Schema），以及用测试小说《雨夜旧书店》（`fixtures/test-novel-2000.txt`）写的 3 个示例。这个目录只放提示词和校验脚本，软件里还没有接入，现有的调用仍在 `services/api/src/aijian_api/agents/prompts/` 和 `apps/studio-web/src/aivora/pro/ProWorkspace.tsx`。

第二版的输出格式以软件现有的解析器为准：解析器读的旧字段一个不少、写法不变，新字段只是附加。`scripts/check-app-parsers.mjs` 会把每个示例输出交给软件自己的解析器，确认原样读出。

## 文件

| 路径                                  | 内容                                                                |
| ------------------------------------- | ------------------------------------------------------------------- |
| `roles/writer.json`                   | 编剧：按场次标题分场，原文对白一字不改，列出新人物的性别和年龄段    |
| `roles/art.json`                      | 美术：画风、固定外貌、每场的衣服、定妆照、空镜、道具图              |
| `roles/director.json`                 | 导演：分镜，起始画面和带参考图的视频提示词                          |
| `roles/performance.json`              | 表演指导：每个镜头一行，表情、眼神、手势、呼吸和配音提示            |
| `roles/action.json`                   | 动作指导：每个镜头自带动作节点，旧的 beats 照样给软件               |
| `roles/sound.json`                    | 声音设计：每场一个配乐情绪、总音量和四层音量、环境声和音效          |
| `roles/continuity.json`               | 场记：前后镜头的衣服、痕迹、道具、站位是否连贯                      |
| `roles/review.json`                   | 审片：同一镜头几个版本并排对比，推荐一版                            |
| `schema/role-file.schema.json`        | 角色文件本身的结构                                                  |
| `fixtures/test-novel-2000.txt`        | 测试小说，三场：第一场 雨夜旧书店、第二场 码头仓库、第三场 医院走廊 |
| `fixtures/test-novel-2000.notes.json` | 标准答案：每处引号是不是台词、谁说的；原文写到的性别和年龄          |
| `scripts/validate.mjs`                | 校验脚本                                                            |
| `scripts/validate.test.mjs`           | 校验脚本的反例测试（故意改坏，确认会报错）                          |
| `scripts/check-app-parsers.mjs`       | 用软件现有的解析器读示例输出                                        |
| `scripts/json-schema.mjs`             | 不依赖第三方包的 JSON Schema 2020-12 检查                           |
| `scripts/rules.mjs`                   | Schema 写不出来的规则，以及示例之间的串联检查                       |
| `scripts/reply.mjs`                   | `parseReply()`：按软件的方式解析模型回复                            |
| `scripts/novel.mjs`                   | 读测试小说、取引号里的话、算台词字数                                |

## 流程和分批

```text
小说 → 编剧 → 美术 → 导演 → 表演指导、动作指导 → 声音设计 → 场记
                                 ↓
                     生成起始画面和视频（每镜几个版本）
                                 ↓
                               审片 → 用户在「一选多」里选定
```

| 角色     | 一次发什么                                     | 示例                       |
| -------- | ---------------------------------------------- | -------------------------- |
| 编剧     | 一场或几场的全部段落                           | 每例一场                   |
| 美术     | 这些场次，加上已锁定的画风、人物、衣服和图片   | 第二、三例沿用第一例的画风 |
| 导演     | 一场；场次短时几场一起                         | 19、26、20 个镜头          |
| 表演指导 | 一场里的一批镜头，最多 12 个，只发有人物的镜头 | 第 5–16、14–25、2–12 镜    |
| 动作指导 | 一场里的一批镜头，最多 12 个                   | 第 4–15、14–25、9–20 镜    |
| 声音设计 | 一场或几场的全部镜头、动作节点和候选素材       | 每例一整场                 |
| 场记     | 一场里连续的一批镜头和上一批结束时的状态       | 第 8–19、9–20、9–20 镜     |
| 审片     | 几个镜头的全部版本，抽帧图加起来不超过 14 张   | 每例两个镜头，10 张图      |

示例 1、2、3 分别对应第一、二、三场。同一个编号的示例是接起来的：编剧示例 1 的输出是美术示例 1 的输入，美术的人物、衣服和图片是导演的 cast、costumes、assets，导演示例 1 的镜头就是表演、动作、声音、场记、审片示例 1 的镜头。校验脚本会核对这些地方一字不差。

## 怎么发请求

1. 系统消息：`system_prompt` 用换行符连起来，原样发出去，没有占位符。「输出格式：」下一行是输出的 JSON 骨架，后面是字段说明和输出规则。每个提示词连同格式说明不超过 3000 字。
2. 用户消息：`JSON.stringify(input)`，结构见 `input_format.schema`。软件的 `agentRequest` 保留完整原文；桌面端对超过 100000 个 JavaScript 字符的请求明确拒绝，不会静默截断。校验脚本检查每个示例的提示词加输入不超过此预算。
3. 需要示范时，可以把 `examples` 里的输入和输出当成前几轮对话放进去。审片示例里的 `<IMAGE_n>` 没有附真实图片，只用来看结构，不要当成对话历史发出去。
4. 审片要附图（`attach_images` 为 `true`）：按 `<IMAGE_1>`、`<IMAGE_2>`…… 的顺序附上抽帧图，`attached_images` 写附了几张，最多 14 张。

回复用 `scripts/reply.mjs` 里的 `parseReply(text, output_format.schema)` 解析：整段文字只做一次 `JSON.parse`，带代码块、前后有说明文字、多了字段都算失败，不去修补。软件现有的解析器更宽松（取第一个 `{` 到最后一个 `}`），这里的示例两种都能读。

## 和软件现有解析器的对应

| 角色           | 软件里的函数                                           | 读哪些字段（都保留）                                                                                                                                                                                                   |
| -------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 编剧           | `parseWriterScenes`（`film/operations.ts`）            | `scenes[]` 的 `place`（找不到才用 `title`）、`text`、`dialogue`、`beats`、`key_event`、`time`、`title`                                                                                                                 |
| 编剧           | `parseCastReply`（同上，软件请编剧抽人物时用）         | 顶层 `characters[].name/identity`、`locations[].name/prompt`                                                                                                                                                           |
| 美术           | `artFromModel`（`film/phase2.ts`）                     | `prompt_block_zh`、`identities[].name/identity`、`locations[].name/prompt/ambience`、`props[].name/note`                                                                                                               |
| 导演           | `parseDirectorShots`（`film/project.ts`）              | `scenes[].scene_id/title` 和每个镜头的 `picture`、`action`、`size`、`tag`、`angle`、`move`、`seconds`、`purpose`、`emotion`、`performance`、`characters`、`line`、`speaker`、`delivery`、`blocking`、`facing`、`sound` |
| 表演指导       | `assignPerformance`、`noteFromRow`（`film/phase2.ts`） | 数组，每行 `shot_id`、`emotion`、`face[]`、`eyes`、`hands`、`breath`、`voice.tone/pace/pauses/emotion`                                                                                                                 |
| 动作指导       | `actionFromModel`（`film/phase2.ts`）                  | 顶层 `beats[]` 的 `text`、`feasibility`、`workaround`、`at_seconds`；每个镜头自己的节点在 `shots[].nodes`                                                                                                              |
| 审片           | `qcFromModel`（`film/phase2.ts`）                      | 顶层 `verdict` 和 `issues`（字符串数组）                                                                                                                                                                               |
| 声音设计、场记 | 软件现在没有对应的解析器                               | 字段对应 `docs/design/` 里的声音面板、任务中心和导出前检查                                                                                                                                                             |

几处要照着软件的行为写，校验脚本也会检查：

- 编剧的 `place` 照抄场次标题里的名字。`sliceNovel` 用它在原文里找这一场从哪里开始，写成店名这类先在别处出现的词会切错。
- 编剧的 `beats` 和 `key_event` 不用引号和冒号：软件把它们拼进剧本，`scriptDialogue` 会把「某某：……」和引号里的字当成台词。
- 导演的 `line` 必须是这一场原文里的原话，`lineInScript` 对不上会清空。一个镜头最多一句。
- 中景、全景、远景的 `purpose`、`emotion`、`performance`，以及表演指导那一行的表情，不写哭、泪、怒、发抖、情绪这些字：软件看到会把这个镜头改成近景。
- 表演指导的输出是 JSON 数组，和 `performance.md`、`fillPerformance` 现在要的一样。

## 共同约定

- 只输出一个 JSON 值（表演指导是数组，其他是对象）。字段一个不多、一个不少；没有内容写 `""`、`null` 或 `[]`。所有对象都是 `additionalProperties: false`，模型写进去的思考过程、分析之类的字段会直接校验失败。
- 一次处理多场、多镜头。每个角色的输入都是一批，输出按输入顺序全部写完。
- 编号：场次 `scene-1`，镜头 `scene-1-shot-7`，版本 `scene-1-shot-7-take-1`，动作节点 `scene-2-shot-17-node-1`，原文段落 `P01`（场次标题也算一段），场记问题 `CI-01`；人物、服装、地点、道具、图片分别以 `char_`、`cos_`、`loc_`、`prop_`、`img_` 开头，声音素材以 `amb_`、`sfx_`、`mus_` 开头。给人看的文字里写「第 2 场第 7 个镜头」。
- 人物：编剧给每个新人物写 `gender`（女、男、未知）和 `age_band`（儿童、少年、青年、中年、老年、未知），原文没写年龄就是未知；美术定外貌时把未知的年龄段定下来。之后各角色输入里的 `cast` 都带这两项。
- 时间单位是秒。镜头长度是 1 到 15 的整数。台词按每秒 4 个字估算，标点不算；开口不早于 0.4 秒，说完离镜头结束至少 0.6 秒。
- 参考图：视频提示词用 `<IMAGE_1>` 到 `<IMAGE_13>` 引用，一个镜头最多 13 张，按顺序编号，列出的每张都要用到。`<IMAGE_0>` 留给软件放这一镜的起始画面，所以一次请求最多 13 张参考图加 1 张首帧。模型不写 `<IMAGE_0>`，起始画面提示词只用文字。
- 衣服按段落范围定：美术给每套衣服写 `ranges`（哪一场从哪段到哪段）。换衣服发生在哪一段，那一段的镜头开头还穿旧衣服。
- 人物的固定外貌句由美术定下以后原样放进每个镜头；起始画面提示词还要原样带上此刻那套衣服的描述。
- 视频本身不出声：`video_sound` 为 `false` 时视频提示词结尾写「视频不要自己出声。」，对白、环境声、音效、配乐都另外做。
- 音量用 0 到 100，不用分贝：声音设计给每场一个总音量 `master_volume`，四层音量放在 `lanes`。
- 字符串里不用英文双引号，需要引号时用「」，免得模型漏掉转义导致解析失败。
- 人物名字、编号只能照抄输入；素材库里没有合适的声音时写 `null` 并在 `missing` 里说明缺什么，不编造。

## 软件里要注意的现有问题

这些在 `apps/` 里，这次没有改，`check-app-parsers.mjs` 会把它们列成提示：

- `attachScriptLines` 会把原文里任何引号里的字、任何「某某：」后面的字当成台词，塞进没有台词的镜头。用这本测试小说时，第一场第 1 个镜头会被加上「本店月底停业」（说话人写成「璃门上贴着一张褪色的纸条」），第 2 个镜头被加上店名「晚照书店」，第二场第 1 个镜头被加上铁棍落地声「当啷」。
- `sliceNovel` 按 `place` 切原文时，前一场会带上下一场标题的「第二场」几个字；`parseWriterScenes` 还会按回复里的顺序从 `scene-1` 重新编号，所以现在要一次把整本小说发给编剧，分批发时得按 `id` 合并。
- `isFightScene` 只看有没有「打」「刀」这类字，原文里的「打烊」「打在玻璃门上」会让第一场也去请动作指导。动作指导的提示词里写了这种场只给明显的肢体动作写轻节点。
- 一键出片时 `parseWriterScenes` 不传原文，场次正文就用编剧回复里的 `text` 和 `dialogue` 拼起来，所以这两项都要完整。

## 校验

```bash
node packages/aivora-prompts/scripts/validate.mjs
node --test packages/aivora-prompts/scripts/
AIVORA_TYPESCRIPT=/path/to/node_modules/typescript node packages/aivora-prompts/scripts/check-app-parsers.mjs
```

`validate.mjs` 依次检查：

1. 每个角色文件符合 `schema/role-file.schema.json`，正好 3 个示例。
2. 系统提示词没有占位符，不超过 3000 字；「输出格式：」下一行的骨架和输出 Schema 的字段完全一样；每个示例的提示词加输入不超过软件一次请求的 100000 字符。
3. 输入和输出 Schema 只用 `json-schema.mjs` 支持的关键字；遇到不支持的关键字直接报错，不会悄悄跳过。
4. 每个示例的输入、输出都通过 Schema，输出能被 `parseReply()` 一次解析。
5. 每个角色自己的规则，例如：编剧的台词和标准答案逐句对上，店名和拟声词不算台词，性别、年龄段和原文一致；导演的台词全部落进镜头、放得下、参考图编号合法、定妆照是此刻那套衣服；受伤部位之后只做力度 1 的动作；每个有接触的动作节点都配了音效；场记把状态表里的每个问题都报出来、没有多报；审片把软件查出的黑屏和静帧都写进问题。
6. 同一编号的示例之间数据一致。

全部通过时退出码为 0，否则为 1，并逐条列出问题。`validate.mjs` 只用 Node 自带的模块，不需要安装依赖；`check-app-parsers.mjs` 需要 TypeScript 来读软件的 `.ts` 文件，只在临时目录里转换，不改仓库。这个目录故意没有 `package.json`：加了以后 pnpm 会把它当成工作区的一个包，`pnpm install --frozen-lockfile` 需要同时更新 `pnpm-lock.yaml`。
