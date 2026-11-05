# 3JR 后端验证记录

固定代码：`c3cd585b6932893bca95640ca94de3f30ab57cd9`（2026-11-05 UTC）。其后的 `70c4cfa` 只补文档。逐项状态与代码提交见[任务书](给GPT的任务书.md)的“3JR 实测问题修复记录”。没有真实会员调用、没有合并界面、没有阶段发版。

| 检查                     | 结果                                        | 证据                             |
| ------------------------ | ------------------------------------------- | -------------------------------- |
| web全量                  | 4217通过、1失败、0跳过；324个文件，353.19秒 | `/workspace/jr-web-final.log`    |
| 全仓TypeScript           | contracts、desktop、studio-web均通过        | `/workspace/jr-final-types.log`  |
| 全仓ESLint               | 通过                                        | `/workspace/jr-final-eslint.log` |
| 全仓Prettier、Python格式 | 通过；558个Python文件格式正确               | `/workspace/jr-final-format.log` |
| Python相关回归           | 32通过、0失败、0跳过，61.36秒               | `/workspace/jr-python-final.log` |
| ruff                     | 通过                                        | `/workspace/jr-ruff-all.log`     |
| mypy                     | 310源文件通过                               | `/workspace/jr-mypy-all.log`     |

web唯一失败为 `next/wiring/noticeCopy.test.ts > has a line for every code GPT can send`：当前分支缺102个映射，其中101条已在Claude的48a5825交付但未合并；另1条是本轮新增的 `LOCATION_SOURCE_REQUIRED`。没有跳过或弱化这个检查。此次使用 `vitest run --coverage`，失败后没有生成覆盖率报告，故不报告本轮覆盖率或宣称门槛通过。

本轮没有重跑desktop或Python全量。此前desktop 2001通过、Python 5138通过/6跳过属于旧固定提交，只保留历史证据；Python本轮更改了导出返回字段和导演提示词，不能把旧全量当成当前全量。32项包括 `test_story_film.py`、`test_film_agents.py`、`test_director_source_grounding.py`。有真实本地ffmpeg生成/校验，但供应商回复由测试替身提供。

首轮web日志 `/workspace/jr-web-full.log` 为收尾变更期间的运行：4213通过、4失败，保留为诊断记录；最终固定重跑不拼接该结果。Python首次命令因默认uv缓存目录只读未开始测试，随后使用可写的 `UV_CACHE_DIR=/workspace/.cache/uv` 正常执行；没有绕过权限限制。

尚需实际材料：这次实测的project.json及导演/动作原回复，以核实19/21镜、19个动作与错误尾段；已登录会员环境以验人物、场景画面和单场四分钟成功率。现有小说已核实，不臆造缺失的角色年龄或原文没有的停车事件。镜头上限与内容完整性冲突时仍保留内容并报告风险，未硬截断。

后续增量另附相关验证，不冒充包含在本次固定提交全量中：B08的场景前置失败队列终态补修与4A-B10导出协调仍在继续。

## 后续 B08 增量

`6b71655`：场景准备失败时只结束本批尚未派发的视频任务，保存failed及interruptedFrom=queued，保留其他批次/运行中/已完成项。队列相关10项通过；新增实际工作台场景失败→无视频请求→队列落盘终态的回归通过。

最新 B08 完整工作台与场景/队列相关4文件111项通过，0失败/跳过（`/workspace/jr-b08-host-recheck.log`）。此前与导出测试合跑的一轮136通过/1失败，为“使用上一镜尾帧”等待视频调用超时；该两用例未改代码或放宽超时，单独复跑2通过、随后完整工作台通过。保留`/workspace/jr-4a-host-final.log`及`/workspace/jr-b08-last-frame.log`，不将一次复跑通过当作已定位偶发超时原因。

4A导出协调`ac0a989`已在收到“优先3JR”的追加指令前完成推送；后续4A开发已暂停，相关31项web、14项desktop（真实本地ffmpeg）通过。该增量不是上表c3cd585固定全量的一部分。

## 本轮 B02 / B18 / B19 固定代码验证

