# 替换版 3j 任务书：当前差异与交接

本文是收到替换任务书时的差异快照，保留用于说明变更依据；下面的状态不是当前交付结果。新版实现与回归现已继续推进，最终状态以 delivery.md 为准。新任务已授权 services/api，旧报告中的 services 授权问题不再成立，无需再次确认。用户最新要求只提交并推送分支，已取消 tag、Release 和安装包发布。

## 保存状态与文件可用性

- 固定基线仍为 `6efe12d411d5764277d9b1064d8bc2f83bfd0710`，分支 `gpt/aivora-p3j`。
- 已推送代码提交：`4fbbf8bbc7b736c100acb67c9fc362281ef59ffb`。
- 本地验证记录提交：`86bb725`。其 push 被 GitHub 返回 `Internal Server Error` 拒绝；已重新读取远端，确认仍是 `4fbbf8b`。没有盲目重试。
- 本文及历史报告的新任务提示保留为未提交文件变更；没有丢弃既有本地提交或修改。
- 未创建 phase3j tag，未发布 release，未改 main，未合并或创建 PR。
- 真实测试小说存在，SHA-256 `acaba10e8752d4730be1391682a3bbc77e6fd37308e545303dba951c28f31b9e`。
- 指定组件 ZIP 仍未找到，无法验证 `0a73fd2f9c0ee88a222fc45f9db67f76c025f12aff8a12254042daa5a23ee394` 与 42 文件。新的界面 ZIP 也尚未提供；已合入 Claude ZIP 数量为 0。
- `/workspace/audit/p3i/` 不存在，不能声称已核对其 project.json、findings-part1.md 或截图 01–26。
- `apps/studio-web/src/aivora/next/` 目前不存在，TaskCenter.tsx / qcReport.ts 实物尚未核对。任务书中的类型可作为准备依据，但不能冒充已导入组件。

## 分工边界

旧任务已授权并产生 ProWorkspace 渲染区、pro.css、提示文案和浏览器布局脚本修改，这些成果在 `4fbbf8b` 中保留，不冒称 Claude 的交付。旧基线渲染区修改包括 onStills 接线、Assistant、CastPage、BoardPage 和导出路径展示；收到 Claude ZIP 后需逐项解决冲突，不能整文件覆盖逻辑。

后续 GPT 仅修改基线所指逻辑区、requestStill 等逻辑、film 领域、desktop、services 和测试；Claude 负责渲染、CSS、文案及组件。以 `6efe12d` 的区段和函数名定位归属，不把修改后漂移的绝对行号误作权限边界。新接口文档写入 `next/INTEGRATION.md`，仅把实际可调用的接口列为“已提供”。

下面缩写：`film/` = `apps/studio-web/src/aivora/film/`；`pro/` = `apps/studio-web/src/aivora/pro/`；`desktop/` = `apps/desktop/src/`。行号对应当前 `86bb725` 工作树。

## B01–B17 对照

