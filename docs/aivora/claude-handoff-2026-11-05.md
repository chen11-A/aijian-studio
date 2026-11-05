# 停止开发交接：3JR 修复与 4A 整合

2026-11-05 UTC。用户最新指令：“停止吧，你的代码上传，然后给出交接，由claude接手”。本记录是停止时的快照；后续开发、合并、tag 和发布均已停止。没有宣称阶段验收通过。

## 从哪里接手

完整已保存的整合成果在 `gpt/integrate-4a-b01`，最后一个代码提交是 `1286ce9dca7ea83867c79212af03ca61ee7a6504`；本交接提交仅增加文档。请从该工作分支读取代码，先保留当前历史，再由接手人决定后续合并。

| 分支/来源 | 停止时精确提交 | 状态 |
| --- | --- | --- |
| `gpt/work-4a` | `c2e8a1c9073ba0294a63c23aa5bd3a85c558115c` | 已推送后端基线，未加入本次整合收尾提交 |
| `aivora/dev` | `7f7a6ade8890c0bf829d511fc5f7f2bcabd97f11` | 未推进，不能当作本次新修复的完整版本 |
| 已整合的 Claude 快照 | `a5da574eb128bcb23610d3241206a74965ada587` | 已通过 `035fead7f49b026d0b8e47db63d973d00f9cac06` 合进上述整合分支 |
| 停止前只读查到的最新 `claude/work` | `b0617aa616b9a594070cc14274d7000290de0830` | 未整合，见下方三个提交；不是丢失或已拒绝 |

整合分支从既有 dev 建立，先 `--no-ff` 合入 GPT 基线（`038cbbafc13bbfd8816cc8a23623a41c9c444c3f`），再合入固定 Claude 快照。没有合并 main、强推、删除分支、新 tag 或发布。

停止前发现但未继续合入的 Claude 提交：

- `4d6c883`：4A-U11 AI 助手统一右栏及建议数量。
- `610588f`：4A-U12 单镜操作说明及卡片。
- `b0617aa`：4B-U01 剪辑预览/声音面板（后续阶段界面，不等于 4B 后端已经实现）。

这三个提交共同改动 `ProWorkspace.tsx`、其测试、`pro.css`、`next/INTEGRATION.md` 等，后续会与本次业务接线产生冲突风险。用户叫停后没有继续合并。旧四笔提交的分工继续遵守：`2d7acb7`、`d894dc3` 由用户摘入 Claude 分支；`9d89db8`、`5ba2b82` 由对应 U09/U11 会话处理，不要重复摘取。

## 已保存的整合收尾提交

| 提交 | 编号 | 结果 |
| --- | --- | --- |
| `e9dc8086dbb55e8ea5352e9ffb4d6eecbf5f0066` | 3JR-B05 | 只锁定 patch 实际修改的性别/年龄字段；保留未知年龄及明确清空、手选声音语义 |
| `afb7bea0b07d106bfb37c5518043b1fd21ea5e43` | 4A-B01 | 一键成片改接真实持久化流水线、人工审片、检查点继续、目标重试及取消；修复宿主复制快照误判和旧 effect 回退 live ref |
| `c2de13495d6fc5b15306abbfda9da3fd4309d65c` | 3JR-B01 | 分镜展示具体不可合并镜头/原因，结尾已覆盖时不显示“补上结尾” |
| `1771beb4cb9dbb992d54f5271722ab964799fa34` | 4A-B10 | Claude 的 work/other/both 导出选择接入真实 exportFilmSelection，保留部分成功文件 |
| `6dabd2056d5cc3cb0dd72bf6c87ee0b655cec1c1` | 3J-B18 | 整合 Claude 已交付中文映射及五个新增码，保留旧文字分类兼容；修正文案表/接口文档格式 |
| `77177959a88ef1bad0a3b6c3b1d6bcb1501c770f` | 4A-B01 | 旧宿主测试改为真实源文检查/手动入口；保留解析、重试、时长、存盘及并发断言 |
| `1286ce9dca7ea83867c79212af03ca61ee7a6504` | 3JR-B07 | canonical lines 非空但旧 line 为空时，仍建立真实配音轨并存回完整对白 |

