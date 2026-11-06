# AIVORA phase3i 审查报告

审查日期：2026-11-04。结论：**不能认为本次九项验收已经全部做对**。正常样例有修复，但长文本、段落归属、动作隔离、配音选择和首帧参考图仍有可复现缺口。

## 基线、范围与方法

- 仓库：`chen11-A/aijian-studio`。
- 远端 annotated tag：`aivora-desktop-v0.3.0-phase3i`；tag object：`37956f503ac413da9a899ad41581cf1455dec3d4`。
- peeled commit：`6efe12d411d5764277d9b1064d8bc2f83bfd0710`，与用户指定 `6efe12d` 一致。由 `git ls-remote origin refs/tags/aivora-desktop-v0.3.0-phase3i 'refs/tags/aivora-desktop-v0.3.0-phase3i^{}'` 核实。
- 从该提交建立 `gpt/audit-p3i`；只新增本报告和 `docs/audit/tests/` 下测试，不修改 apps、服务端或其他现有文件；不合并、不创建 PR。
- 已读 `CONTRIBUTING.md`、`docs/development/coding-standards.md`、`docs/development/ui-engineering-standards.md`；未发现适用的 AGENTS.md。按编剧/导演、镜头/动作/UI、配音/参考图、运行时/安全四组并行审查，主审交叉复核调用链和测试。
- 下列源码行号均相对于被审提交。**已复现**指执行原源码函数或真实校验块，并用合成输入和替代依赖断言；**静态推断**指调用路径已读但未跑完整产品；**未验证**指真实供应商、浏览器、桌面安装包、Windows 等未执行。PASS 表示复现断言成立，绝非产品验收通过。
- 本报告评估该 tag 的整体状态；未逐项做历史 bisect，不把所有现存问题都断言为 phase3i 新引入。

## 按风险排序的发现

### P1-01：异步人物提取可把 A 作品结果写入 B 作品

**已复现函数竞态，实际 UI 切换路径静态确认。** `apps/studio-web/src/aivora/pro/ProWorkspace.tsx:1343` 的 `fillCast(base)` 在 `:1353` 等待 A 的结果，`:1368` 却对当前 `filmRef.current` 做 merge，`:1375` 直接 applyLive，没有比较原作品 id。项目切换入口 `:2711`、`:2751` 可更换作品。

复现：A 请求未返回时把 filmRef 切至 B，再返回 A 的角色；真实 fillCast + mergeCast 把 A 角色加入 B。可能污染人物、声音、地点和首场地点。建议按 filmId + 请求版本校验后写回原作品，不能仅使用最新 ref。

### P1-02：模型原始响应写日志，脱敏规则不能保证不泄密

**脱敏缺口已复现，落盘调用链静态确认；没有发现或输出真实凭据。** `apps/desktop/src/grok-auth-runtime.ts:486-493` 将成功文本作为 body 记录，`:539-548` 记录供应商错误 body。`apps/desktop/src/agent-log.ts:19-31` 仅覆盖有限 token 名称、Bearer/JWT；`:38-46` 序列化，`:58` 追加日志。

合成 `apiKey` camelCase、Cookie、签名 URL 及原创小说片段均原样通过；access_token/Bearer 正向脱敏对照通过。模型回显或错误正文若含这些数据，即存在日志暴露路径；不能据此声称生产已泄露真实 token。正文记录也违反仓库“日志不得包含小说正文”规则。建议日志采用结构化白名单，仅记录长度、状态和稳定错误码，避免存储原始 body；补充脱敏不能替代数据最小化。

### P1-03：去掉 7500 截断后仍被桌面端 8000 字符校验拒绝

**原函数及生产校验块已复现，未调用真实模型。** `apps/studio-web/src/aivora/film/project.ts:509-512` 的 agentRequest 不再截断；`apps/studio-web/src/aivora/pro/ProWorkspace.tsx:1245-1250` 使用该完整字符串；`apps/desktop/src/grok-auth-ipc.ts:82-84` 原样转发；但 `apps/desktop/src/grok-auth-runtime.ts:441-447` 仍拒绝 `input.text.length > 8000`，返回 TEXT_REJECTED。

