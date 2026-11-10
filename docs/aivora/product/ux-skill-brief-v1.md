# AIVORA 界面与交互规范来源 · 岗位技能简报 v1

- 编写：AIVORA 产品与交互岗位，2026-11-09 PST。外部来源均在 2026-11-09 PST 本轮读取（本文件 19:08 PST 首次保存之前）；上位规范 `ui-engineering-standards.md` 本地副本于 2026-11-09 19:09 PST 通读后修订本文件
- 用途：给云端开发会话参考的界面规范输入（检查清单 + 来源；不是已安装技能），配合 `flow-ux-spec-v1.md` §14（含 §14.0 上位规范继承表）和 R01–R18 使用
- 边界：本轮只读官方页面并做最少必要核验。**没有安装任何技能或依赖，没有复制任何组件或代码**，只借鉴机制。所有数值都是 AIVORA 拟议规范，**不代表现有 UI 已经符合**。
- 预研复用：联网查找会话（3ab5636b，2026-11-09 18:36–18:52 PST）已有的官方来源只涉及视频模型（Kling/Seedance/Wan/LTX 等），**没有 UI 规范来源**。该会话的 X 工作流需求草案在我读取时仍在运行。等它送来以后再补，不重复泛搜。

## 1. 来源清单（“已核验机制”= 本轮读过正文；“仅 URL 可达”= 只确认页面能打开，正文未读，不能当本轮核验）