## 3JR-B01 至 B10、3J-B18/B19 的真实状态

“逻辑已修”仅指代码与列出的本地回归，不等于 Grok 会员实测。没有付费调用，也没有真实会员生成验证。

| 编号 | 实际状态与代码 | 已验证/仍待验证 |
| --- | --- | --- |
| 3JR-B01 | 部分，真实回放未完成。`f38e091` 逐句多角色声音，`fed3d8d` 旧 line 兼容，`9a020d9` 配音先测长、视频预设时长、最多补末帧 1 秒、超限不提交；`c2de134` 展示具体合并阻碍 | 合成 21 镜交替对白可无损压到 16；素材、手改、声音/时长等安全约束冲突时保留内容并报告。Python 本地 FFmpeg + 供应商替身验证；默认视频上限 15 秒，classic 带参考上限 10 秒来自已实现协议/官方资料，未作会员能力承诺。第 1/2 场真实 ≤16 与尾句覆盖未验 |
| 3JR-B02 | 逻辑已修，真实动作分配待验。`5965c20`、`b8d9b34` | 按明确 ID、可靠原文段号或独特原文重叠匹配，不要求画面先有打斗关键词；不按位置猜，保留歧义/前置对白/手改保护。相关 44 项通过。没有真实 19 条回复，不能声称已挂 ≥17 或未挂 ≤2 |
| 3JR-B03 | 逻辑已修，真实误报工程待验。`e2fd2c2` | 台词、叙述、可见文字分开检查，逐句保留顺序。jr-tail-coverage 等已验证；未取得实际误报工程 |
| 3JR-B04 | 逻辑已修，有历史素材兼容边界。`8da79bc`、`67711f6`、`c3cd585`、`b68caf8`、`a165db6` | 新草稿连续唯一 ID；主 action 与完整有序 actionBeats 分开持久化。已有素材 ID 不强制重命名，避免串素材；真实跳号工程待验 |
| 3JR-B05 | 部分：原文年龄纠正、选声及来源标记已修，不能虚构全部年龄。`255faaa`、`87354e7`、`ed2f855`、`0dd16fc`、`e9dc808` | 林晚 26 岁按原文为青年；adult 不再等同中年。性别已知/年龄未知可用带 casting-default 来源的临时成人声音；未知事实仍为空，未成年/性别未知/用户锁不乱默认。新增字段锁回归 19 项通过，角色真实声音体验待验 |
| 3JR-B06 | 逻辑已修，实际画面待验。`09a5b18` | 不入画人物不进正向视觉身份/服装/参考图，画外对白仍保留声音；相关 74 项通过。旧选定图不冒充已修，真实生成图片待验 |
| 3JR-B07 | 逻辑已修，旧工程素材缺失不伪造。`1e268e6`、`1286ce9` | 服务保留 voice_path，实际完成视频写配音音轨；新增 lines/空 line 的存盘回归。最新 generation-run + 导出 UI 28 项通过。缺失的旧真实语音路径和配乐不能凭空恢复 |
| 3JR-B08 | 生成/保存/两类请求接线已实现，四场真实图待验。`436f72b`、`6b71655`、`8e40637` | 手动单镜/四候选/视频及 pipeline still 先补场景参考；存盘后进入首帧及视频参考。失败拦住后续并终结本批排队任务；容量保留明确错误。生产适配替身测试通过，不等于会员服务接受全部图片 |
| 3JR-B09 | 本地截止/取消/进度逻辑已修，四分钟成功未证明。`3cae6cc`、`5cc162a`、`14fae1a`、`0c77ff3` | 请求、响应头、重试、补充/补尾共用 240 秒预算，15 秒进度，迟到不写回，保留已解析初稿；相关 17 项及宿主定向通过。JS 调度不是硬实时，不能承诺供应商四分钟成功或已停止远端执行 |
| 3JR-B10 | 部分。`0cd4e3f`、`91dcced` | 压缩/修复回复新增无来源句子会拒绝自动替换；初次导演仍以提示约束、段号/顺序及 sourceReview 风险为主，不保证语义绝无新增。原文有旧面包车跟随，但不据此认可仓库外停车新增情节；缺真实回复未定位实际生成原因 |
| 3J-B18 | 代码及本地回归已修，会员点击待验。`76d5544`、`6dabd20` | 聊天/状态栏隐藏 COVERAGE_INCOMPLETE、ACTION_UNASSIGNED 等原始码，给具体缺失/原因/下一步；162 项文案及兼容契约通过 |
| 3J-B19 | 代码及本地回归已修，会员点击待验。`dc9007a`、`6cb8cd4` | 状态栏简短失败原因，数量/参考诊断保留在详情或脱敏日志；不新增原文日志。相关 43 项通过 |