代码基线 `6cb8cd4`（后续至 `30f36eb` 仅文档），完整 web：**4282通过、1失败、0跳过**，330文件，369.04秒。唯一失败仍为 `next/wiring/noticeCopy.test.ts` 的102条映射缺口（101条已由Claude交付尚未合并，另1条LOCATION_SOURCE_REQUIRED需补齐）。本轮没有其他失败；此前中止运行和偶发宿主等待超时记录保留，不据此虚称已定位其根因。

`/workspace/jr-current-full.log` 保留完整结果；本次启用 `--coverage.reportOnFailure`，覆盖率为语句90.95%、分支87.37%、函数92.90%、行93.52%，未报告覆盖率门槛失败。测试整体仍因文案检查失败而exit1，不能写为全绿。没有跳过、弱化测试或放宽超时。

全仓TypeScript、ESLint、Prettier通过：`/workspace/jr-current-types.log`、`/workspace/jr-current-eslint.log`、`/workspace/jr-current-format.log`。B02相关44项、B18相关63项、B19相关43项均通过，属于相交的回归集合，不将它们累加为独立测试总数。本轮没有额外修改Python或desktop源代码，也未重跑其全量；此前相关验证见上文。

用户最新分工已同步交接文档：2d7acb7、d894dc3由用户摘入claude/work；9d89db8、5ba2b82由另一个会话处理4A-U09/U11。GPT不从旧界面分支重复合并这四笔提交。没有真实会员验收、没有阶段合并或发版。

持续核查新增4c16472（交替对白压缩）、87354e7（少年年龄存盘）、91dcced（修复回复新增情节保护）。逐项B01–B10矩阵已写回任务书。21/23/78/54项相关回归通过（范围有重叠），web tsc与目标ESLint/Prettier通过；没有重跑本轮增量后的完整web，不能借用6cb8cd4全量数作为当前提交结果。真实会员验收边界保持。

### 生产入口持续核对（优先于上文历史状态）

- B01：`8992ed3` 修正 `4c16472` 的问题。实际视频契约只有每镜一个声音（`operations.ts:oneShot`），交替说话人合并虽保留了文字，却导致MULTI_VOICE_REQUIRED。现恢复相邻同说话人保护，并阻止模型压缩新建多说话人镜头；原始完整草稿保留及超限提示继续。31项相关通过，新增实际storyFilmBatches可提交断言。不能再把4c16472写成有效的多说话人压缩方案；多说话人压到16与当前声音契约的冲突仍未完成，不能通过丢台词解决。
- B08：`8e40637` 修复流水线单镜出图默认前序场景图已完成的漏洞。现在makePipelineStill也先调用prepareShotSceneReferences，缺失或过期则生成、保存，再基于最新工程出图。15项通过，生产适配回归核对同一保存场景URL进入firstFrameReferences和storyFilmBatches.references；默认桌面适配仍会把本地图片转成可发送图像。测试供应商是替身，不证明用户四场图片实际生成正确或服务端接受了所有图片。此前首次新用例因手写URL格式错误失败，修正为实际aivora-media://local/格式后通过，日志保留。
- B09：`14fae1a` 修复手动重试已解析初稿在补充超时时丢失的问题，返回partial初稿并明确标明补充未完成。17项截止/重试回归通过，另3项宿主定向通过（同文件96项未选运行）。旧测试原期望丢弃初稿，现改成保留特定原画面及partial断言，保留截止/取消/清理断言。首次类型检查发现新测试Promise泛型缺失，已修后web tsc通过。

当前四分钟保证的范围：客户端同一场请求、重试、补尾/补充共用240秒截止，信号传递、停止继续等待并屏蔽迟到结果；普通JavaScript计时器仍受事件循环调度影响，不能承诺硬实时，也不能承诺远端供应商已停止执行或会员一定在四分钟内成功生成。真实成功耗时、出图人物/场景正确性及19条动作分配仍需用户实际工程/回复和登录会员环境；小说并不缺失。

本轮证据：/workspace/jr-b01-video-final.log（31通过）、jr-b08-pipeline-final.log（15通过）、jr-b09-retry-verified.log（17通过）、jr-b09-host.log（3通过/96未选）、jr-runtime-types-final.log（通过）、jr-runtime-lint.log（通过）、jr-runtime-format.log（通过）。没有把定向测试冒充当前全量。B02/B03/B04/B05/B06/B07/B10的提交与未完成边界仍见上表，B18/B19本轮已修代码保持。尚未整合Claude或阶段发版。