测试用真实 writer prompt 加 7500 字原文：前端保留全文，组合请求超过 8000，生产 guard 拒绝。8000/8001 边界也验证。计量是 JS 字符串长度，不等同汉字或 token。另 `apps/studio-web/src/aivora/SourceExtractionPanel.tsx:292` 仍有 `excerpt.slice(0, 7500)` 的直接文本请求：它不经过 agentRequest，应与“agentRequest 已移除”分开陈述。建议统一入口长度策略、提示词预算与可见错误，必要时分块；不能只删除前端 slice。

### P1-04：段落重建不保证完整、独占，台词检查为恒空

**已复现 parseWriterScenes 调用链。** `apps/studio-web/src/aivora/film/operations.ts:306-309` 生成 P100 等编号，但 `:348` 只接受两位数字 Pxx。`:371-386` 只要存在一组合法显式归属，就跳过所有未认领段落；`:404` 对没有 owned 文本的场返回原模型场正文。`:405` 从 text 提取引号台词，再检查是否不在同一个 text 中，missing 必然为空，不是独立校验。

三个反例：只列 P01/P02 时 P03 及其对白消失；两场重复认领同一组段落且第二场模型正文为全文时，两场最终都保留全文；100 段中 P100 被拒绝并丢失。正常完整 P01/P02/P03 归属可原样重建已通过，但不能推广至异常响应。建议先校验所有输入段落恰好归属一次，对重复、遗漏、非法编号返回明确错误；台词校验对比原文基准和最终场次集合。

### P1-05：16 镜预算只在局部块生效，重复块还产生重复镜头 id

**已复现。** `apps/studio-web/src/aivora/film/project.ts:546-549` 对小于 80 字返回 null；`:685-688` 因而不裁剪，短场实际可返回 20 镜。`:571-583` 对每个 scenes block 单独递归并直接拼接；同一长场两个块各 16 镜，最终 32 镜、16 个重复 id（`:628-632` 每块下标重起）。

建议在按最终 sceneId 聚合、唯一化 id 后施加每场硬上限，并评估裁剪导致对白丢失，不能静默截断作为完整性保证。

### P1-06：动作节点仍可跨镜，手动指导聚合所有镜

**节点函数已复现，UI 写入链静态确认。** `apps/studio-web/src/aivora/film/operations.ts:565-573` 精确 shotId 匹配正常，但未匹配时按展平节点下标回退。复现：镜1有两个 nodes，镜2没有 nodes，镜2获得镜1第二节点。`apps/studio-web/src/aivora/pro/ProWorkspace.tsx:952-955` 自动动作请求只发 story，缺少现有镜头 id/no，`:963` 使用该回退。

另 `ProWorkspace.tsx:1597` 的手动动作入口 actionSentence(parsed) 合并全部镜节点，`:1605-1612` 将全部节点作为当前镜 action/sfx；两镜响应的合并函数已复现。建议显式绑定 id，未知 id 拒绝或独立标注，手动入口也必须过滤目标镜。

### P1-07：gender/age_band 没有真正优先，声音池耗尽会跨类别

**分配函数已复现；声学年龄/性别未验证。** `apps/studio-web/src/aivora/film/operations.ts:779-782` 将 gender、ageBand 和 identity 拼成文本后匹配；`:735-755` 女词先于男词，child 先于 adult。明确“男、成年”加“女主角的丈夫”仍进入 WOMAN 池（ara）；加“照看孩子的保安”进入 BOY 池（helios）。这些是代码内分类，不把 helios 的实际声音断言为童声。

`:771-772` 为已有但缺 voiceId 的人物补声时完全忽略结构化 gender/ageBand；明确女/成年但 identity 为西装可落入 MAN 池。`:761-764` 为避免重复，池耗尽后从全体声音回退，成年男可进入 WOMAN，成人池用完可进入年轻池。建议结构化属性决定允许集合，冲突时不得被身份关系词覆盖；允许复用合适声音而非越界选择。

### P1-08：首帧生成没传参考图，唯一 HTTPS 定妆照还可能被完全丢弃