## 晚照书店回放材料

小说存在：`packages/aivora-prompts/fixtures/test-novel-2000.txt`，SHA-256：`acaba10e8752d4730be1391682a3bbc77e6fd37308e545303dba951c28f31b9e`。

没有找到用户此次真实导演回复、19 条动作指导回复或实测 project.json。`/workspace/shared` 为空，`/workspace/audit/p3i` 不存在。notes.json 是手工参考，不是会员输出。不得把现有合成单测冒充实际回放。

| 场次 | 原始/压缩后镜头数 | 最后一句覆盖 | 动作总/已挂/未挂 |
| --- | --- | --- | --- |
| 第 1 场 雨夜旧书店（晚照书店） | 未取得/未验证 | 未验证 | 未验证 |
| 第 2 场 码头仓库 | 未取得/未验证 | 未验证 | 目标 19/≥17/≤2，实际未验证 |

已有离线回放工具、强制源文件 SHA 与 real-capture/synthetic 声明，见 [3jr-offline-replay.md](3jr-offline-replay.md)。声明来自输入者，不是自动认证；缺捕获 exit 2，不造报告。

## 停止时检查终态

最新源代码没有完成一次全量全绿，不允许据此发版。不同范围回归重叠，以下数量不累加。

| 范围 | 终态 | 执行器日志 |
| --- | --- | --- |
| desktop 完整 Vitest | 114 文件，2017 通过、0 失败/跳过；语句 90.68%、分支 91.29%、函数 93.36%、行 92.21% | `/workspace/integration-desktop-cache-final.log` |
| desktop 首次诊断 | 2015 通过、2 失败，原因均是默认 uv 缓存不可写；指定工作区可写 UV_CACHE_DIR 后完整重跑通过 | `/workspace/integration-desktop-full.log` |
| Python 完整 pytest | 用户叫停后 SIGINT 安全终止，exit 2；4222 通过、6 跳过、未报告失败，81% 时中断，1448.78 秒。不是全量通过，覆盖率门槛未完成 | `/workspace/integration-python-full.log` |
| 全仓 TypeScript | contracts、desktop、studio-web 均通过；运行后还有新增测试/B07 收尾，最终 tip 未完整重跑 | `/workspace/integration-types-all.log`；后续宿主测试 web tsc 也通过 |
| Python ruff/格式/mypy | 全仓通过，559 文件格式正确，mypy 310 源文件通过；本次之后无 Python 源码变化 | `/workspace/integration-ruff-all.log`、`integration-mypy-all.log` |
| 真实宿主流水线/控制器/PipelineSteps | 41 通过，0 失败/跳过。人工审片前无视频，真实检查点保存后才继续；人工确认最终为 accepted，不伪造视觉审片分数 | `/workspace/pipeline-host-final.log` |
| 不可安全合并的 UI | 1 通过，17 镜显示具体相邻镜头/手改原因，不误报结尾缺失 | `/workspace/budget-host-final.log` |
| 文案完整性与兼容 | 162 通过，0 失败/跳过，未删除原契约 | `/workspace/integration-copy-doc-verified.log` |
| 宿主 ProWorkspace 全文件 | 同次 108 通过、1 失败（旧导出文案断言）；修成实际 EXPORT_DONE 文字后该 1 项定向通过、108 未选。未重跑成一次 109 全绿 | `/workspace/integration-host-final.log`、`integration-export-copy.log` |
| 5 个旧流水线用例适配 | 5 通过、104 未选；不完整原文验证真实失败，不再期待假检查点 | `/workspace/integration-five-third.log` |
| B05 字段锁/临时声音 | 19 通过、0 失败/跳过，目标 ESLint/格式通过 | `/workspace/jr-b05-patch-locks.log` |
| B07/实际导出 UI | 28 通过、0 失败/跳过，目标 ESLint 通过；其中导出 4 项调用真实 helper，native/supplier 为替身 | `/workspace/integration-b07-canonical-export.log`、`integration-b07-export-lint.log` |

