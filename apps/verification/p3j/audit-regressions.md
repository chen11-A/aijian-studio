# phase3i 审计 37 项检查的产品回归映射

核对源：`f9734de083ae5c2bca73342fb64782269854f74e` 的 `docs/audit/tests/p3i-{runtime,script-director,shot,voice-refs}.mjs`。下表按各文件原始检查顺序编号，共 7 + 10 + 11 + 9 = 37 项。审计原来的 PASS 包含“缺陷存在”的断言；这里核对产品原生测试的正确预期，**不是新增了 37 个测试，也不是声称本轮所有测试均已通过**。

核对方法：读取测试输入与实际断言，不以测试名字或实现代码替代证明。此表的“有对应”表示找到原生测试断言；最新完整执行结果应另看本轮验证日志。较旧的运行结果不能代表正在变动的代码。37 项均已找到正确预期的原生回归；其中补齐了表演失败可见提示与手动动作隔离的组件测试，定向运行通过。最终全套结果另见 delivery.md。

路径缩写：

- `film/*` = `apps/studio-web/src/aivora/film/*`
- `pro/*` = `apps/studio-web/src/aivora/pro/*`
- `desktop/*` = `apps/desktop/src/*`
- `api/*` = `services/api/tests/*`

## Runtime：7 项

| ID  | 原审计检查                                    | 正确预期与产品测试证据                                                                                                                                                                                         | 核对               |
| --- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| R1  | named token / bearer 正向脱敏                 | `desktop/grok-auth-text.test.ts` 实际 runtime 错误响应同时含 access_token 与 bearer，读取 agents.log 断言两个虚构秘密均不出现；另 `redacts a bearer token and keeps a short status`。                          | 有对应             |
| R2  | camelCase、Cookie、签名 URL、小说正文通过脱敏 | `desktop/p3j-runtime.test.ts` → `persists metadata only, never provider bodies, credentials, or novel prose`，真实日志白名单持久化，断言不含 apiKey/Cookie/Signature/原创正文/body。采用不记录正文的更强边界。 | 有对应             |
| R3  | 等响应头不受总 deadline 约束                  | 同文件 → `times out before headers even when the transport never settles`，fake timer 10ms 后 TEXT_TIMEOUT、abort=true、零遗留 timer。                                                                         | 有对应             |
| R4  | Windows CON/NUL/COM/LPT 未防护                | 同文件参数化 `exports reserved Windows name %s safely`，保留设备名、大小写、扩展名、上标数字、尾点空格矩阵。是跨平台函数测试，不是 Windows 安装验收。                                                          | 有对应             |
| R5  | fillCast A 迟到结果写入 B                     | `pro/ProWorkspace.test.tsx` → `discards a cast extraction that returns after switching to another project`，同一挂载组件挂起请求，UI 新建 B 后返回 A，页面与保存人物保持无污染。                               | 有对应             |
| R6  | failed performance enrichment 被静默吞掉      | `ProWorkspace.test.tsx` — `reports failed performance enrichment without claiming that stage completed`：真实组件mock表演Promise拒绝，断言可见未完成警告与busy释放。                                           | **原生回归已通过** |
| R7  | writer Promise reject 后 asking 未释放        | `pro/ProWorkspace.test.tsx` → `releases writer busy state after a rejected request and permits retry`，拒绝 bridge 后错误可见，按钮不禁用，无可写入场景。                                                      | 有对应             |

## Script/director：10 项