| 编号   | 状态 | 现有文件:行                                                                          | 对应已通过测试                                                                                                                                                                    | 与新要求的差异 / 备注                                                                                                                                                                                                                             |
| ------ | ---- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3J-B01 | 部分 | film/project.ts:555                                                                  | `uses the actual repository novel and preserves every paragraph, quoted line and ending`；`retains over-budget shots and assigns unique ids after repeated scene blocks`          | 已取消截断、合并场块、唯一 id、请求强调完整性；目前缺失原文附加来源镜头，示例为 29/39/29 镜。未实现相邻镜头合并、结构化 coverage、自动补尾一次、fixCoverage。                                                                                     |
| 3J-B02 | 部分 | film/operations.ts:581；pro/ProWorkspace.tsx 的 fillFight / planAction               | `never moves another shot's node by position`；`preserves the target shot ids of flat action beats`                                                                               | 已删除位置/镜号回退，请求带 id，手动仅取目标镜；现在无 id 仍按原文重叠匹配。新版要求只按 id，需要取消该回退、持久化 unassignedBeats、拒绝纯对白镜头的打斗动作。                                                                                   |
| 3J-B03 | 已修 | film/operations.ts:568；film/phase2.ts:418                                           | `never moves another shot's node by position`；plainCue 边界回归                                                                                                                  | 不再把“保留原文”修复说明追加给首镜；清理连续句号，内部约束不写用户字段。后续 B02 请求改造继续保持此边界。                                                                                                                                         |
| 3J-B04 | 部分 | film/project.ts:106；film/operations.ts:847                                          | `serializes reply traits and fills existing characters from source`；`prioritizes structured traits and reuses the proper voice category`                                         | 已普通字段存盘、原文推断、结构化优先、同类复用。仍为可选 string 与旧英文值；须迁移到指定中文枚举、空性别不自动配音、编辑属性后重选并尊重手选锁定。                                                                                                |
| 3J-B05 | 部分 | pro/workflow.ts:32                                                                   | `attempts every missing portrait, preserves successes, and retries only failures`                                                                                                 | 已一键、尝试所有缺失角度、失败继续、逐张写入、finally 清忙。缺 makeAllPortraits 统一全人物队列、单张自动重试 1 次、BatchProgress 汇总。                                                                                                           |
| 3J-B06 | 部分 | pro/ProWorkspace.tsx 的 generateStills；pro/workflow.ts:164                          | 浏览器 `first image click invokes bridge exactly once and displays card progress`                                                                                                 | 首击和卡片反馈已真实浏览器验证；目前是局部 stillProgress，不是 TaskItem 队列，也未实现 0.5 秒 queued 契约。                                                                                                                                       |
| 3J-B07 | 部分 | desktop/film-library.ts:645；pro/workflow.ts:164；desktop/story-film-client.ts       | `includes each reference in the actual image editing request`；`sends a first-frame request with references from every visible person and discloses the five-image limit`         | 桌面改图带最多5张，视频13+首帧；HTTPS 肖像保留，客户端阻止无有效首帧旁路。服务端直调仍未修，尚需说话人正面优先、IMAGE_n 句清理和参考图计数日志。现已有 services 授权，可继续完成。                                                                |
| 3J-B08 | 部分 | desktop/grok-auth-http.ts:683；pro/workflow.ts:6                                     | `retries a stalled director exactly once and reports progress`；`times out before headers even when the transport never settles`                                                  | 总 deadline 与一次重试已实现；当前用 TEXT_TIMEOUT 和字符串进度，尚需 STALL_RETRYING 的结构消息、统一短句/标点。                                                                                                                                   |
| 3J-B09 | 部分 | desktop/grok-auth-runtime.ts:443；SourceExtractionPanel.tsx:292；film/project.ts:509 | 完整 8100 字来源发送回归；runtime 长请求边界；project 请求完整性                                                                                                                  | 已取消7500截断、放宽到100000；仍会超限拒绝，未做按场/段批处理；须移除编剧上下文重复原文，并增加规定的7500字编剧/导演用例。                                                                                                                        |
| 3J-B10 | 部分 | film/operations.ts:415                                                               | `round trips P100 and later paragraphs`；`rejects missing, duplicate, and invalid paragraph ownership without writing partial scenes`                                             | 支持 P100，避免静默丢失；当前遗漏/重复直接拒绝。新版要求遗漏并前场、重复保留首次并记录 coverage，现有反例测试需要据此更新。                                                                                                                       |
| 3J-B11 | 部分 | film/project.ts:605；film/phase2.ts 的 lineInScript / extractScriptLines             | `keeps both dialogue entries and punctuation without narrating a trailing action`；`keeps explicitly attributed unpunctuated dialogue without treating names or sounds as speech` | 当前 dialogue[] 展开成多个镜头，尚无 lines:[{speaker,text}] 及旧 line 兼容迁移；解析需按补充边界区分引号内多句与引号外叙述。                                                                                                                      |
| 3J-B12 | 部分 | film/operations.ts 分场解析；film/project.ts 场次创建                                | 真实小说三场标题回归                                                                                                                                                              | 已恢复“雨夜旧书店”；尚未把全部“第 N 场”兜底统一为“地点 · 时间”，也未拿到用户 project.json 来确认此次原始回复。                                                                                                                                    |
| 3J-B13 | 部分 | pro/ProWorkspace.tsx:1325、1426                                                      | `discards a cast extraction that returns after switching to another project`；`releases writer busy state after a rejected request and permits retry`                             | 指定 fillCast/planWriter 缺陷已修，补充失败可见、旧 scope 响应丢弃；新版“全部 finally”与逐阶段 code 需扩展检查所有异步入口。                                                                                                                      |
| 3J-B14 | 部分 | desktop/agent-log.ts:91；desktop/grok-auth-runtime.ts                                | `persists metadata only, never provider bodies, credentials, or novel prose`                                                                                                      | 原文/供应商正文已不落盘，日志仅白名单元数据；尚缺 referenceImageCount 和默认关闭的调试模式契约。                                                                                                                                                  |
| 3J-B15 | 部分 | film/phase2.ts:418；film/project.ts:527；desktop/film-library.ts:731                 | hold 空值/非法值回归；多场映射回归；Windows 设备名矩阵                                                                                                                            | 前三项已修；ProWorkspace.tsx:882、1651 仍往文字添加“（来自表演指导）”，须改为来源字段。Windows 原生安装验收仍未完成。                                                                                                                             |
| 3J-B16 | 未修 | ZIP 缺失                                                                             | 无导入测试                                                                                                                                                                        | 组件 ZIP 与后续界面 ZIP 都未导入。按新清单核验 SHA、42文件、路径、覆盖范围；原样导入和适配修复必须区分提交。                                                                                                                                      |
| 3J-B17 | 未修 | next/ 尚不存在                                                                       | 无新版接口契约测试                                                                                                                                                                | 尚无 window.aijian.onTask / TaskItem / BatchProgress / 统一消息 / coverage / unassignedBeats / fixCoverage；需建立已提供与仅类型声明的分栏，不实现4a/4b功能。字幕类型固定 white/bar/yellow/film，旧 variety 约定作废；实际 media 模块替换留到4b。 |