**真实 requestStill 请求体与边界函数已复现；真实出图/视频未验证。** `apps/studio-web/src/aivora/pro/ProWorkspace.tsx:222-232` 的 requestStill 接口与 `:3109-3113`、`:3135` 调用经 `apps/desktop/src/film-library-ipc.ts:190-207` 到 `apps/desktop/src/film-library.ts:616-642`，请求仅有 prompt/model 等，没有 images/reference_images。测试捕获真实函数构造的请求体证实。自动首帧 `services/api/src/aijian_api/story_film.py:899-905` 也不传 reference_images；参考图仅随后在 `:925-933` 给视频。

此外 `apps/studio-web/src/aivora/film/operations.ts:1088-1112` 可把唯一 HTTPS portrait 选为 still，并从 references 去重排除；`services/api/src/aijian_api/story_film.py:222-225` 的 _local_image 不接受 HTTPS，`:738-744` 再排除与 still 相同的 reference，在没有可复用缓存图时（`story_film.py:876-889`），最终无参考图重新生成首帧。已复现组合边界，不宣称真实服务已跑。建议统一 still/ref 可接受格式，并让首帧图像请求明确携带角色参考图。

### P1-09：文本总超时未覆盖等待响应头

**真实 HTTP 函数替代 fetch 已复现。** `apps/desktop/src/grok-auth-http.ts:541-554` 先 await fetch，收到响应后才进入带 idle/total 限制的 readLimited；传入 signal 不代表这里有自动计时。测试设 totalMs=10，fetch 延迟 35ms 仍 pending，随后手动释放响应正常结束。网络库自身限制或用户主动取消可能结束等待，但应用配置的总超时没有覆盖全过程。建议从发请求前启动统一 deadline，并覆盖头、体、重试和取消清理。

### P2-01：多场自造 id 的顺序回退并未按顺序执行

**已复现映射函数。** `apps/studio-web/src/aivora/film/project.ts:527-542` 的准确 id、唯一地点匹配存在；但找不到唯一地点且 requestedId 有效时，`:541` 先返回 requested，`:542` 的 scenes[index] 不执行。多场响应无地点、自造两个 id，会全部落到当前请求场，重复块还触发 P1-05。

需注意 `ProWorkspace.tsx:979-1005` 主入口确实只请求当前一场，此时单场回退到 requested 合理。缺陷是不能声称多场响应有可靠顺序映射。建议按请求范围决定是否允许多场，并对歧义拒绝或明确顺序映射，不跨场猜测。

### P2-02：dialogue[] 只读第一句；真实台词识别仍会吞入叙述

**已复现。** `apps/studio-web/src/aivora/film/project.ts:592-599` 使用 find 只取首条 dialogue，`:614-620` 最终只有单个 line；同镜两句、无空镜可补时第二句消失。`apps/studio-web/src/aivora/film/phase2.ts:131-132` 已知姓名冒号模式取整行，`林骁：走吧。随后他转身离开。` 被挂成包含后半叙述的台词；`:106-107` 去尾标点，不能称台词逐字保留。

`phase2.ts:151-158` 的 attachScriptLines 不清理已有虚构 line，测试已确认；但导演入口 `project.ts:620` 先调用 lineInScript，不能把辅助函数反例直接等同完整入口绕过。该校验 `phase2.ts:100-103` 也仅判断子串，未判断是否是说话。建议以显式对白结构承载多句并验证说话人及来源跨度。

### P2-03：hold_s 的带分隔符形式仍在 UI 原样出现

**转换函数已复现，显示路径静态确认。** `apps/studio-web/src/aivora/film/phase2.ts:391-392` 能处理 hold_seconds: 1、hold_s 1，但不处理 hold_s: 1、hold_s=1；`apps/studio-web/src/aivora/film/project.ts:641` 存 performance 后，`apps/studio-web/src/aivora/pro/ProWorkspace.tsx:4990` 显示、`:5355` 填表仍保留原字段。建议按结构化 schema 生成可读文本，并覆盖 null、冒号、等号等输出；未进行浏览器截图验收。

### P2-04：补充阶段吞异常，编剧拒绝 Promise 可残留忙碌状态