| ID  | 原审计检查                             | 正确预期与产品测试证据                                                                                                                                                                                                                                                                                  | 核对   |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| D1  | 正常 P01/P02/P03 重建                  | `film/continuity.test.ts` → `repairs missing ownership to the preceding scene and keeps only the first duplicate with risks`：完整合法归属 coverage.ok；同测试多种归属结果拼接精确等于 source；`operations.test.ts` → `rebuilds scenes from the numbered paragraphs and keeps each line` 验证场次独占。 | 有对应 |
| D2  | P03 遗漏及台词丢失                     | 上述 continuity 测试输入仅认领 P01/P02，输出全文等于 source，标记风险。新版按缺失并前场，不再使用旧版拒绝整个回复的预期。                                                                                                                                                                               | 有对应 |
| D3  | 重复认领使下一场含整篇小说             | 同测试重复 P02 的结果只保留一次、最终原文精确相等且 coverage 风险。                                                                                                                                                                                                                                     | 有对应 |
| D4  | P100 不接受                            | `round trips P100 and later paragraphs`：105 段编号、P100 与完整原文 roundtrip。                                                                                                                                                                                                                        | 有对应 |
| D5  | 未知多场 id 全落 requested             | `maps unknown ids in multi-scene replies in requested source order`，结果 scene-1/scene-2。                                                                                                                                                                                                             | 有对应 |
| D6  | video_prompt / blocking 正向解析       | `film/project.test.ts` 构造 video_prompt 与 blocking[{who,where}]，断言 picture 保留及 blocking 含画左。                                                                                                                                                                                                | 有对应 |
| D7  | 短场 20 镜绕过上限                     | `film/continuity.test.ts` → `retains over-budget shots and assigns unique ids after repeated scene blocks`、`keeps incompatible over-budget shots with an explicit status`。新版上限是合并目标，不能用截断作为修复；不能合并则保留并显式 overBudget。                                                   | 有对应 |
| D8  | 重复 block 预算与重复 id               | 上述重复 20 镜 block 测试保留 40 个唯一 id；不可合并镜头测试验证 overBudget。                                                                                                                                                                                                                           | 有对应 |
| D9  | dialogue 数组只保留第一句              | `keeps both dialogue entries and punctuation without narrating a trailing action`，同一镜保留两条 lines，兼容 line 为两句换行拼接。                                                                                                                                                                     | 有对应 |
| D10 | agentRequest 全文但 runtime >8000 拒绝 | `film/request-batches.test.ts` 参数化 writer/director 的 7500 字全文拆批、不重复不丢失；`desktop/p3j-runtime.test.ts` 8001/20000/100000 真实发送体等于输入。超过安全上限仍拒绝。                                                                                                                        | 有对应 |

## Shot：11 项

| ID  | 原审计检查                            | 正确预期与产品测试证据                                                                                                                                                                                     | 核对               |
| --- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| S1  | 正向：真实台词挂接、纸条非台词        | `film/phase2.test.ts` → `copies a spoken line onto a shot and rejects a question echoed as scenes`：known speaker 附加、书店招牌/纸条、落地拟声不附加。                                                    | 有对应             |
| S2  | 冒号台词后叙述被朗读                  | `film/continuity.test.ts` → `keeps both dialogue entries and punctuation without narrating a trailing action`，`林骁：走吧。随后他转身离开。` 仅保留 `走吧。`；另多句合法台词测试。                        | 有对应             |
| S3  | attachScriptLines 保留已有虚构台词    | `film/continuity.test.ts` → `clears a pre-existing invented line in the dialogue attachment helper`，直接喂已有凭空台词与无对白原文，断言清空。此次映射检查发现缺口后由 script_director 补上。             | 有对应             |
| S4  | 正向：下一场标题不落上一场            | `film/operations.test.ts` → `keeps the test novel's scenes, headings, and fight tag apart`，真实小说分场边界无下一场标题残片。                                                                             | 有对应             |
| S5  | 正向：打烊不是打斗                    | 同测试显式 isFightScene(打烊)=false，打斗场=true。                                                                                                                                                         | 有对应             |
| S6  | 正向：中景不改近景                    | `film/project.test.ts` 输入 size 中景，解析结果明确 expect size 中景，覆盖分类与存储调用链。                                                                                                               | 有对应             |
| S7  | 正向：明确 id 只拿自己的 nodes        | `film/voice-action-regression.test.ts` → `never moves another shot's node by position`，one id 取自己的动作；`continuity.test.ts` → `preserves the target shot ids of flat action beats` 验证解析保留 id。 | 有对应             |
| S8  | 缺 id 时镜2继承镜1第二 node           | 上述 voice-action 测试 one/two 不匹配返回空；新版无 id 即使原文重叠也空；`stores all unassigned beats...` 验证未分配保存。                                                                                 | 有对应             |
| S9  | 手动动作入口合并全部镜 nodes          | `ProWorkspace.test.tsx` — `manual action assigns only the current shot and persists the other shot as unassigned`：真实手动入口两镜响应，仅当前镜写入，另一镜保留unassigned。                              | **原生回归已通过** |
| S10 | 正向：hold_seconds / bare hold_s 可读 | `film/continuity.test.ts` → `hides absent hold fields and describes invalid timing without changing valid seconds`，同时覆盖 hold_seconds:1.5 与 hold_s 2。                                                | 有对应             |
| S11 | hold_s: / hold_s= 原字段泄漏          | 同文件 → `reports omitted source instead of silently adding copied source shots` 中 plainCue 输入 hold_s:1 与 hold_s=2，输出中文停顿；另 null/非法值矩阵。                                                 | 有对应             |