未运行：整合最终 tip 的完整 web + 覆盖率、全仓 ESLint/Prettier 最终重跑、最终类型检查、contracts:check、全页面布局、真实会员/Windows 安装实测、最终 CI。停止前旧后端 0dd16fc 的 web 4300 通过/1 文案失败仅为历史证据；文案现已定向通过，不能把旧全量当作当前全量。CI 未等待、新 tag/release 未创建，两个新安装包及 SHA-256 不存在。

停止前只读查过 Claude a5da574 的 CI：Linux/Windows 均在 Prettier 失败，涉及 next/INTEGRATION.md 与 docs/design/copy-zh.md；本整合已格式化，但没有宣称新 CI 通过。GitHub CLI 到 api.github.com 被环境拒绝，后续读取使用已连接 GitHub 工具；没有绕过代理或权限。

## 文件与冲突风险

停止时的业务源码改动均已提交；临时 `.venv` 符号链接已移除，只移除链接，没有删除虚拟环境或用户文件。本地后端工作树 `/workspace/aijian-studio` 与整合工作树 `/workspace/aivora-integration-b01` 均应由最终 Git 状态核对；没有丢弃未提交改动。

本次整合收尾改动的源码/测试：

- `film/notices.ts`、`film/notices.test.ts`、`next/wiring/noticeCopy.ts`、`docs/design/copy-zh.md`、`next/INTEGRATION.md`。
- `pro/ProWorkspace.tsx`、`ProWorkspace.test.tsx`、`film-pipeline-controller.ts` 及测试、`next/PipelineSteps.tsx` 及测试。
- `pro/production-actions.ts` 及测试；`pro/actions/generation-run.ts` 及测试。
- 新增 `pro/PipelineWorkspace.integration.test.tsx`、`ShotBudgetWorkspace.integration.test.tsx`、`ExportSelectionWorkspace.integration.test.tsx`。

先前 GPT 全部后端变化已经随 038cbba 保留，范围见从 dev 到整合分支的 Git compare；不要只复制以上收尾列表而漏掉 services/api、desktop、contracts、film 先前提交。未改 main；未继续修改尚未合入的 Claude 三笔 UI/CSS；未实现新的 4B 功能。

最初两个上传 ZIP 的执行器下载受限仍为历史缺口；没有伪称成功导入 ZIP 或核对其字节哈希。本次界面来源为可审阅 Git 历史。此前组件历史及校验记录保留，不要把 design ZIP 猜成当前界面 ZIP。

下一接手人优先读取：[任务书](给GPT的任务书.md)、[3JR 验证历史](3jr-backend-verification.md)、[接口交接](4a-claude-integration-handoff.md)。现阶段只有代码上传与交接授权的收尾已经执行；后续测试、合并和发布由接手人按用户的新指令决定。