## 验收边界与取舍

1. B01 比对**全部台词**并检查尾段，不能只验最后一句；16镜是目标，合并仍无法满足时保留内容并返回提示，不允许截掉剧情。现有真实小说回归已经覆盖全部引号文本与各段，后续要对新的 lines/coverage 接口加强断言。
2. B11 引号内合法多句对白完整保留，不能在第一个句号截断；只对引号外叙述实施边界识别。
3. B14 默认日志不记录小说、提示词或完整画风。可以记录参考图张数与长度/耗时/状态；4a“完整画风入日志”的条款与隐私边界冲突，暂不实施。
4. 不调用按次付费服务；本轮未调用任何真实生成供应商。现有遗留 provider 分支还需按“只用 Grok 会员”的新约束审视，不能把没有新增付费调用等同全部入口已收口。
5. 新任务中的 UI 展示标准不能由旧版截图或旧版测试代替。Claude ZIP 未到，不能宣称新的 U01–U17 已验收。

## 实际检查结果（旧版实现，不代表新版全部达标）

- desktop Vitest：1952/1952，107文件；行92.21%、分支91.29%、函数93.36%，门禁通过。
- studio-web Vitest：3058/3058，209文件；行92.71%、分支86.54%、函数91.22%，门禁通过。
- 提示词包37/37；eslint、Prettier、tsc、ruff、mypy、构建、contracts:check 通过。
- pytest：5119通过、3失败、6跳过；3项失败是固定基线 director.md 缺 agent_version:2。覆盖率行91.94%通过，分支83.32%低于83.5%未通过。新范围已允许修复，不再作为“待授权”阻碍。
- 对源码4fbbf8b构建的Linux本地包370116293字节，SHA-256 `db00d7bef63bc2fcd31aded1ac01a8b6c9d23972b2351a22483e5fe9e6607769`；窗口health与随包ffmpeg4项通过。不是新任务的最终release。
- Windows安装包无产物、无SHA；无正式tag和release。
- 对4fbbf8b的GitHub CI #402已触发并在运行；它是Windows/Ubuntu质量检查，不是安装包工作流。

下一步先落实B17契约，再按B01/B02/B04/B05/B06/B07等重构逻辑与回归；同时修基线版本字段、核对仅会员入口。收到两份真实ZIP后核验并分别导入，处理旧UI改动与Claude渲染补丁冲突，再重新跑新版门禁。当前只做差异报告，不提前打tag或发布。