## Voice/reference：9 项

| ID  | 原审计检查                                  | 正确预期与产品测试证据                                                                                                                                                                                                                                      | 核对   |
| --- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| V1  | 显式男被“女主角丈夫”覆写                    | `film/voice-action-regression.test.ts` → `prioritizes structured traits and reuses the proper voice category`，男/中年加女主角丈夫仍为男性成人池。                                                                                                          | 有对应 |
| V2  | 显式成人被“照看孩子”覆写                    | 同测试组合身份含照看孩子，仍属成人池。                                                                                                                                                                                                                      | 有对应 |
| V3  | 男池耗尽落女池                              | 同测试 used 包含全男池，结果仍在男池内。                                                                                                                                                                                                                    | 有对应 |
| V4  | 成人池耗尽落年轻池                          | 同测试 used 为全男池+全女池，结果仍在男成人池。                                                                                                                                                                                                             | 有对应 |
| V5  | 已有人物补声忽略 gender/ageBand             | `respects existing structured traits when choosing missing voices`，女/中年且西装身份、无声时进入女成人池。                                                                                                                                                 | 有对应 |
| V6  | 正向：13 refs + 独立首帧                    | `keeps a sole HTTPS portrait as reference and caps at thirteen`，独立 /tmp/still.png 保留，16 个 portrait 限制13；`pro/workflow.test.ts` 和 `api/test_story_film.py::test_reference_list_keeps_thirteen_beside_the_start_frame` 补链路边界。                | 有对应 |
| V7  | 唯一 HTTPS portrait 被当 still 再丢弃       | 同 voice-action 测试明确 still=''，refs 唯一 URL 保留。                                                                                                                                                                                                     | 有对应 |
| V8  | 真实首帧请求没带 refs                       | `desktop/p3j-runtime.test.ts` → `includes each reference in the actual image editing request`，捕获真实 requestStill fetch body，images 数组与5个入参完全对应；`pro/workflow.test.ts` 验证 bridge 调用。                                                    | 有对应 |
| V9  | backend local-only still + 模型 refs 13/7/0 | `api/test_p3j_references.py::test_prepared_reference_formats_keep_remote_images` 与 `test_service_autoframe_uses_five_refs_and_video_keeps_thirteen`：服务真实请求构造保留 HTTPS 首帧，自动首帧带5图、视频按模型cap且最多13参考图；本地路径仍校验真实图片。 | 有对应 |

## 补齐的直接证据

R6、S9 已补真实组件回归并列出确切测试名，定向运行两项均通过（`/tmp/p3j-new-final-focused.log`）；S3 已由 script_director 补上直接回归。全套结果仍以本轮最终日志为准。

音色池测试只证明程序遵守现有分类与手选锁；没有真实试听证明每个 voice 的声学性别/年龄。截图、Windows 安装、真实供应商也不能由这些单元测试推断为通过。