**真实函数加替代 UI 状态已复现，不是浏览器 E2E。** `apps/studio-web/src/aivora/pro/ProWorkspace.tsx:1470-1526` planWriter 在 pushTurn 后等待 completeAgent，无 try/finally；Promise reject 时 finishTurn 不执行，asking 保持 true。fillPerformance 的 `:937-938` 失败后返回原 shots、fillFight 的 `:972-973` catch/continue 均可让用户看到导演完成（`:1019-1022`）但补充工作未完成；后者为静态确认。建议失败显示具体阶段、保留可重试状态、finally 释放忙碌状态。

### P2-05：Windows 导出保留设备名未处理

**名称函数已复现，Windows 实际导出未验证。** `apps/desktop/src/film-library.ts:686-690` safeExportName 保留 CON、NUL、COM1、LPT1，输出对应 .mp4 名称。建议处理保留设备名及尾点/空格，并用 Windows 实测路径矩阵。此处不把 Linux 函数测试称为 Windows 文件写入复现。

## 九项要求逐项结论与正向证据

| 要求                                   | 结论、文件行号与证据                                                                                                                                                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 段落编号/独占/重建/台词逐字          | 部分实现，整体不通过。operations.ts:300-317 编号、:519 调用重建；正常三段原样通过，P1-04 反例证明异常归属不安全，:405 校验恒空。                                                                                                                       |
| 2 全部去除 7500                        | project.ts:509-512 与 ProWorkspace.tsx:1247 的 agentRequest 路径已不截断；全仓仍见 SourceExtractionPanel.tsx:292 的独立 7500 路径，桌面 8000 guard 使长请求不可用，见 P1-03。                                                                          |
| 3 导演兼容/映射/预算                   | video_prompt（project.ts:600-607）、blocking[]（:646-662）已复现正常；dialogue[] 仅首句，P2-02；准确 id 与唯一地点静态存在，顺序回退 P2-01；每场16上限 P1-05。                                                                                         |
| 4 台词/标题/打烊/中景                  | attachScriptLines 不能保证只挂真实台词，P2-02。标准下一场标题切分 operations.ts:268-278 已复现不越界，非标准标题未穷尽；isFightScene :532-535 已复现打烊=false、打斗=true；phase2.ts:36-43 中景保留已复现，project.ts:611-616,635 赋值链无静默改近景。 |
| 5 每镜自己的 nodes                     | 精确 id 正向通过 operations.ts:565-567；回退和手动入口不通过，P1-06。                                                                                                                                                                                  |
| 6 配音属性/现有音色/成人与性别         | 结构化优先与隔离不通过，P1-07。operations.ts:26-55 的28个默认 id 均能在当前 xAI 官方 TTS Voices 表找到，见下方外部证据；实际账号目录和声音听感未验证。                                                                                                 |
| 7 UI 无原始字段                        | 常见格式部分转换成功，带分隔符 hold_s 不通过，P2-03。                                                                                                                                                                                                  |
| 8 13参考图+首帧/首帧带图               | operations.ts:1103-1112 独立 still + 13 refs 正向已复现；story_film.py:254-262 对1.5=13、classic=7、lite=0 已复现，不是所有模型均13。首帧未携图、HTTPS still 丢弃见 P1-08。                                                                            |
| 9 异常/超时/竞态/Windows/未用代码/日志 | P1-01/02/09、P2-04/05。operations.ts:16 PORTRAIT_REASON 在 apps/services 中仅声明、未见运行引用（静态检索），属低风险清理项，不把无引用直接当运行缺陷。未扫描或读取用户真实凭据文件。                                                                  |