| # | 来源（原始 URL） | 版本/日期 | 许可 | 本规格采用的机制 |
|---|---|---|---|---|
| S1 | WCAG 2.2 https://www.w3.org/TR/WCAG22/ | W3C Recommendation，2024-12-12（页面显示） | W3C Document License https://www.w3.org/copyright/document-license/ ，可引用，不需要复制 | 1.4.1 不只靠颜色；1.4.3 文本 4.5:1；1.4.11 非文本 3:1；2.4.7 焦点可见；2.4.11 焦点不被遮挡（AA）；2.5.8 目标 ≥24×24（AA）；3.3.1/3.3.3 错误标识与建议；4.1.3 状态消息 |
| S2 | WCAG 2.2 Understanding：Status Messages https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html ；Target Size (Minimum) https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html | 随 WCAG 2.2。**仅 URL 可达**，正文本轮未通读 | 同 S1 | 待开发者按原文复核：播报方式、目标尺寸例外（本规格只依据 S1 正文中的条款本身） |
| S3 | WAI-ARIA APG 模态对话框 https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/ | 页面未标版本，2026-11-09 读取 | 示例代码按页脚链接 W3C Software License https://www.w3.org/copyright/software-license/ ；**本规格不复制示例代码** | 打开时焦点进对话框、Tab 循环、Esc 关闭、关闭后回到触发元素；不可逆操作默认聚焦最不具破坏性的按钮 |
| S4 | APG Toolbar https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/ ；键盘接口与 roving tabindex https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/ | **仅 URL 可达**，正文本轮未通读 | 同 S3 | 待开发者按原文复核：阶段条和工具栏一个 Tab 停靠点、方向键内部移动（roving tabindex）。本轮未核验 |
| S5 | React：You Might Not Need an Effect https://react.dev/learn/you-might-not-need-an-effect | 2026-11-09 读取（页面无版本号） | react.dev 文档 CC BY 4.0（仓库 reactjs/react.dev 的 LICENSE-DOCS.md，本轮已读取开头确认） | 能从现有数据算出来的就在渲染时计算，不另存 state；用户事件导致的提交放在事件处理函数里，不放 Effect；异步取数要能忽略过期响应 |
| S6 | React：Choosing the State Structure https://react.dev/learn/choosing-the-state-structure ；StrictMode https://react.dev/reference/react/StrictMode ；useTransition https://react.dev/reference/react/useTransition | **仅 URL 可达**，正文本轮未通读，**不是本轮核验的机制** | CC BY 4.0（同 S5，按同仓库推定，未逐页确认） | 待开发者按原文复核的要点：避免冗余和矛盾的 state；开发模式下 effect 会多跑一次。本规格对“提交不放 effect”的要求以 S5 正文为依据，不以 S6 为依据 |
| S7 | GNOME HIG Buttons https://developer.gnome.org/hig/patterns/controls/buttons.html | 2026-11-09 读取（无版本号） | **未确认**（仓库许可本轮未能读取）→ 只参考机制，不复制 | “每个视图只能有一个 suggested 或 destructive 样式的按钮”；“suggested action 用来引导流程的下一步”；“无效按钮置为不可用，而不是点击后报错” |
| S8 | GNOME HIG Spinners https://developer.gnome.org/hig/patterns/feedback/spinners.html ；Progress Bars https://developer.gnome.org/hig/patterns/feedback/progress-bars.html | 2026-11-09 读取 | 未确认（同 S7） | 操作超过约 3 秒才需要显示进度；可能超过 30 秒时用进度条而不是转圈；不要闪现很短的转圈 |
| S9 | Apple HIG Progress indicators（数据接口）https://developer.apple.com/tutorials/data/design/human-interface-guidelines/progress-indicators.json | 2026-11-09 读取 | Apple 版权，**只参考机制** | 时长明确的任务用“确定型”进度，时长不明确的用“不确定型” |
| S10 | NN/g Response Times: The 3 Important Limits https://www.nngroup.com/articles/response-times-3-important-limits/ | 原文 1993（页面元数据），之后有更新 | NN/g 版权，**只参考机制** | 0.1s 感觉即时；1s 不打断思路；10s 之后用户会去做别的事，需要进度和预计时间 |
| S11 | NN/g Progressive Disclosure https://www.nngroup.com/articles/progressive-disclosure/ | 2006-12-03 | NN/g 版权，**只参考机制** | 高级和少用的功能放到第二层 |
| S12 | 工具（只是建议引入的检查工具，本轮未安装）：axe-core https://github.com/dequelabs/axe-core （MPL-2.0，最近推送 2026-11-05）；eslint-plugin-jsx-a11y https://github.com/jsx-eslint/eslint-plugin-jsx-a11y （MIT）；Playwright https://github.com/microsoft/playwright （Apache-2.0）；eslint-plugin-react-hooks（随 facebook/react，MIT，本轮 GitHub API 未返回，**待复核**） | GitHub API，2026-11-09 读取 | 已列出 | 自动化无障碍检查、hooks 规则检查、UI 夹具截图 |
| S13 | 既有项目规范：开发计划.md 硬规则 :363-372（每屏一个主按钮，参考剪映专业版/Premiere/达芬奇）、4A-U09 :970、C1 :431、3J-U22 :880；仓库 `docs/development/ui-engineering-standards.md`（本轮通读的是本地只读副本 `/workspace/evidence/aivora-readonly-20261110/docs/ui-engineering-standards.md`，全文 66 行；总控已核 f59affe 上两份工程规范、CONTRIBUTING、云端执行队列与本地副本一致（【总控审查口径】）） | 开发计划 2026-11-04 第三版；上位规范副本无版本号，2026-11-09 19:09 PST 读取 | 项目内部 | 上位约束。继承与差异逐条见下方 1.1 和 spec §14.0 |

### 1.1 与上位规范 ui-engineering-standards.md 的继承与差异

- 继承：design token 不散落魔法值（:9）；单一紫色品牌色只给主动作、当前步骤、焦点（:10）；最小正文 12px（:11）；4px/8px 节奏（:12）；不仅靠颜色（:13）；主流程显示当前步骤/输入版本/任务状态/成本/下一步（:17）；优先撤销（:18）；AI 结果区分建议/已接受/人工修改/已失效（:19）；渐进披露（:21）；任务队列信息契约与状态表（:22-36）；键盘、焦点、live region、reduced-motion（:41-43）；UI 交付 Gate 7 项（:56-64）。
- 差异与修正：① 桌面基准改为上位的 1440×900、最小 980×680（初稿用 1280×800，现降为附加截图）；② 时间码 11px 例外与“最小正文 12px”有张力，默认改为 12px，11px 须用 rem 随缩放并经总控批准；③ 上位要求触屏目标建议 ≥44×44，本简报另加桌面指针 ≥24×24 最低值；④ 上位要求任务详情显示 hash，与 API55“renderer 不接触 SHA”合同有张力，列 spec Q10；⑤ 上位 :66“使用仓库指定的前端 UI 专业技能”没有指明是哪个技能，本轮不推断，列 spec Q12。

