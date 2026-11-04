（以下整段贴给 GPT。这份替换之前发的 3j 任务书，之前已经做完的项照样按编号报告。）

# AIVORA 阶段 3j：后端和逻辑任务书（GPT）

## 基本要求

- 仓库 chen11-A/aijian-studio，分支 `gpt/aivora-p3j`，从 tag `aivora-desktop-v0.3.0-phase3i`（提交 6efe12d）开。不合并 main，不开 PR 到 main。
- 只用 Grok 会员，不接按次付费服务。
- 新分工：你负责所有后端和逻辑（services/api、apps/desktop、apps/studio-web/src/aivora/film/*.ts、智能体提示词和解析、ffmpeg、打包、测试），并负责把 Claude 的界面 zip 合进分支。界面显示、样式、文案归 Claude。
- ProWorkspace.tsx 两边都会改：你只改第 449–2607 行的状态和处理函数，以及第 1–448 行里的 requestStill 等逻辑；第 2608 行以后的渲染部分和各页面组件归 Claude。需要界面配合的，在 `apps/studio-web/src/aivora/next/INTEGRATION.md` 写清你提供的数据和函数。
- 你自己的审计报告 `gpt/audit-p3i@f9734de:docs/audit/p3i.md` 里的 9 个 P1、5 个 P2 都在下面的条目里，把那 37 条“证明缺陷存在”的测试改成“期望正确”的回归测试。
- 用户界面上任何提示都不要直接写长句，改成返回 `{code, text}`（见 3J-B17），文案由 Claude 定。

## 必须修（按编号报告）

**3J-B01（P0）每场结尾被截掉。** 实测第 1 场停在「但我得还」，「你来晚了」、照片、刹车声没有镜头；第 2 场停在刀划过去，周烈逃跑和警笛没有。原因：`film/project.ts:685-686` 用 `slice(0, budget)` 丢掉超出的镜头；上限只按块算（`:571-583`），重复块产生 32 镜和重复 id（`:628-632`）；短于 80 字不限（`:546-549`）。做法：目标镜头数（每 40–60 字 1 镜，每场 ≤16）写进导演请求，让导演合并节拍；超了就按场合并块、重编唯一 id、合并相邻镜头（保留台词），绝不丢尾；每场做原文覆盖检查（最后一句台词和最后一句叙述必须在某个镜头里），不合格自动再请导演只补结尾一次，仍不行就返回 `coverage = {sceneId, ok:false, lastLine, missingLines, missingTail}` 给界面。

**3J-B02（P0）打斗动作贴错镜头。** 实测「报警？」镜头带着挥铁棍，林晚说话的镜头写着沈砚脱外套。原因：`film/operations.ts:565-573` 的 `beatsForShot` 按序号回退；`ProWorkspace.tsx:952-955` 请动作指导时没发镜头 id；手动入口 `:1597`、`:1605-1612` 合并所有镜头。做法：请求里带每个镜头 `{id,no,景别,画面一句话,台词}`，只按 id 回写；删掉序号回退；对不上的放 `film.unassignedBeats=[{sceneId,text}]`；纯对话镜头不接打斗动作；手动入口只取当前镜。

**3J-B03 「。。保留原文：肘击」出现在画面描述里。** 原因：`operations.ts:552-556` `keepFightDetails`，`ProWorkspace.tsx:959-966` 写进用户字段。做法：武器和伤势词只作为发给模型的内部约束（“这一镜必须出现：铁棍”），不写进用户字段；用户字段写入前去连续标点。

**3J-B04 性别年龄存不下来，父亲林国栋配了女声 eve。** 原因：`operations.ts:686-687` 用 `Object.defineProperty(...enumerable:false)`，复制和存盘时丢失（project.json 里 7 个角色 gender/ageBand 全空）；选声 `:779-782` 拼文字再猜，`:735-755` 女性词优先，`:771-772` 补声不看性别，`:761-764` 用完跨性别。做法：普通字段 `gender:"男"|"女"|""`、`ageBand:"儿童"|"少年"|"青年"|"中年"|"老年"|""`；选角提示词必须给这两项；选声先按性别年龄限定范围，用完复用同性别，绝不跨性别；性别为空不自动配，返回 code 让界面提示用户选；用户改性别年龄后重新挑（用户手选过的声音不动）。

**3J-B05 定妆照要点两次、出一半就停。** 原因：`ProWorkspace.tsx:1416-1470` `confirmPortraits` 一次只做一个人；`:1450` 第一张失败就 break；`:1430` 设忙碌后 `:1435` “四张都有了”直接 return，没恢复忙碌，之后点击都被 `:1417` 忽略（读代码发现，请确认）。做法：新增 `makeAllPortraits()`：所有角色缺的角度排一个队列，单张失败重试 1 次，再失败记失败继续下一张，结束汇总；finally 恢复忙碌；每张出好立即存盘并推进度；保留单人补全入口。

**3J-B06 第一次点「生成画面」没反应。** 按钮 `ProWorkspace.tsx:5409` → `onStills`（`:3128-3150`）只写状态栏，不进任务列表。请定位第一次点击丢失的原因（可能和 `shownShots[shot]` 或登录状态刷新有关），出图统一走任务队列，点击 0.5 秒内要有 queued 任务，补回归测试。

**3J-B07 首帧没带定妆照。** 你的审计 P1-08：`requestStill`（`ProWorkspace.tsx:222-232`）、`apps/desktop/src/film-library.ts:616-642`、`services/api/src/aijian_api/story_film.py:899-905` 都只发文字；网络地址的定妆照在 `operations.ts:1088-1112`、`story_film.py:222-225`、`:738-744` 被丢。做法：有定妆照且用户没选首帧时，首帧用改图方式带说话人正面图优先（最多 5 张）；两边参考图格式统一；去掉首帧描述里的「<IMAGE_n> 是…的定妆照」句子；视频请求保持“首帧 + 最多 13 张参考图”。agents.log 里保留“带了几张参考图”的计数，我实测要看。

**3J-B08 导演卡住「很久没有新的字，已停止。可以再问一次。。」。** `apps/desktop/src/grok-auth-http.ts:428-429`（60 秒/5 分钟）、`:438`；总超时没覆盖等响应头（`:541-554`，你的 P1-09）。做法：卡住自动重试 1 次并返回 code `STALL_RETRYING`；两次失败才让用户点“再试一次”；总超时从发请求算起；去掉双句号。

**3J-B09 长请求被 8000 字上限拒绝。** 你的 P1-03：`grok-auth-runtime.ts:441-447`；`SourceExtractionPanel.tsx:292` 的 `slice(0, 7500)`。做法：统一长度规则，超了按场/按段分批，不截断不拒绝；编剧请求不要放两遍原文。用 7500 字原文测编剧和导演。

**3J-B10 分场不保证每段都有归属。** 你的 P1-04：`operations.ts:306-309` / `:348` 三位数段号被拒，`:371-386` 忽略未认领段，`:404` 回退，`:405` 台词检查恒空。做法：支持三位数；每段恰好一场（遗漏并到前一场、重复只留第一场，并写进 coverage）；台词检查和原文比。

**3J-B11 一镜多句台词只留第一句；叙述被当台词。** 你的 P2-02：`project.ts:592-599`、`phase2.ts:131-132`。做法：镜头加 `lines:[{speaker,text}]`（保留旧 `line` 兼容）；冒号后只取到引号或句号。

**3J-B12 场次标题是「第 1 场」。** 实测 project.json 第 1 场 title=「第 1 场」，第 2、3 场正常。兜底在 `operations.ts:113/144/151/498`、`project.ts:225`。请定位这次编剧为什么没给或没读到标题；兜底改成“地点 · 时间”，不再用「第 N 场」。

**3J-B13 跨作品写错和忙碌卡住。** 你的 P1-01、P2-04：`ProWorkspace.tsx:1343-1375` `fillCast` 不核对作品 id；`:1470-1526` `planWriter` 无 finally；`:937-938`、`:972-973` 吞错误。做法：写回前核对作品 id 和请求序号；全部 finally；失败返回是哪一步。

**3J-B14 日志写进原文。** 你的 P1-02：`grok-auth-runtime.ts:486-493`、`:539-548`，`agent-log.ts:19-31`。日志只记长度、状态、耗时、错误码、参考图张数；调试开关默认关。

**3J-B15 小问题合集。** hold_s 带冒号/等号原样显示（`phase2.ts:391-392`、`project.ts:641`）；多场自造 id 全落到当前场（`project.ts:527-542`）；Windows 保留名 CON/NUL（`film-library.ts:686-690`）；「（来自表演指导）」写进了视频描述和镜头文字（改成只存来源字段，界面用小标签）。

**3J-B16 合入 Claude 的交付。** ① `aivora-next-components.zip`（SHA-256 0a73fd2f9c0ee88a222fc45f9db67f76c025f12aff8a12254042daa5a23ee394，42 个文件，全在 `apps/studio-web/src/aivora/next/`）原样一个提交；② Claude 接下来会交 3j 界面 zip（改 ProWorkspace.tsx 渲染区、pro.css、next/ 适配层、docs/design/copy-zh.md、docs/qa/acceptance-3j.md），先核对 SHA 再合，一个 zip 一个提交，提交说明写 SHA；冲突由你解决并写明。zip 由用户转给你。

**3J-B17 给界面准备接口（写进 next/INTEGRATION.md 的“已提供”栏）。**

- 任务进度：`window.aijian.onTask(cb(tasks: TaskItem[], batches: BatchProgress[]))`，`TaskItem` 与 `next/TaskCenter.tsx` 一致，kind 增加 `"lipsync"`、`"export"`；`BatchProgress = {batchId,label,done,total,failed,running}`。每个任务最终必须落到 done 或 failed。
- 提示代码：所有给用户的提示改成 `{code, text, detail?}`，列出全部 code 和现在的中文（含 `story_film.py:1306` “草稿成片已经保存…”、`shot_plan.py:17` “…不是实拍”这类，交给 Claude 改文案）。
- 人物属性（3J-B04）、原文覆盖 coverage（3J-B01）、未分配动作 unassignedBeats（3J-B02）、`fixCoverage(sceneId)` 函数。
- 只写类型、先不实现：导出检查报告（沿用 aivora-qc v1）+ `ShotSpan[]`；四层声音 `sound={mood,master,lanes:{dialogue,ambience,sfx,score},duckMusic}`；版本 `TakeOption` + `aiChoiceId`；口型 `take.lipSync: "none"|"pending"|"done"|"failed"` + `lipSyncReason`；一键成片 `pipeline.steps[]`；场记 `shot.continuity[]`。
- 字幕样式 id 统一为 `white / bar / yellow / film`：4b 时把 `aivora-media/subtitles.mjs:1` 的 `variety` 换成 `film`（小一号字、柔和阴影），这次先在类型里定下来。

## 不要做

- 不改界面样式和文案（交给 Claude）；不改 next/ 组件内容。
- 不做 4a/4b 的功能（一键成片全流程、口型、声音混合），只准备接口。
- 不用按次付费服务；不碰 main。

## 交付和报告格式

1. tag：`aivora-desktop-v0.3.0-phase3j`，附提交号。
2. Release 里放 `AIVORA-Desktop-0.3.0-linux-x64.tar.gz` 和 `AIVORA-Setup-0.3.0-win-x64.exe`，报告两个文件的大小和 SHA256。
3. 已修/未修表：每行“编号 | 状态（已修/部分/未修）| 改了哪些文件:行 | 对应测试名 | 备注”，覆盖 3J-B01 到 3J-B17。
4. 检查结果：eslint、prettier、tsc、vitest（desktop 和 studio-web，附覆盖率）、ruff、mypy、pytest；注明哪些失败是原来就有的。
5. 合入的 Claude zip 的 SHA 列表。
6. 你认为我实测时要特别看的地方（最多 5 条）。