表格中省略前缀的 operations.ts/project.ts/phase2.ts 均位于 `apps/studio-web/src/aivora/film/`；ProWorkspace.tsx 位于 `apps/studio-web/src/aivora/pro/`。外部证据：[xAI 官方 Text to Speech 文档的 Voices 表](https://docs.x.ai/developers/model-capabilities/audio/text-to-speech)，于 2026-11-04 核验当前列表；当前文档不能证明历史 tag 发布时的服务状态，也未提供足以证明每个声音实际年龄/性别的结构化元数据。

参考图视频发送链的补充静态证据：`apps/studio-web/src/aivora/film/operations.ts:1216-1219` 发独立 still/references（draft 省略 refs）；`apps/desktop/src/story-film-client.ts:238-249` 限制13，`:312-315`、`:331-333` 保留字段；`services/api/src/aijian_api/story_film_routes.py:73-97`、`:326-328` 校验并传递；`services/api/src/aijian_api/story_film.py:1094-1114` 调用视频 client；`services/api/src/aijian_api/xai_media.py:153-163` 分别填写 image/reference_images。真实供应商接受13+1未验证。

其他边界：`apps/desktop/src/film-library.ts:141-156`、`:268-269` 有写入串行队列，`:343-363` 有路径根目录/realpath等检查，不能笼统说全部保存竞态或路径防护失效。`:301-334` 删除/重命名未加入同一队列的交错行为，以及 `ProWorkspace.tsx:1789-1806` planPrompter 等待后使用旧 film 的覆盖风险，仅作静态线索，未复现，不另计入上述风险清单。

## 可重复测试与执行结果

所有夹具均为原创合成文本及明确虚构凭据标记；不调用付费服务、不输出秘密。测试从被审源码抽取函数/校验块，TypeScript 转译或 Node 类型擦除后执行；Python 图像边界通过 AST 抽取真实函数。替代的是网络、UI 状态和文件依赖，不是被测算法。

环境：Linux，Node v24.19.0，pnpm 11.19.0，TypeScript 5.9.3（隔离安装到 /tmp，未改仓库依赖）。从仓库根目录运行：

```sh
# 若仓库未装 TypeScript，可隔离安装；不改仓库 lockfile。
npm install --cache /tmp/p3i-npm-cache --prefix /tmp/p3i-audit-deps --no-package-lock --ignore-scripts typescript@5.9.3
export P3I_TYPESCRIPT=/tmp/p3i-audit-deps/node_modules/typescript
node --disable-warning=ExperimentalWarning docs/audit/tests/p3i-script-director.mjs
node docs/audit/tests/p3i-shot.mjs
node --test docs/audit/tests/p3i-runtime.mjs docs/audit/tests/p3i-voice-refs.mjs
```

| 文件                          | 结果               | 范围                                         |
| ----------------------------- | ------------------ | -------------------------------------------- |
| tests/p3i-script-director.mjs | 10/10 PASS         | 段落、台词丢失、映射、预算、8000 guard       |
| tests/p3i-shot.mjs            | 11/11 PASS         | 6项正向与5项缺陷行为断言                     |
| tests/p3i-runtime.mjs         | 7/7 PASS           | 日志、超时、竞态、异常、Windows 名称         |
| tests/p3i-voice-refs.mjs      | 9/9 PASS           | 配音、13+1、首帧请求、HTTPS still            |
| 总计                          | **37/37 断言通过** | 包含证明缺陷存在的断言，不是37项产品验收通过 |

仓库规定的 `pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 均已尝试，均 exit 1：依赖未安装，pnpm 自动初始化 `/home/agent/.local/share/pnpm` 时 ENOENT，尚未进入相应检查。没有把这些结果称为产品测试失败或通过；也未为跑全量检查修改现有文件。`contracts:check` 会重写现有契约文件，与只新增审计文件限制冲突，未运行。真实浏览器/桌面、真实模型账号、声音试听、Windows 导出与完整仓库门禁仍待验证。

## P0 / P1 / P2 清单

- **P0：未确认。** 不代表证明不存在，也没有真实凭据泄露证据。
- **P1（9项）：** 跨作品竞态污染；原始响应日志与脱敏缺口；8000请求拒绝；段落遗漏/重复/台词校验失效；16镜预算与重复id；动作跨镜；配音结构化属性/类别失守；首帧缺参考图及HTTPS still丢失；等待响应头无总超时。
- **P2（5项）：** 多场未知id不按顺序映射；多句对白丢失及叙述误挂；hold_s原始字段；异常吞掉/编剧忙碌残留；Windows保留设备名。

建议先修数据完整性与跨作品写回、日志最小化，再补齐长请求和生成链路；将这些缺陷复现改为期望正确行为的回归测试后，执行真实桌面/供应商与Windows验收。