### 1.2 React 工程规范 ≠ 可安装“技能包”

- S5/S6 是 **React 官方文档**（工程规范来源），只用于写检查项，不是可安装的东西。
- S12 是 **npm 检查工具**（axe-core、eslint 插件、Playwright），是否引入由总控按第三方来源流程决定；本轮**未安装**。
- 可直接安装的 agent **“技能包”**：本轮**没有找到、没有验证、也没有安装**任何一个。本简报的 K1–K6 是本岗位写给云会话的检查清单，不是第三方技能包。上位规范 :66 提到的“仓库指定的前端 UI 专业技能”具体指向仍未明确（spec Q12）。
- **【总控审查口径】（2026-11-09 PST 经 Grok Bot 转来，是总控的工程审查回复，不是用户对新实现的批准）：** 本简报只是规范输入，**不能**标为已安装、已落库或已在云端应用；待许可审查。Q1–Q12 的阈值不改现有 timeout 和断言；新体验保持待排期。

### 1.3 【预研】五领域官方候选（skill-research-v1.md B 节；2026-11-09 PST 本轮完整读取，原文件未改）

许可为预研所载；版本**不以预研最新版为目标**，以总控所核 f59affe 仓库现状为准，精确 lock 待核。它们是规范或组件候选，不是已安装的 agent 技能；没有引入任何一项，也不能据此称 UI 已提升。不强推升级，不做组件重写。

| # | 候选 | 仓库现状（总控所核）/ 许可 | 本简报用法 |
|---|---|---|---|
| S14 | WAI-ARIA APG 模态对话框（同 S3） | 规范，无依赖；W3C Software and Document License 2023（预研所载） | 机制已在 K3；不复制示例 |
| S15 | React Aria `Modal`/`Dialog` | 仓库未见 `react-aria-components`；Apache-2.0（预研所载）；预研最新版仅作参考 | 有条件候选：只在确认/授权/重试对话框缺 APG 行为时考虑；与现有 React 版本对齐未核 |
| S16 | Electron Security / Context Isolation | 仓库范围 `^43.2.0`，精确 lock 待核；MIT | 安全基线方向；不以预研最新版为目标，不据此升级 |
| S17 | FastAPI Response Model | 仓库 `>=0.141.1,<0.142.0`，精确 lock 待核；MIT | BE 契约设计输入；不改 API55 合同，不升级重写 |
| S18 | Playwright Electron（实验） | 仓库出现 1.56.1（apps/studio-web）与 1.62.1（根 playwright-core），精确 lock 待核；Apache-2.0 | 只作 L3 辅助，不作唯一门禁；测试启动参数（`chromiumSandbox` 默认 false）不进生产 |

预研 A 节的博主流程和外部 zip（`duanju-skills.zip` 无 license 字段等）只是线索：不安装、不内置、不作硬门。产品评估见规格附录 F（建议，未批准、需用户拍板）；对照材料副本只在研究目录，不入仓库。

**缺口：** 专业创作软件（Premiere、DaVinci Resolve、剪映专业版）的官方信息层级文档，本轮没有核验到可直接引用的官方页面（Adobe Spectrum 页面需要 JS 渲染，抓取失败，返回 500 / 空内容）。只保留开发计划 :370 的既有提法。不用第三方博客替代。

## 2. 岗位技能卡（何时用 / 约束与反例 / AIVORA 适配 / 怎么验证）

### K1 主行动与禁用说明（界面会话；对应 R01/R02，spec §14.2）
- 何时用：每个页面、每个对话框设计或修改时。
- 机制：每个视图最多一个强调按钮（S7、开发计划 :370）；强调按钮放流程下一步（S7）。
- 约束与反例：S7 主张“无效按钮置灰，而不是点击后报错”。AIVORA 的调整：**置灰的同时**在按钮旁边写一行原因，并提供「去补齐」（WCAG 3.3.1/3.3.3 的错误标识与建议精神，S1）。反例：r2 分镜页同时有 3 个蓝色按钮（开发计划 :970；本轮截图 storyboard-3shots.webp 显示「生成这一场」和顶栏）。还有一个反例是只给悬停提示，键盘和触屏用户看不到。
- 适配：任何页面唯一 primary 始终是 `nextAction`，只在顶栏或页面内一处呈现（spec §6）；其他局部动作都是 secondary。不可用的生成按钮用 `aria-disabled="true"`，保持可聚焦，原因用 `aria-describedby` 关联可见文字；**它拦截 pointer、Enter、Space，不执行动作，也不导航**。导航只由旁边独立、可用的「去补齐」链接负责。
- 验证：Playwright 夹具在 8 阶段截图，在活动作用域内（无模态为工作区，有模态为该模态且背景 `inert`）统计可访问 `.btn.primary` 恰好 1 个，工作区内其 actionId == nextAction（沿用 4A-U09 验收法）；对每个不可用按钮：点击/Enter/Space 后任务数 0、路由不变；可访问描述 == 可见原因；激活「去补齐」后焦点落在目标字段。

### K2 渐进披露与信息密度（界面会话；spec §14.1）
- 何时用：属性栏、导出对话框、AI 提示文字。
- 机制：常用和必填放第一层，高级参数收起（S11；开发计划 4A-U12 :976 已要求整段提示文字默认收起）。
- 约束与反例：不能把**阻断原因**藏进“高级”。反例：r2 的场记提醒只是黄点，并且不阻断（O11）。
- 适配：属性栏默认展开“有问题的分组”；4px 间距刻度（4/8/12/16/24/32，token）；字号用 rem：正文 13px，次要 12px，最小 12px，时间码默认 12px（拟议）。
- 约束补充：“不允许整页滚动”只在 100% 文本大小下成立；200% 文本缩放或系统缩放时允许重排或整页滚动，**不得裁切必要内容**（WCAG 1.4.4/1.4.10，S1）。
- 验证：样式审查 grep 非刻度的 margin/padding；1440×900、980×680（上位基准与最小）及附加 1280×800、1920×1080 下 100% 无整页滚动；200% 文本缩放下 8 阶段无裁切。

### K3 键盘与焦点（界面会话；spec §14.3）
- 何时用：阶段条、工具栏、所有对话框。
- 机制：对话框焦点管理（S3）；工具栏和阶段条用 roving tabindex（S4）；焦点可见、不被遮挡（S1 2.4.7、2.4.11）；目标 ≥24×24（S1 2.5.8）。
- 约束与反例：对话框在内容可交互前就显示可点的确认按钮，会导致首击丢失（O14，待复核，可能是测试工具时序）。另一个反例：关闭对话框后焦点落回 body。
- 适配：对话框 ready 之前确认按钮 `aria-disabled` 并显示“正在准备…”，这期间的激活**不受理、不建任务、不在 ready 后补发**；ready 之后第一次激活受理一次；重复激活按 actionKey 去重（spec R03）。关闭后焦点回到触发按钮；会产生费用或不易撤销的操作（例如生成确认、「本片静音导出」）默认聚焦“取消”（S3）。
- 验证：R03 三项分别验收（ready 前 0ms/50ms 激活 → 0 任务；ready 后首次 → 1 任务；双击/连点 → 仍 1 任务）；axe-core 在夹具页面零 serious/critical；Playwright 键盘脚本只用 Tab/方向键/Enter/Esc 走完 GC-15 的 8 阶段（替身供应商）。

### K4 状态播报与异步反馈（界面会话；R03/R04，spec §14.4）
- 何时用：任何会超过 0.1 秒的操作。
- 机制：0.1s / 1s / 10s 三个界限（S10）；超过约 3 秒才显示进度，可能超过 30 秒时用进度条（S8）；时长已知用确定型进度，未知用不确定型（S9）；状态消息不抢焦点地播报（S1 4.1.3）。
- 约束与反例：AIVORA 的生成任务通常要 2–5 分钟（O3、O14），**不能**只放转圈；也不能放假进度条（硬规则 5）。会员生成不知道实际进度，所以显示“已等时间 + 完成数/总数”，不显示百分比。反例：r2 导演 4 分钟后才说“太久没回话”。
- 适配（数值均为建议，非现有、未批准；未被【用户裁决】覆盖）：100ms 按下态；0.5s 内出现任务（C1）；3s 后显示已等时间；软提示和硬超时见 spec §7.2；`role="status"` 播报开始、完成、保存；`role="alert"` 只用于阻断错误。
- 验证：替身供应商注入延迟（0.2s / 5s / 70s / 超时 / 迟到结果），断言界面状态与播报文本。

### K5 React 状态派生与异步幂等（界面会话 + 后端协同；R01/R06/R07，spec §14.5）
- 何时用：写阶段状态、有效性、按钮可用性、生成提交逻辑时。
- 机制（本轮核验的只有 S5 正文）：可推导的值在渲染时计算，不另存 state；用户事件导致的提交放在事件处理函数里；异步结果要能忽略过期响应（ignore 模式）。待复核（S6 未通读）：StrictMode 下 effect 会多跑一次。
- 约束与反例：反例 1：用 `useEffect` 把“分镜完成”写进 state，与数据不同步（这可能就是 3J-U22“勾不代表做完”这类问题的形态，**待证**）。反例 2：在 effect 里提交生成，在 StrictMode 或重挂载时会提交两次。反例 3：迟到的 AI 结果覆盖了用户之后的修改。
- 适配：`nextAction()`、`stageStatus()`、`validity()` 都是纯函数，由项目数据 + 任务列表推导；提交用 `actionKey = 动作 + 实体 ID + 输入 vid 集合` 做去重；返回时比对发起时的输入 vid 与当前 head，不一致就进“迟到结果”。版本模型按 spec §4.1：内容版本不可变、seq 单调不复用，撤销只移动 head。
- 验证：eslint-plugin-react-hooks 规则零报错；单测：同一 actionKey 并发 3 次只产生 1 个任务；在 StrictMode 下挂载两次，任务数仍为 1；head 变化后迟到结果不写入；撤销后 head 指回原 vid，派生有效性恢复 VALID 且 seq 不回退。

### K6 文案与术语（产品与交互；R02/R17）
- 何时用：所有按钮、原因、提示。
- 机制：按钮用动词开头，短（S7）；界面不出现术语（硬规则 4）；C7 code + 短句（开发计划 :450）。
- 适配：原因格式统一为“<对象> <缺什么>”，例如“老人还没有正面定妆照”（正面是唯一最小必需，其他角度是可选扩展）；动作带岗位，例如“导演：按目标拆镜头”。
- 验证：按 copy-zh 表和禁用词表 grep `src`（沿用 4A-U08 验收法）。

## 3. 不做的事

- 不内置无许可的外部 zip，不把博主经验写成硬门；S14–S18 不因本简报而引入或升级。
- 不安装技能包或依赖（本轮也没有验证任何可安装的技能包），不复制 Spectrum、GNOME、APG 的组件或代码；S12 的工具是否引入，由总控和开发会话按 CONTRIBUTING 的第三方来源流程（`third_party/provenance.yml`）决定。
- 不把本简报写成已安装、已落库或云端已应用（总控口径，待许可审查）。
- 不把这些规范写成“已符合”；现有 UI 的符合度需要 QA 在新候选上实测。
- 不重复联网查找的泛研究；它的结果送到后，只补“专业创作软件信息层级”这一个缺口。
