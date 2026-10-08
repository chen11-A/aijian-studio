# AIVORA 制作组交接记录（2026-09-24）

总控已恢复本轮工作。此记录只覆盖制作组派包和核对结论；历史 `production.md` 保留原样。

用户最新明确唯一交付为 AIVORA Electron 桌面软件。`studio-web` 是内嵌桌面界面的 renderer 源码，必要构建属于桌面打包链；制作组仅以真实 Electron 桌面流程核对来源和审片，不设独立网站、浏览器产品或网页部署验收。该范围已同步 ART01–ART04。

## 首包：冻结输入核对

| 项目 | 当前记录 |
| --- | --- |
| 负责人 | MGR03 制作经理；执行人 ART01 导演与编剧，任务 `01a0d0ec-f628-7bb2-a50e-c18f8a895561` |
| 派发状态 | ART01 已交 Git 原件及受控恢复件实测；经理复核通过；ART01 核对包目标已 complete |
| 剧本定位 | Git 提交 `d495d0cfd2b82fae3cad4288a72da55210b34e91` 的 `docs/production/k01/离别30秒剧本.md`；预期 SHA256 `466F23B789B47FA1231B0891E80385A13E530B02DE2F74481C4E98F5732DE008` |
| 长文本定位 | 《原创小说.txt》；预期 SHA256 `29A4AA9E35D684C71BDFD67CD7265FB96C0682EA861B2F2008707CCD2646D697`，24,079 字符、20,272 汉字；相邻材料清单注明内部测试原创输入。准确 Git 路径与实测仍待 ART01 核对 |
| 恢复交接 | MGR04 已派 REL01 受控恢复三件材料至 `C:/Users/Administrator/Documents/AIVORA/production/inputs/20260924/`；来源/哈希清单及文件释放尚未交付 |
| 交付 | 分别记录实际路径或 Git 对象、实测哈希、完整性、内部测试授权原文位置及范围、无法证实处 |
| 边界 | 只读；不重写剧本、不恢复文件、不运行软件或测试、不调用供应商；REL01/MGR04 负责受控恢复 |

ART01 应先查询目标，只有无未完成目标时才登记本包有界目标。恢复文件尚未释放时，可核对已有 Git 证据；恢复后的文件以 REL01/MGR04 释放记录为准，不把预期哈希写成实测。

### Git 原件阶段核对

ART01 从提交 `d495d0cfd2b82fae3cad4288a72da55210b34e91` 的原始 blob 实测：剧本 6,826 bytes，SHA256 `466F23B789B47FA1231B0891E80385A13E530B02DE2F74481C4E98F5732DE008`，六镜、30 秒、750 帧、25 fps；小说 70,095 bytes，SHA256 `29A4AA9E35D684C71BDFD67CD7265FB96C0682EA861B2F2008707CCD2646D697`，24,079 字符、20,272 基本汉字、30 章，首尾锚点与清单相符。经理独立复核了 Git 原件 byte 长度及清单正文。

`docs/production/k01/简短材料清单.md` 原始 blob SHA256 为 `E4FF73680F0FEEBFB31FB3A5B5C1311AD73B0935AEA29B5419E1F7CAA2DD7711`。第一节自述小说为 K01 独立原创中文测试输入，供长文本和三个 5 秒 Fake 输入意图使用；没有独立权利授权凭据。因此目前能确认的是材料的内部测试用途自述，不能扩大为对外发布或真实生成授权。Git 原件阶段结果已交 MGR02。

### 受控恢复件核对

REL01/MGR04 释放 `C:/Users/Administrator/Documents/AIVORA/production/inputs/20260924/` 及同目录 `来源核验清单.md`。ART01 逐字节比较三份恢复文件与 Git blob：大小分别为 6,826、70,095、3,074 bytes，SHA256 分别与上表预期值完全一致，UTF-8/LF。经理独立回读恢复件并计算三份 SHA256/大小，均一致。小说实测 24,079 字符、20,272 基本汉字、30 章；剧本六镜为连续 0–749 帧，共 750 帧，30 秒、25 fps、1080×1920。首尾文本锚点与清单一致。

制作结论：冻结剧本与长文本的**身份和完整性**可供 M1 内部测试；清单第 1 节仅为内部原创测试用途自述，未见独立权利人签署、对外分发或真实供应商调用授权。H87 保存、审核、来源选择、关闭重开仍未执行，不能据此通过 M1 产品验收。

ART02 等真实可评审资产，ART03 等真实动作视频与锁定普通话音频，ART04 等可播放 MP4。以上输入未就绪，三岗保持待命，Fake 画面或占位声音不作为正式创作验收。

## 待交接

- 已收到 ART01 原始核对证据并由制作经理复核；已向 MGR02/MGR04 发送最终输入确认与未决事项。
- H87 来源真实 UI 使用须待固定候选、独立运行资料及相关文件释放，另行派包；本首包不证明来源闭环或影片完成。

## M1 真实使用开工门

软件经理已签署来源包的静态送测范围：`211c` 基线加 `model.tsx` 的来源清单同步单行变更。测试经理已报告定向 RED→GREEN 完成；其范围只是一条来源清单回归，真实 H87 UI 尚未验证。测试经理下一步对齐候选差异、构建产物和隔离 profile，由 QA02 操作短文与长文来源流程；固定候选、原生来源链和独立 profile/进程释放后，才向制作组交候选 SHA、运行入口和证据边界。当前 ART01 不启动 H87；提交回执不等于来源批准。收到交包后再派 ART01 普通用户保存→提交审核→确认来源审核基线→批准→选择制作来源→正常关闭重开核对。

QA02 已开始 M1 原生 H87 验收包，候选、双文件差异、输入/脚本哈希和环境预检一致。web 与 desktop 两项构建退出码为 0，QA 正核构建产物与源文件身份；Electron 原生结果尚未交制作组。QA02 使用的运行资料不得与 ART01 同时占用。制作评审继续等待 QA 的候选与 profile 释放。

QA02 随后报告原生运行定位差异：runner 的 `app.process().pid` 指向 `cmd.exe` 包装进程（18516），实际 Electron 主进程为 21808，按传入 PID 找原生弹窗可能失败。QA02 正保留原始结果；制作组将其先记为工具/定位器风险，不能据此判定来源产品流程成功或失败，也不能在运行资料释放前另起导演 UI。

首轮在“新建项目”弹窗等待“确认”按钮 30 秒后超时，正常关闭本轮 Electron；未进入来源导入、送审或批准，短文、长文及重开读回均未执行。测试经理正核原始日志与控件实现，限定修正 runner 定位/PID 后再有证据地复跑。制作组不把此定位超时列作来源产品失败，亦不以首轮运行证明 M1。

测试经理随后授权 QA02 仅修 runner 的项目创建定位和 Electron 主进程 PID 采集；QA02 先保全旧稿与失败证据，新哈希经签审后才复跑。产品源码与原定向 RED→GREEN 证据不属于此次修订范围。制作组等该原生链路结果和 profile 释放，不启动并行 UI。

QA02 已完成这两处 runner 修订，保存旧版备份、精确 diff、新哈希和 `node --check` 结果；测试经理已签审新哈希并授权一次复跑。QA02 正重核候选、输入、脚本、构建资产和进程占用，随后才启用新的隔离 profile；旧失败及旧 profile 保留。复跑结果尚未交制作组。测试经理将首轮失败核定为项目按钮文案不匹配的 runner 定位问题。

签审后的复跑已通过短文建项和导入，来源预览哈希与冻结输入一致；之后原生“送审来源版本”弹窗定位失败，runner 退出码 1，Electron 正常关闭。没有原生 Invoke 成功证据，长文未执行，审核/批准/来源选择/重开仍未知。制作组已请 MGR02 判断同一固定候选能否在 QA 释放后交 ART01 以新独立 profile 手动走可见 UI，并请 MGR04 给准确候选和顺序使用边界。导演结果不会替代独立 QA 签署。

MGR02 明确当前不释放 c19/build：QA02 仍独占 M1 原生诊断，正用第二轮保留 profile 做权威读回并核实 native modal 的 PID/标题/层级，同时确认 UNKNOWN、端口及 sidecar 无占用。候选 HEAD `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`，双文件 diff SHA256 `1BAD75EE4F875139015D7B48630A34DBE582A1A76335848B425D21D50561AF3C`。待 QA02 诊断与正常关闭、profile/PID 释放和构建哈希交接后，测试经理才提供新 profile、运行入口及已知缺口。ART01 继续待命，不并行争用。

QA02 对第二轮旧 profile 的只读 UIA 诊断在重开项目后的页面导航处超时，尚未读回来源权威状态，也未再次送审；Electron 正常关闭，旧 profile 和前两轮证据保留。该结果仍是定位/导航诊断失败，不能据此判定来源状态或释放运行资料。

MGR02 确认 QA02 仍获一次有界旧 profile 权威读回/UIA 诊断续行；只要其继续占用 c19/build，ART01 不能并行启动。诊断完成或再遇定位阻断后，测试组会正常关闭、核 Electron/sidecar 无驻留并封存旧证据，再交同版构建入口、差异与缺口供导演用**全新独立 profile**。旧 profile 的来源状态 UNKNOWN 本身不阻止后续独立制作使用，但导演结果不会补作旧 QA 尝试的证明。ART01 已获待命通知。

QA02 这轮已从 H87 重开并刷新旧项目：项目名吻合，全文预览哈希与冻结短文一致，界面来源状态显示“待审核”。这是该旧 profile 的实际读回；尚不能据此证明原生送审 Invoke、批准或最终来源选择。送审前 UIA 基线采集因“参数类型不匹配”停止，未再次触发送审；原始错误和页面快照已保留。旧 profile 与 c19 的释放仍待 MGR02 明确交包。

最后一次获授权的只读观察已确定弹窗标题为“送审来源版本”，PID 属 Electron 主进程，但弹窗位于 AIVORA 顶层窗口子级，“取消”和“确认送审来源版本”在 UIA 中为 `ControlType.Pane`。旧 helper 只查顶层窗口和 `Button`，能解释此前定位失败；未执行原生确认。QA02 报 Electron 与 sidecar 均已正常退出，制作经理已请 MGR02 核进程清洁、候选/构建哈希及旧 profile 封存后正式释放独立 profile 和运行入口。上述发现是工具定位证据，不证明送审业务已完成。

MGR04 补充版本标识：c19 路径 `C:/Users/Administrator/.codex/worktrees/c19-trim-211c9e8-qa-20260923`，HEAD 为 detached；送测差异仅 `model.tsx` +1 行（文件 SHA256 前缀 `0B2F661B`）与 `model.test.tsx` +62 行（前缀 `807ABAEB`），HEAD 加双文件 binary diff 哈希同上。`basic12` 尚未部署。版本经理正在向 MGR02 取构建/运行入口与释放记录，具备后顺序交制作组。

REL01 已交只读候选映射 `C:/Users/Administrator/Documents/AIVORA/management/manager-handoffs/rel01-m1-production-handoff-20260924.md`，制作经理回读 SHA256 `77BB1DD7556A41E34B21DDE0F82A60A3549E671DA0045BF0DAFC3237489CC975`。它列出完整双文件/构建/runner/结果哈希和历史 PID，明确该轮 `FAIL_OR_UNKNOWN`、`native-submit.json` 未产生、旧 profile 待权威读回；`basic12` 媒体包未部署，也无可播放 MP4。该清单是身份与门槛证据，不是 c19 或 profile 释放。

REL01 随用户桌面唯一交付要求仅修正上述清单的术语，制作经理已回读当前 SHA256 `070CC71F03042886E1223561E8642B8EA0447865CB1B7557D5D53BBD72E903C6`；旧 `77BB...` 为历史版本。文内原名 `web-build.result.json` 指桌面内嵌界面构建，`desktop-build.result.json` 指桌面主进程构建；候选、构建证据和 c19 未因此变动。

### ART01 真实桌面使用已派发

MGR02 已正式顺序释放 c19 同版构建；QA02 最后一轮只读诊断已正常关闭且 MGR02 核无指向 c19 的驻留进程。MGR04 独立复核 HEAD、双文件差异和构建指纹未漂移，承诺导演运行期间不部署 MEDIA02 或改 c19。制作经理再实查 HEAD `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`、仅两项文件修改、两文件 SHA256 与签收值一致，`postbuild.json` SHA256 `51C1EDB50285A458378C0B32693E85EF66014CBE23C7A5F9107D15B227D53945`，新 profile 路径尚不存在。

已派 ART01 使用 `c19/apps/desktop/node_modules/electron/dist/electron.exe` 及 `c19/apps/desktop`，环境变量 `AIJIAN_E2E_USER_DATA_DIR` 和启动参数 `--user-data-dir` 均指向新 `C:/Users/Administrator/.codex/worktrees/c19-trim-211c9e8-qa-20260923/.aijian-dev/art01-20260924-h87-user`。只按可见 Electron UI 分别核冻结剧本、长文的保存→送审→确认基线→批准→选来源→正常关闭重开；记录候选/profile/PID、项目与来源身份、全文哈希读回、原生确认和原始失败。ART01 正常关闭并回报进程/profile 释放后，制作经理再向 MGR02/MGR04 顺序交还 c19。此派包不修改产品、测试或输入，不调用供应商，不替代 QA。

ART01 已实调目标为 active 并启动独立 Electron，owned PID `22764`，profile 为上列新路径。候选/输入/构建哈希已核；已创建短剧项目，经 UI 粘贴 2,657 字符全文，页面显示“来源已保存并读回确认：pasted-source.txt”，当前状态“待审核”；ART01 已点击“审核来源版本”，正在核原生确认窗。此为制作使用过程中的阶段回报，尚无送审确认、批准、长文或正常重开结论。PID 与 profile 在导演正常关闭前仍由其独占。

制作经理只读进程核对发现上报 PID `22764` 是 `cmd.exe` 包装进程，Electron 主进程为其直接子 PID `18076`，Electron 子进程 `3812`、`22316`、`16352`，均位于 c19 桌面运行路径；新 profile 已存在。已提醒 ART01 把 wrapper/主进程分别记证并在完成后核本次树无驻留，不因该提醒中断操作或重复送审。上述 PID 为本轮临时身份，不可供下一轮复用。

ART01 后续阶段回报：短剧原文 UI 保存/读回与 SQLite 原始 SHA256 `466F23...` 一致；一次送审后来源清单仍 `draft`，`review_submission` 为空，submit challenge 未消费，未重复短剧送审。长文另建项目 `prj_0a4350b0cc714c97a279ad618fb7fd01`，从 TXT 文件入口导入，UI 全文预览为 24,079 字符、raw SHA256 `29A4AA...`；一次送审后 UI 到 `#story/审核中`，SQLite `review_submission=sub_c0bf89933d7543a6933ff62f38d28206`、V1、head rev2，submit challenge 已消费。长文基线确认抽屉捕获准确项目/版本/hash/rev2，提交一次后仍“审核中”，signoff challenge 未消费，尚无 signoff/decision。ART01 正做只读原生窗口观察；未用旧 QA profile、未调用 provider 或改产品/测试/脚本。以上为尚未结束的制作使用阶段证据，短剧送审失败归因与长文签署结果均待最终核定，不能记为批准来源或 M1 通过。

ART01 已正常关闭首轮 Electron 主 PID `18076` 及其子进程，又在**同一独立 profile** 重开检查持久化；新包装 PID `8152`、Electron 主 PID `22424`，制作经理只读核其进程参数匹配 ART01 profile。重开项目中心列两项目，长文全文 24,079 字符仍在 UI 预览、状态“审核中”；短剧已重开，原文读回核对中。长文基线确认再次按最新清单核对后操作，仍未见原生确认窗，DB signoff/decision 为空；ART01 表示不再重试。新窗口当前仍运行，c19/profile **尚未释放**，不得交 QA 或部署媒体包。

### ART01 M1 制作使用终包与释放

ART01 原始报告 `C:/Users/Administrator/Documents/Codex/2026-09-24/art01-m1-evidence/h87-native-source-ui.md` 已由制作经理回读。固定候选 HEAD、双文件 diff、构建指纹与派包一致。短剧项目 `prj_998c3c7140b8467ab1b030b3ac7b521f`、来源 `src_ade1fcdc9d79451bb8d1a48ede7b4fea`、版本 `ver_19a58a5540464894a50f167377637233`：UI 保存及正常重开预览包含 2,657 字符全文，SQLite `normalized_text` 与输入逐字一致，raw SHA256 `466F23B789B47FA1231B0891E80385A13E530B02DE2F74481C4E98F5732DE008`；一次送审后仍待审核、无 `review_submission`、submit challenge 未消费，未重试。

长文项目 `prj_0a4350b0cc714c97a279ad618fb7fd01`、来源 `src_c7fd7ec850cc4089ada07b5484450e1b`、版本 `ver_2349bce65bcb4feba367d2fb8576f4bd`：TXT 导入、正常重开后 UI 预览包含 24,079 字符全文，SQLite `normalized_text` 与输入逐字一致，raw SHA256 `29A4AA9E35D684C71BDFD67CD7265FB96C0682EA861B2F2008707CCD2646D697`；一次送审产生 `submission=sub_c0bf89933d7543a6933ff62f38d28206`、head rev2，UI 审核中。基线确认两次有界 UI 操作后未见原生确认窗，最终 signoff=0、gate decision=0、`accepted_version_id=NULL`、signoff challenge 未消费；未获批准，未选为制作来源。

上述为制作实际使用结论：**两份正文身份、全文保存及重开读回有证据；审核批准与制作来源闭环未通过**。失败根因尚待独立 QA 核定，不以导演报告替代 QA 签署。两轮 Electron 正常关闭；制作经理独立核 wrapper `22764/8152`、主进程 `18076/22424` 及已知子进程均退出，c19 路径无驻留，profile `SingletonLock` 不存在，`git status` 仍仅原双文件。ART01 profile 保留为证据，不清理或复用。已把 c19/build 与报告顺序交还 MGR02、MGR04；版本组后续媒体部署按独立门执行。

### 原始证据可追溯性限制

MGR02 要求原生确认的原始材料后，ART01 索引了其当前实施任务 `01a0d0ec-f628-7bb2-a50e-c18f8a895561` 的工具输出：短剧保存/审核抽屉/一次送审点击及只读 SQLite submission/challenge 输出；长文送审抽屉/一次送审、submission 与 rev2 输出；两次基线确认 UI 点击、UIA 根窗枚举及 session `36838` 空轮询、最终 signoff/decision/challenge 输出；两文重开 UI 全文和关闭/进程查询输出。报告目录仅有 `h87-native-source-ui.md` 摘要，**没有另存页面截图、原生弹窗截图、UIA 文本、sidecar 日志或 IPC 原始回执文件**。旧 profile 的 `workspace/workspace.sqlite3` 及 WAL/SHM 原样保留。空 UIA 轮询只能说明观察时未见弹窗，不能证明弹窗从未出现；摘要也不能替代原生按钮点击的原始证据。已把任务轮次与工具标题索引及缺失项交 MGR02，未为补证重跑或接触已交回 c19。

QA02 在另一全新 profile 的独立原生验证取得进一步定位证据：短文导入预览哈希与冻结输入一致；原生送审弹窗已出现且读到项目、版本、来源 hash 和 submit 动作，但确认控件无 `InvokePattern`，helper 在调用前停止，证据字段为 `invoke_attempted=false`、`invoked=false`。该轮长文未执行，runner 正常关闭且无 Electron 驻留；测试组正交原始文件和分类给 MGR02。此结果证明该次 QA 工具未尝试原生确认，不能把 runner 退出 1 直接认作产品拒绝送审，也不补足导演两对象的批准证据。

MGR02 已正式将该独立复验归类为**测试操作受阻**：送审对话框及项目身份定位准确，但控件无 `InvokePattern`，测试没有执行确认点击；不能判定产品送审成功或失败。测试组归档证据并释放 c19，随后接续最新固定候选的独立桌面验证。制作组保留 ART01 的真实使用失败现象与独立 QA 的工具阻断为两类证据，不互相覆盖。

### ART01 待派真实使用包

开工交接须含固定候选 SHA 与未提交差异、H87 运行入口、已验证构建/原生范围、独立 profile 与进程释放、冻结三份输入路径/哈希、允许的操作范围。ART01 对短剧全文和长文本分别按普通用户操作：输入、保存、提交审核、确认来源审核基线、批准、选择为制作来源、正常关闭并重开。每次记录项目 ID、来源 ID/状态、全文读回、输入哈希、关键 UI 操作及原始失败证据；区分产品失败、工具/定位器失败、环境失败和创作反馈。提交回执不算批准，短文通过不代替长文通过；该包不运行真实供应商或审片。

## M2 审片开工门

软件经理确认目前尚无可交 ART04 的实际可播放 MP4 或 QA02 播放证据。后端、桌面和生成契约基础包已静态审查交测试/版本经理；H87 Fake 调用与导出页面仍在实施，时间线快照已交，内嵌播放等待最小桥接方案。ART04 继续待命。只有收到 MP4 路径与哈希、固定候选 SHA、项目/镜头/时间线/素材映射、Fake 标记及 QA02 文件规格/播放证据后，才派实际审片并组织返修确认。

测试经理随后报告 MEDIA02 的 25 文件产品差异已由软件经理静态审查，版本组正做精确快照；须先完成并释放 c19 的 M1 诊断，之后才部署媒体候选并做独立桌面验证。此增量仍无可播放 MP4，ART04 不提前审片。

版本经理随后固定 EXPORT-REJECT03＋SOURCE-LAYOUT04 最新组合 26 文件快照，MEDIA02/basic12 保留对照；仍待 MGR02 正式归类并释放 c19/profile/PID 与媒体同步范围，版本组不会抢先部署。同步后由 QA02 独立核桌面任务→素材/时间线→实际 MP4 规格与播放。制作组仅在拿到可播放文件及 SHA256、准确项目/镜头/时间线/素材版本、Fake 标记、候选差异映射后派 ART04，静态快照不计影片完成。

ART04 真实审片包的最低核对项：同一 H87 已批准来源对应至少三镜、约十五秒、1080×1920 的可播放开发 MP4；逐镜记录实际画面与节奏、声音是否存在及可听问题、字幕/对白同步、实测时长和可复现时间点，核对片段与项目/镜头/时间线/素材版本映射。开发片必须显式标注 Fake 画面或占位声音；ART04 的反馈与 QA02 的编码规格/播放检查各自保留，均不等于《离别30秒》六镜真实成片或最终用户验收。

MGR02 后续确认 c19 已出现最新组合候选文件集合，但版本组仍在做精确哈希回读与交接；测试经理等固定候选身份才派桌面运行验证，防止把同步中的中间状态记为送测版本。当前无实际可播放 MP4/QA02 播放结论，ART04 继续待命。

最新 26 文件候选随后已由版本组固定并交测试，QA01 核对 26/26 文件哈希后在隔离数据库与测试文件内验证媒体合同及拒绝恢复，不涉及真实 provider。尚无任务→时间线→导出原生贯通或 MP4 播放证据。M1 下一次原生操作仍待可审查的控件交互方案，制作组不自行重复尝试审核确认。

最新 26 文件桌面候选的独立内嵌界面构建随后以 exit 2 失败：TS2339 在 `DevelopmentMediaPanel` 的 ready 分支 `reason`，TS7053 在 `UtilityPages` 的 `CPA_LOOPBACK` Record。原始 stdout 已保留，desktop 构建与原生 probe 未运行。版本/测试组已把最小修复交软件经理；修复、重新固定候选及独立 QA 通过前，不存在可交 ART04 的 MP4 审片包。

BUILD05 的 27 文件修复候选已由版本组逐文件同步，六个 QA 测试文件保持原样；QA01 正按新身份复跑定向检查，QA02 正从桌面内嵌界面到桌面主进程顺序重建。原生只读控件探针还需补项目、版本与来源哈希交叉核验，签审前不启动弹窗观察。此时尚无构建通过、原生来源批准或可播放 MP4 结论，ART04 仍待命。

BUILD05 重新构建仍在 `tsc -b` 停止，但失败移到 QA 测试文件 `developmentExport.test.ts` 与 `developmentFakeTimeline.test.ts`；前次两条产品源码类型错误未再出现。两轮 RED 原始日志分别保留，desktop 构建与 Electron 均未启动。测试文件修复与原工程门由 MGR02/QA 负责；制作组不把产品源码错误消失写成构建通过，也不派 ART04。

QA02 已完成原生弹窗**只读探针**的独立身份交叉核验方案：启动前要求同一项目的单一来源文档与冻结输入 raw hash、字节数及全文读回一致，再从 Electron preload bridge 的只读接口取得 project/version/content hash，与原生窗读值逐项比较；弹窗自身读值不能回填成 expected。脚本 diff、哈希和静态验证清单已交 MGR02 签审。此时仍受 QA 测试文件类型错误阻断完整构建，且探针尚未获签审并运行；上述仅是工具准备，不构成 M1 原生确认或 M2 导出证据。

MGR02 随后签收 QA01 的 BUILD05 局部数据/合同交包；制作经理回读最终 manifest SHA256 `1D9668950F9779C7A528DA870741127E45792C4A0E27ABF17C2CA63BFFA7A6F2`，其身份为 HEAD `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`、27 个产品文件与固定快照一致、产品哈希不匹配项为空。QA01 的定向结果为 API 16、desktop contract 33、studio-web adapters 22 通过及内嵌界面 typecheck exit 0；原始输出及各自哈希在 manifest 中，旧两轮构建 RED 保留。此证据只覆盖所列定向数据/合同和类型检查。QA02 已获**仅重新完整构建**授权，正核候选与测试文件后顺序构建桌面内嵌界面、桌面主进程；本轮不启动 Electron。完整构建、原生确认、实际 MP4 与播放结果仍待后续证据。

QA02 现报告该 BUILD05 候选的 studio-web 与 desktop 两项完整构建均 exit 0；构建前后 27 个产品文件及最终 6 个 QA 文件哈希一致，并已为两个 dist 中合计 73 个文件逐项记录哈希，原始日志与前两轮 RED 保留。构建清单已送 MGR02 回读，本轮没有启动 Electron。制作组待测试经理签收清单和正式释放原生观察后，才使用新运行证据判断 M1；构建通过本身也不产生 M2 MP4。

MGR02 随后独立复算 BUILD05 的 73/73 个 dist 文件字节数与哈希，签收两项完整构建 exit 0；`postbuild.json` SHA256 为 `188E6F4F6D990F75D5144D8D616F2187942C9785A9D24BD43DC5A248D68D971B`，构建后源码与状态一致。QA02 已获准以此精确候选和**一个新 profile**进行原生窗**只读**能力观察：先通过 bridge GET 独立取得来源身份，再与原生弹窗四项身份比较；本轮不点击确认。c19 当前由 QA02 顺序使用，制作组不并行占用。只有其正常关闭、释放并交原始结果后，才能判定下一步；构建签收不等于 M1 流程或 M2 MP4 通过。

QA02 的一次独立只读观察现已停止封存：短剧全文导入和 bridge GET 读回与冻结输入一致；原生窗的项目、版本、来源 hash、submit 动作与独立 GET 身份逐项匹配。确认控件的 UIA Pattern 列表为空；UIA 类名 `CCPushButton` 与同句柄 Win32 类名 `Button` 不同，探针因操作身份歧义退出 1，未继续查询 MSAA、未执行原生确认，不能判断 POST 或批准结果。本轮未保存原生弹窗像素截图，提交前页面截图不能替代。Electron 正常关闭，新 profile 与原始证据保留，关闭后候选文件未变且无 c19/Electron 驻留；QA02 已将结果交 MGR02。制作组把这次记为**原生操作探针受阻**，与 ART01 的真实使用结果并列保留，M1 仍未通过；待 MGR02 给出后续有界方案及正式运行释放。

制作经理已回读本轮原始 `result.json` SHA256 `0BF9A3DD31E6B7F41B7959434FAF88B36343CA8D22A6CE8B53341E7C2E440026` 与 `native-capability.json` SHA256 `414BBA1E1C12E6440700ED48C9D6F2CB2A4C65531EF5ED125D9571B410972EE5`，均位于 `C:/Users/Administrator/Documents/Codex/2026-09-23/aivora-git-c-users-administrator-documents/work/native-source-qa-20260924/evidence/qa02-capability-2026-09-24T02-48-53.178Z-22656/`。结果字段 `status=STOP_OR_UNKNOWN`、`read_only=true`、`native_action_attempted=false`、`normal_close=true`，不是产品 POST 失败回执。MGR02 现将 c19 顺序交 QA03 做 SOURCE-LAYOUT04 视觉专项，QA02 仅离线准备 MSAA 只读补探针；制作组继续不占用 c19。

QA02 的 v3 只读 MSAA 补探针现已获 MGR02 **静态**签收：旧 v2 与失败资料保留，v3 分别校验 UIA `CCPushButton`、Win32 `Button`，增加句柄稳定性和 MSAA 字段检查；PowerShell 5.1 解析零错误，无窗口运行按预期停止、未执行原生动作。QA03 仍独占 c19，MGR02 尚未授权 v3 实际观察；MSAA 能力、原生确认、长文来源闭环仍无新增运行证据。

QA03 随后交 BUILD05 同版真实 Electron 视觉专项：27/27 源文件及 73/73 dist 哈希一致；16 张截图/几何记录位于 `C:/Users/Administrator/.codex/visualizations/2026/09/24/01a0d0ec-e24e-7451-9fc4-977cb94c089b/qa03-source-layout04-evidence/qa03-layout04-2026-09-24T02-56-37.588Z-22592/`，制作经理回读 `result.json` SHA256 `3C87D5D8DAF92E61090B2DF7CC958495BB941B5379443F0C06AF316120B92555`。长文 8000 字的抽屉按钮初始需滚动；滚到底后，1424×881、1280×720、请求 1024×600（实际外窗 1024×680、内容 1008×641，受产品最小高度约束）均可见、可命中且 Tab 可达。1024 请求尺寸的来源输入页存在长文件名/状态文字明显堆叠与底部操作区拥挤；制作经理直接查看 `1024x600-native-request-source.png` 确认覆盖，也见 1280 图中长状态行侵入左卡片下部。已把原图和最小修复建议交软件经理/唯一 UI owner；小窗来源页整体视觉尚不能签通过。QA03 未执行原生送审，正常关闭并释放 c19；MGR02 可顺序安排 QA02 v3 只读观察。若产品 CSS 再修改，须重新固定身份、构建及视觉回归。此视觉缺口与 M1 原生控件操作歧义分别记录。

MGR02 进一步校正验收对象：本轮量到可见、可命中、Tab 可达的是**来源审核抽屉**的关闭/提交按钮；原红框关注的**来源预览卡**按钮尚未被这轮原生证据证明，不得写成该按钮验收通过。MGR02 已授权 QA02 在原 BUILD05 候选上以新 profile 做一次 v3 原生控件能力**只读**观察，产品 CSS 待其关闭释放后才由版本组顺序同步。

QA02 v3 唯一一次新 profile 观察已按失败停止：33 个源码/QA 文件、73 个 dist、输入和探针哈希在运行前后吻合；短剧同项目 bridge GET 与原生窗口的 project/version/content hash 相同，UIA/Win32 按各自类名找到同一按钮句柄。`AccessibleObjectFromWindow` 返回 HRESULT 0，但 PowerShell 将 COM 对象转为 `Accessibility.IAccessible` 时报类型转换异常，MSAA name/role/state/default_action 均为空，原生确认未执行。制作经理回读原始 `result.json` SHA256 `F9FB1351EC9161F71AC5A2D408EEF2687848EB8AA5945E219D1E0B5FF9080CC1` 与 `native-capability.json` SHA256 `6CAA73E173315EB7B89225E965147382818C759718F1DF96CA9EF458EDE1E1B2`，位于 `C:/Users/Administrator/Documents/Codex/2026-09-23/aivora-git-c-users-administrator-documents/work/native-source-qa-20260924/evidence/qa02-capability-2026-09-24T03-02-59.857Z-9308/`。应用正常关闭、c19 无驻留，旧失败与新失败均保留且未重试。MGR02 正核可用的 Windows 控件接口；此为探针 COM 类型转换阻断，不判产品来源送审或批准成败。

MGR02 已正式将 c19 释放给版本组，待 SOURCE-LAYOUT06 的 CSS 修复字节同步。QA02 当前只离线准备一次受控按钮操作方案，不再占用 c19；新 CSS 同步后须重新固定候选身份与构建，并把原红框的**来源预览卡按钮**与来源审核/确认链路分开验证。旧 BUILD05 的 GREEN 构建、QA03 抽屉几何和 QA02 两次只读停止证据均保留，但不能替代新候选的验证，也不能作为 M1/M2 通过。

SOURCE-LAYOUT06 的单 CSS 修复现已由版本组同步为新 27 文件候选。制作经理回读 `C:/Users/Administrator/Documents/AIVORA/management/manager-handoffs/release-snapshots/20260924-layout06-27/SNAPSHOT.json` SHA256 `A74B25C2CAD5532F57DDDBB89787B89F911D532F3DA949DB878D7F92870148CB`，HEAD 仍为 `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`、27 文件 fingerprint `9B59BDC61705D085563EFF0A09EC55790133CE5C80ED671AA93657A7BA04549E`；c19 当前 `v2-story.css` SHA256 `770317A20E0B972AD7237476A4BD9F2CEC84E73777D745816386C9B31C14F3D9` 与新快照一致。旧 BUILD05 dist 已失效；QA02 正对新候选重建桌面内嵌界面及 desktop，MGR02 签收前不以旧构建启动 UI。QA03 待新构建后专测原红框来源预览卡按钮与 1024 窄窗输入卡。受控原生按钮方案仍只在静态准备，M2 实际 MP4 尚未交制作组。

SOURCE-LAYOUT06 新候选的 studio-web 与 desktop 顺序构建均 exit 0；MGR02 已独立复算新构建的 73/73 个 dist 文件字节数及哈希并签收。制作经理回读 `C:/Users/Administrator/Documents/Codex/2026-09-23/aivora-git-c-users-administrator-documents/work/native-source-qa-20260924/evidence/m1-layout06-build-20260924T031447845Z/postbuild.json` SHA256 `C8BC8635A16F1400EF774B88A58DD487B91C0ED47C5F47327FF39CE8B91977F4`，文件列出 27 产品/6 QA 源文件哈希匹配、25 个内嵌界面 dist 与 48 个 desktop dist、`c19_active_process_count=0`，且声明本轮仅构建与哈希核验、未启动 Electron。MGR02 已让 QA03 顺序独占新 profile，专测原红框来源预览卡的 **draft 刷新按钮**与 1024 原生输入卡；review 基线确认按钮缺席时记 N/A，不能签双按钮。来源原生确认与 M2 MP4 均尚无通过结果。

QA03 的 SOURCE-LAYOUT06 真实 Electron 专项已产生 9 张原始截图及 `result.json`，目录为 `C:/Users/Administrator/.codex/visualizations/2026/09/24/01a0d0ec-e24e-7451-9fc4-977cb94c089b/qa03-source-layout06-evidence/qa03-layout06-2026-09-24T03-20-31.389Z-11568/`；制作经理回读结果 SHA256 `76969C55740BAC56A6E92D30A22D92707338C76305ECDA27967E4395B55332A8` 并直接查看 1024 原生顶部与滚动后截图。旧版 1024 长文件名/状态文字稳定遮盖在新 CSS 中已不再出现；来源预览卡 **draft“刷新来源状态”** 在三种窗口条件下滚动后均可见、命中且 Tab 聚焦，1024 实际内容区域为 1008×641。draft“审核来源版本”仅截图可见，**尚缺该按钮独立命中与键盘测量**；review 状态的基线确认按钮仍未出现，记 N/A。MGR02 已保留这些缺口，不能据单按钮证据签整张预览卡或双按钮通过。QA03 未执行来源审核确认；M1 原生操作与来源批准仍未完成。

QA02 的一次原生按钮操作方案仍处静态签审：MGR02 发现运行器对新 `postbuild.json` 的字段名不匹配，QA02 已修正为实际 `product_snapshot_sha256`，并用 SOURCE-LAYOUT06 真签名快照、6 文件 QA 叠加清单和新构建收据做**只读 preflight**，27/6/73 项核对 exit 0；没有创建 ledger 或 profile，也未进入 Electron 启动路径。后续即使发送 Win32 `BM_CLICK` 消息，消息层返回值也仅说明投递，必须另以服务端来源清单权威读回判业务结果；超时/不明回执保持 UNKNOWN。当前尚未向 AIVORA 发送原生确认，不计 M1 通过。

MGR01 对 QA03 `1424x881-native-request-top.png` 的长文件名压力图另指出：左侧输入卡底部项目名及后续说明仍被裁。制作经理回看原图确认项目名贴近卡片底边、下方说明被固定操作区遮挡；SOURCE-LAYOUT06 的**宽屏压力场景保留视觉 RED**。这不抹去已证明的 1024 场景改善与 draft 刷新按钮可达性，后续 CSS 修复须重新固定候选并做相应回归；当前不混入已签 BUILD06 候选。

QA03 已正式释放 c19。MGR02 再核 SOURCE-LAYOUT06 同版 27 产品、6 QA、73 dist 共 106 文件哈希一致且进程为 0，并回读一次性 `BM_CLICK` 方案：独立 bridge GET 身份、唯一 Win32 Button 句柄/PID/子窗口/前台门、发送前持久化 UNKNOWN、`SendMessageTimeoutW` 最多一次、发送后服务端权威只读读回、异常不重发。隔离 mock 的一次 BM_CLICK→一次 BN_CLICKED 仅为机械证明。现只授权 QA02 用**一个新 profile**做短剧 submit 原生确认尝试；未授权 signoff、decision 或长文。制作组待服务原始回执，不把消息返回值或工具动作计作来源审核成功。

MGR04 明确截至本次交接仍无可播放开发 MP4 的绝对路径/SHA256、项目/镜头/时间线/素材映射、Fake 标记或 QA02 规格/播放通过证据；当前 SOURCE-LAYOUT06 虽有新构建 GREEN，M1 来源尚未批准/可选，也未形成真实媒体导出文件。ART04 继续待命，不做空审片或以 Fake 测试样本充当影片。

QA02 的 SOURCE-LAYOUT06 新 profile 短剧 submit **唯一授权尝试在原生发送前停止**：冻结全文及同项目 bridge GET 身份一致、唯一原生 owner/对话框已找到，但 sender 把“当前修订”误按整行行尾匹配，真实同一行还含“评审证据修订”，故原始错误为 `Native revision count=0`，尚未进入按钮、Win32 或前台门。制作经理回读 `C:/Users/Administrator/Documents/Codex/2026-09-23/aivora-git-c-users-administrator-documents/work/native-source-qa-20260924/evidence/qa02-bm-click-2026-09-24T03-30-26.481Z-22692/` 中 `result.json` SHA256 `5AC025ACF040D976AF2F671C5C80643D26DAAB9C8581C92AD691BA80EDADB170` 和 `native-bm-click.json` SHA256 `B55C2038CC82956E73087E75CD5FF8770E1DFE6C5E354B9F63D8607A7B728D96`；原始字段 `status=STOP_BEFORE_NATIVE_SEND`、`native_action_attempted=false`、`send=null`。随后 12 次服务权威 GET 的 review_version/submission 仍为 null、全文不变；正常关闭、进程为 0、源/dist 未漂移。MGR02 将其归为 sender 解析问题而非产品送审失败，保留单次 ledger、profile 与原始资料，不复跑。c19 已释放版本组同步 LAYOUT07 的宽屏视觉修复；QA02 离线修解析并以原弹窗文本做正反例，新候选仍需重构建与另行签审。M1 来源闭环及 M2 MP4 均未通过。

SOURCE-LAYOUT07 的单 CSS 修订已同步 c19。制作经理回读 `C:/Users/Administrator/Documents/AIVORA/management/manager-handoffs/release-snapshots/20260924-layout07-27/SNAPSHOT.json` SHA256 `569E8B63A2545D7178E18B22348330B10D8E5B628410B4E45732E4B3CCFFC21F`：HEAD 仍为 `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`，27 文件 fingerprint `E6C0D1673EE9F4228659EEEA8444FC48314737DF91C1570E8B5B9C253D79E201`；c19 当前 `v2-story.css` SHA256 `79C6568149AC82D84C1D2FBD4702E60E400AEF32DD38ADFDD477DF86E54448B4` 与新快照一致。LAYOUT06 的 GREEN dist 与视觉结果保留作历史证据，不能代替 LAYOUT07 新构建/视觉回归。QA02 正按新候选核 27 产品+6 QA 并顺序重建，尚未启动 Electron；修订行解析器仍只在离线准备。

QA02 随后报告 LAYOUT07 的 web 与 desktop 顺序构建均 exit 0，并交全量 dist 哈希给 MGR02 回读。制作经理独立回读 `C:/Users/Administrator/Documents/Codex/2026-09-23/aivora-git-c-users-administrator-documents/work/native-source-qa-20260924/evidence/m1-layout07-build-20260924T033449449Z/postbuild.json` SHA256 `5B395E855B8502515741345EFCC35A58CE5172EE1A3829437E2BBDE0E133042F`：快照哈希/27 文件指纹吻合，27 产品+6 QA 源哈希匹配，25 个内嵌界面及 48 个 desktop dist 已列清单，关闭后 c19 驻留进程数 0。此为新候选构建证据，仍待 MGR02 复算签收及 QA03 原生视觉复测。QA02 离线修 sender 的修订行解析：原文“当前修订：1；评审证据修订：0”在同一行，新逻辑需两个标签各唯一并与 bridge GET 修订精确比较；未启动来源确认。

MGR02 已复算 LAYOUT07 的 73/73 个 dist 字节数和哈希，签收 web/desktop exit 0、27 产品+6 QA 源与状态一致、无 c19 驻留。QA03 获新独立 profile 的一次合并视觉复测：1424 长名压力下左卡内部滚到底能否看到项目输入与尾部说明；draft 来源预览卡“刷新来源状态”和“审核来源版本”**分别**测命中与 Tab；再核 1280 与请求 1024（实际原生最小高度钳位）。review 基线按钮只有权威 review 状态才可测，当前 draft 记 N/A。QA03 独占 c19 期间，QA02 仅离线修旧 LAYOUT06 sender 解析，不启动新候选原生确认；构建与视觉证据不等于 M1/M2 通过。

QA02 的 sender 同行修订解析现用 LAYOUT06 **旧原始 visible_text** 跑通离线 8/8 用例：LF、CRLF 正例接受；缺字段、重复行、坏格式、与独立 bridge GET 修订不一致均拒绝。早期测试脚本受 PowerShell 5.1 无 BOM 中文读取及集合写法影响，原始 stderr/脚本版本均保留。8/8 只证离线解析，不证明 sender 在 LAYOUT07 Electron 中发出了原生消息，更不证明来源业务通过。

QA03 的 LAYOUT07 真实 Electron 合并视觉复测已正常关闭并释放 c19。制作经理回读 `C:/Users/Administrator/.codex/visualizations/2026/09/24/01a0d0ec-e24e-7451-9fc4-977cb94c089b/qa03-source-layout07-evidence/qa03-layout07-2026-09-24T03-39-21.176Z-21836/result.json` SHA256 `3085CF04F0E10CEC33BA43CE3EEA4B390022B74E25509AB494BECADA24698CB7`，共三档窗口、12 张原始图、`status=OBSERVED`、错误 0、正常关闭。制作经理直接查看 1424 原生左卡滚到底及请求 1024 原生预览卡键盘图；1424 长文件名压力下项目输入与尾部说明可完整滚到可见。MGR02 核对三档窗口中 draft 预览卡的“刷新来源状态”和“审核来源版本”均分别可命中、可用 Tab 到达；结果中各档两个按钮 `visible=true`、`hit=true`，键盘序列分别列出两按钮。真实 review 状态尚未建立，基线确认按钮 `present=false`，记 N/A。该视觉结果只覆盖 draft 与所测窗口，不证明来源送审、批准或最终生产来源选择。

QA02 已将 sender 修订行解析修复包交 MGR02 审查；制作经理回读 `C:/Users/Administrator/Documents/Codex/2026-09-23/aivora-git-c-users-administrator-documents/work/native-source-qa-20260924/evidence/native-revision-static-20260924T033407286Z/revision-review-manifest.json` SHA256 `25AE83F38DAC6978BB1AB9EB92AF541B196DF0538331CB31D2718B95C4314BA8`。包中有旧新脚本哈希、精确 diff、各次原始 stdout/stderr 与 LAYOUT07 真清单只读预检；PowerShell 5.1 解析零错误，旧原生 visible_text 离线 8/8 通过、无窗口调用在发送前拒绝，27/6/73 文件核对通过。MGR02 正审唯一目标、一次发送和失败封存门。**未启动 Electron 或执行 BM_CLICK**；真实送审仍待签核与另行授权。

MGR02 签审后仅放行 QA02 以 LAYOUT07 **新 profile、一个短剧项目、最多一次 submit** 尝试；未授权 signoff、decision 或长文。最终只读预检的冻结输入、签名、HEAD 与 27/6/73 文件吻合，但本次真实尝试在发送前再次停止：同项目项目/版本/hash、两项修订、按钮句柄、可见状态均吻合，`foreground_handle` 与确认对话框句柄不同，前台归属门失败。制作经理回读 `C:/Users/Administrator/Documents/Codex/2026-09-23/aivora-git-c-users-administrator-documents/work/native-source-qa-20260924/evidence/qa02-bm-click-2026-09-24T03-47-31.678Z-13852/` 中 `result.json` SHA256 `4B06250B4BF5C452C617AF3881513240FB1D8C5879DCEB1D545F654F1A52E67A`、`native-bm-click.json` SHA256 `0E5BAC5241530E0910857E017A4E4B151ED3CFEBD79FF5DCDA546D0CF36525DD`；原始字段仍是 `status=STOP_BEFORE_NATIVE_SEND`、`native_action_attempted=false`、`send=null`。12 次服务 bridge GET 显示同项目/版本/短剧全文不变，review_version_id 与 review_submission_id 均空。Electron 正常关闭、进程为 0、profile 无锁、27/6/73 哈希及 Git 状态未漂移；未重试。MGR02/QA02 正只读诊断前台归属安全门，不能把这轮归作产品送审失败，也无 M1 批准结果。

MGR02 将本轮归为桌面焦点阻断：原生发送门的**即时前台句柄与 AIVORA 确认对话框不一致**，所以没有发送。QA02 之后的只读采样发现同一前台句柄当时属于 VMware，但现有记录**不能证明尝试瞬间的窗口归属**；不得把后采样写成即时证明。测试组继续调查可验证的聚焦方式，不在未知前台下发送按钮消息。12 次服务读回无送审记录、`send=null` 的结果保持不变。

QA02 的首轮证据清单 `C:/Users/Administrator/Documents/Codex/2026-09-23/aivora-git-c-users-administrator-documents/work/native-source-qa-20260924/evidence/m1-layout07-native-submit-20260924T040958Z/first-round-review.json` 已由制作经理回读，SHA256 `5B1543434A581DA85A73A2ED4EAF9D6B73340426FEFBED74AE9FE110D5D63151`；它把即时原生停止、12 次权威读回、正常关闭、后采样与所缺即时窗口归属证据分开列出。旧候选 ledger 保留，不重试该轮；signoff、decision、长文和 M2 均未执行。

MGR02 已接受上述时序边界并写入测试交接：发送瞬间只证 `foreground_handle=262296` 不等于 AIVORA dialog `723076`，关闭后只读采样的 VMware 归属仅作后续争用线索。QA02 正静态设计**不创建项目、不触碰来源**的焦点能力探针：独立 profile 仅启动 Electron，读空闲时长与前台归属，最多一次 `BrowserWindow.focus()` 并立即读回；脚本与停止条件须先审签，本轮不运行 UI。另拟追加式 ledger 供未来新候选单次尝试使用；旧 ledger 保留、不盲重试。制作组继续等待可审查的真实来源通过证据。

QA02/MGR02 将探针证据边界进一步明确：当前 AIVORA 主窗在 `ready-to-show` 时本身会 `show()`，焦点探针需分别记录“启动后已获前台”与“额外一次 `focus()` 后才获前台”，并同时核 Electron `isFocused()`、Windows 前台句柄和会话空闲时长；近期有人机输入则停止以免争焦点。即使探针证明**主窗**可获焦点，仍不能替代后续**原生确认对话框**在实际 submit 瞬间的前台归属验证。

MGR02 对后续第二次短剧 submit 的控制方案要求：第一轮 ledger、`send=null`、12 次无送审读回及正常关闭证据原样保留；只有新的明确签署把这些身份和结果绑定后，才另建**追加式 ledger**，不复制快照、不覆盖旧记录以绕过一次性门。先完成不触碰来源的焦点能力探针，再判断是否值得放行第二次真实流程。当前没有第二次授权或来源批准。

MGR02 对一次无项目、无来源动作的焦点能力探针完成静态审查并签署独立回执。QA02 的 `focus-capability-20260924T040335Z-mgr02a` 唯一运行在 **Electron 启动前**停止：`C:/Users/Administrator/Documents/Codex/2026-09-23/aivora-git-c-users-administrator-documents/work/native-source-qa-20260924/evidence/focus-capability-20260924T040335Z-mgr02a/result.json` SHA256 `88B98EC74F55CD0890300E1D267307ABA74BC682F9A4B639CD6E20F647692228` 记录 `STOP_BEFORE_FOCUS`、`focus_call_count=0`、`source_action_attempted=false`；原始 `prelaunch.stderr.raw` SHA256 `A1D92F5BE08DC6A4B78582870023058B7ADC735252625E7CAE402796035DA780` 是 PowerShell 5.1 计算空闲时长时 `-1` 向 `UInt64` 转换失败。前后签名预检为 27/6/73 一致，未创建 profile、未启动 Electron、旧 ledger 不变。该一次审批已消耗，QA02 仅离线修复 helper 并准备新哈希/评审；不以这次探针推断主窗或原生对话框焦点，更不推断 M1 送审结果。

QA02 随后完成工具层离线修复并释放 c19：失败探针原始清单 `C:/Users/Administrator/Documents/Codex/2026-09-23/aivora-git-c-users-administrator-documents/work/native-source-qa-20260924/evidence/focus-launch-20260924T040335Z-mgr02a/failed-probe-review.json` SHA256 `56963A7CFCDCBE9856B8201CAD0A1F33E17D02D0EC0290322B0FE0DF543EFAFD`；离线修复清单 `.../evidence/focus-idle-ps51-fix-20260924/fix-review.json` SHA256 `F9E0289AC7EE4B405CE9E59E0A340822328B1AB7E54FE04FAFB19B98F34F329A`。旧 helper SHA `E820F2F55C673451B5B23168E82A65AF58AE8C6C8C34B5E420A5B77AA7AB1702`，新 helper SHA `9719C5CF108B8439DD59CD73551EB8A6B201FAFE3B6E6A91E8F20C3B11D3283C`，改用十进制 UInt64 掩码；PS5.1 边界用例 6/6、语法错误 0，真实只读 `GetLastInputInfo` 路径 exit 0。该次只读采样时前台为 VMware，是**后续采样**，不是前次原生送审瞬间的窗口归属证据。MGR02 尚须以新 helper 哈希重新独立审签，旧审批不适用；未重跑 Electron、未送审、未形成 M1 焦点或来源结论。

MGR02 以新 helper 哈希另签 `focus-capability-20260924T040954Z-mgr02b`，QA02 只运行一次无项目/无来源动作的隔离 Electron 探针。制作经理回读 `C:/Users/Administrator/Documents/Codex/2026-09-23/aivora-git-c-users-administrator-documents/work/native-source-qa-20260924/evidence/focus-capability-20260924T040954Z-mgr02b/result.json` SHA256 `2F5E7CB8815A6A7CDE610095980975D666B50828031AB68DFD5052B80F3B2BFA`：空闲/桌面前门通过并启动 Electron，但脚本在主窗可见前即断言可见，`status=STOP_BEFORE_FOCUS`、`focus_call_count=0`、`source_action_attempted=false`；正常关闭、后置 27/6/73 核对 PASS、旧 ledger 不变。该次仅证明探针等待窗口显示的时序不足，未测出主窗聚焦能力，更不能推断原生送审对话框焦点或来源批准。测试组封存此轮并审后续脚本调整，不复用已消耗审批。

MGR04 本轮直接回报仍无可交 ART04 的 M2 可播放开发 MP4：LAYOUT07 的 27 文件产品候选、桌面构建 GREEN 与局部来源视觉 GREEN 不构成媒体导出或播放；QA02 两轮焦点能力探针都没有来源动作。版本组继续等待软件/产品交固定 MP4 绝对路径和 SHA256、Fake 开发标识、项目/镜头/素材/时间线映射、规格，再由 QA02 同版实际播放及规格回执。REL02 待命、不打包发布；制作组不派 ART04 空审片。

QA02 完成第二次失败探针的封存与离线等待门修订，释放 c19。制作经理回读失败清单 `C:/Users/Administrator/Documents/Codex/2026-09-23/aivora-git-c-users-administrator-documents/work/native-source-qa-20260924/evidence/focus-launch-20260924T040954Z-mgr02b/failed-focus-review.json` SHA256 `8A3F6C74BF580E3A5BB59DC235DA614C3F8CB5C5657070F740A8FAF775F9A941`；修订清单 `.../evidence/focus-ready-wait-static-20260924/ready-wait-review.json` SHA256 `2221E8571821254717682BD5E8F54F2283B0A28353393162B81C356F2E45361D`。work 区 runner 旧 SHA `0196697D2889902026A78195B727D3E429DA6C08C5DEBC5688AB19C818DFA277` → 新 SHA `EEFFF75DA61558DA0D35C2353C13CF91EE0A2867C1675F539B467C1682035A2C`；初始 PID/HWND 先落盘，再有界等待 renderer 根节点及同一主窗可见，离线 6/6 用例通过。新 runner **未**启动 Electron，仍需 MGR02 独立审查、另签新 attempt；焦点能力及来源业务均无新结论。

第三次独立签署的无来源焦点探针 `focus-capability-20260924T042032Z-mgr02c` 已运行并正常关闭。制作经理回读 `C:/Users/Administrator/Documents/Codex/2026-09-23/aivora-git-c-users-administrator-documents/work/native-source-qa-20260924/evidence/focus-launch-20260924T042032Z-mgr02c/focus-probe-review.json` SHA256 `F5814700A90BCFD77E5C4A34A1EDCE42E461BCBDA46B059E66341D8983C0EC7D`：34 份原始/签名文件列入清单，主窗初始隐藏，renderer ready 后产品自然显示；Electron 与 Win32 两次读到同一 AIVORA 主窗 HWND `591924`/PID `16400` 已在前台，输入 tick 未变，所以 `status=ALREADY_FOCUSED_NO_CALL`、`focus_call_count=0`。正常关闭，后置签名 PASS、相关进程 0、旧 ledger SHA `8C2F15CFC225421736E52C4D4AD4060BA81BE5295F3686D634BD420D1A0726B0` 未变。此证据只说明**本次启动后主窗自然获前台**；失焦恢复、来源确认对话框即时前台和来源送审/批准均未测得。QA02 仅在 work 区设计追加式第二次短剧 submit runner，须先硬核第一次 `send=null`、12 次服务 GET 与正常关闭，再另签授权；未运行来源动作。

MGR01 转来 QA01 的 M2 只读源码边界，制作经理在当前 c19 树 `services/api/src/aijian_api/fake_media_package.py` 核对：`GENERATOR_VERSION=phase0.fake-media.v1`、固定 3 镜、每镜 125 帧、25 fps（每镜 5 秒、合计 15 秒），素材预览为 320×568；`_shot_style()` 由来源 SHA 决定色块与音调。即使未来同一 H87 实际跑通 Fake→时间线→MP4，该产物也只证明**本地 Fake 开发链路及来源绑定**，不等同《离别30秒》六镜/750 帧剧情、对白、口型或真实供应商成片。当前依然没有 MP4 绝对路径/哈希及 QA02 播放证据，ART04 不审静态假样本。

MGR02 的 M2 只读验收方案发现同项目连续性的实际约束，制作经理在 c19 `apps/desktop/src/main.ts` 核对：开发隔离入口 `AIJIAN_E2E_USER_DATA_DIR` 设置 Electron `userData`（第 47–57 行），sidecar 的 `AIJIAN_DATA_DIR` 与开发 MP4 导出 workspace 都指向 `join(app.getPath("userData"), "workspace")`（第 74、198 行）。因此 M1 若在受控 profile 中实际批准来源，M2 验同一项目须在 M1 正常关闭和独占权交接后**串行复用同一 profile/workspace**，用新 M2 操作 ledger 和证据；另建空 profile 将读不到该项目，不可复制数据库来伪造批准状态。此约束不改变 ART01 用户核对需独立隔离环境的要求，也不表示 M1 已批准或 M2 已导出。

QA02 已把第二次短剧原生送审的**离线执行包初稿**交 MGR02 审阅。制作经理当时回读 `C:/Users/Administrator/Documents/Codex/2026-09-23/aivora-git-c-users-administrator-documents/work/native-source-qa-20260924/evidence/attempt02-static-20260924/static-review.json` 初稿 SHA256 `8E5E58A1885CE4B3420F97586CC51A9CE63655931AB20D08D79663C9A1034F9D`，后经只读诊断补强已被新内容替代：初稿状态 `READY_FOR_MGR02_REVIEW_ONLY`、`approval_present=false`、Electron/新 ledger/来源动作/native send 均未发生；27 产品、6 QA、73 dist 签名预检一致。首次失败证据门 `PASS`，7 个篡改反例（动作已发生、send 非空、已有 review 版本、全文变化、非正常关闭、focus 已调用、旧 ledger 变化）均拒绝。新 runner SHA `5A8B8234863D994099641925A35748FBDA7B24AC6DCB7092310ABD423FD2675F`、初稿差异 SHA `EE838205BEACEFD24C4399D91E6970E463A95FF76F3463466E2ACA86404551E4`；它在建项前与点击来源送审前核主窗前台，原生 sender 仍独立核发送瞬间的对话框前台。此包只证明门禁可审，**尚未获第二次执行签核**，不构成来源送审或 M1 通过。

MGR02 审第二次 submit 静态包后**暂缓真实运行签核**：现有门已拒绝首次发送不明、12 次权威读回不一致和旧 ledger 漂移，并为第二次准备独立追加账本；但若原生对话框在发送瞬间失焦，须同一瞬间记录竞争窗口 PID、类名和标题，不能在关闭后仅凭句柄推断。QA02 将仅加只读诊断并保持发送门不变；待新脚本哈希复审。现无第二次来源动作。

QA02 根据 MGR02 审查意见提交第二次送审静态包新版：同一路径 `static-review.json` 当前 SHA256 `A47280D56EB52FE68E6351FE6AFD946C671DFCAEF6C6349D5D5C2830F513D703`，第二次专用 `native-bm-click-attempt02.ps1` SHA `5D11EA3DD62E803C1947ABB2DFDE96CBA7CF572F82835DEA82CEDAFFA8679265`；原 `native-bm-click-once.ps1` SHA `19AB699DE57EFB2412D73EDC497C1A1207814B7F25B5ADE6E2B9453C8DFE9AF0` 未改。新 sender 在原严格前台门之前，将**同一瞬间采到的前台 HWND**及 PID、线程、类名、标题、根窗口/owner 先落盘；无窗口实际调用在发送前停止，离线竞争 HWND 被拒绝。新版仍为 `READY_FOR_MGR02_REVIEW_ONLY`、`approval_present=false`、Electron/来源动作/native send 均 false；待 MGR02 精确复审签发，不能当作第二次真实送审。

MGR02 曾为 attempt02 建具名审批 `attempt02-approval-20260924T043931Z-mgr02a.json` SHA256 `2283D8B95CEA9ABF8CE3BE4F3B7CDB747BE1FF3ECC5D7B75F1429B9993085D97`，先运行**只读** `--preflight-only=true`，结果 exit 1：runner 的首次 `first_native_sha256` 常量混有大写 `BD`，审批字段为小写，严格字符串比对失败。此为测试脚本哈希写法 RED，发生在建 ledger/profile 与启动 Electron 前，不是产品来源送审失败。QA02 正保留原始 stdout/stderr 并只改该常量、更新 runner SHA/静态清单；旧审批因脚本哈希变化不再用于真实运行。新审批与只读预检通过前，第二次来源动作仍未放行。

QA02 已将上述预检 RED 只读复现并封存：`C:/Users/Administrator/Documents/Codex/2026-09-23/aivora-git-c-users-administrator-documents/work/native-source-qa-20260924/evidence/attempt02-native-hash-fix-20260924/replay.json` SHA256 `BE65B947F58C0250FCF1378F84C7F7EE8F79A42660B00E23CC2FF964AE610271` 连同原始 stdout/stderr/退出码记录。仅把 runner 中 `firstEvidence.native` 常量改小写，单行差异 SHA `40B2AB20AC18330AE09D9CDE3FDFC4A9CE19277D801F37249C7F2A3436931BC2`；runner 新 SHA `1A322E428FE7582AF84B6AF1BF8009D3D6DED1ABBC7652B3BB43D3E933A7A00A`，新静态清单 SHA `BC7BF8A6C79E11BBFE90216C806E12AB05685AC47C7B358AFB15CBD4AD6A1598`、状态 `READY_FOR_NEW_MGR02_EXACT_APPROVAL`。旧审批绑定旧 runner 已失效；修后未启动 Electron、未建 ledger、未执行来源操作。下一步须 MGR02 新签并先让只读预检通过。

MGR02 以新 runner SHA 重新签 `attempt02-approval-20260924T044400Z-mgr02b.json` 后的**只读启动包装**首次失败。制作经理回读 `C:/Users/Administrator/Documents/Codex/2026-09-23/aivora-git-c-users-administrator-documents/work/native-source-qa-20260924/evidence/attempt02-preflight-20260924T044400Z-mgr02b/receipt.json` SHA256 `7F8209FF912887CD39638E7B270CD9F9956619FB946F13E624BD760680FA8684`、`stderr.raw` SHA `F1C51A2192F358B22D43A3AA8EB129B623E3A10384C2AC93E257D238B1C37D22`：PowerShell 参数数组把 `--build=` 与路径、`--approval=` 与路径、`--approval-sha256=` 与值、`--attempt-id=` 与值拆成独立元素，Node 在选项解析即 `invalid option` exit1。attempt evidence/ledger/profile 均未创建。这是调用包装错误，**不能算 runner 的业务只读预检结果**，更不是产品失败；原始 stderr/argv 应保留，须纠正包装参数后重新做只读预检。

MGR02 修正 PowerShell argv 包装后，在新目录以**同一审批与 runner**重新做只读预检。制作经理回读 `C:/Users/Administrator/Documents/Codex/2026-09-23/aivora-git-c-users-administrator-documents/work/native-source-qa-20260924/evidence/attempt02-preflight-20260924T044400Z-mgr02b-corrected/receipt.json` SHA256 `A3EB2F7EA054E2E539BFDBB14B54FEAF4CF18EE4FD35C91DCD00AEDC0A4345BA`：exit0/`PREFLIGHT_OK`，27 产品、6 QA、73 dist；首轮 native 未发送、12 次权威 GET、焦点探针 0 次 focus 均核过；新 attempt evidence/ledger/profile 仍不存在，Electron 未启动。审批 SHA `57013B9A15986E84877859782FB0D878C8A8E474B11B088527F7650D0223F713`、runner SHA `1A322E428FE7582AF84B6AF1BF8009D3D6DED1ABBC7652B3BB43D3E933A7A00A`。MGR02 随后仅授权 QA02 按此审批**一次短剧 native submit**；长篇、signoff、decision、M2 均未授权。本条是放行前预检，不是送审业务回执。

QA02 获批的第二次短剧送审尝试已**在 Electron 启动前**被 60 秒空闲门阻断。制作经理直读 `C:/Users/Administrator/Documents/Codex/2026-09-23/aivora-git-c-users-administrator-documents/work/native-source-qa-20260924/evidence/qa02-submit-attempt02-20260924T044400Z-mgr02b/result.json` SHA256 `71094E94476FBB8FAE2661CC274F6DB22D7D1E780F36519744445CED19638C6F`：`prelaunch.idle_ms=10672`，错误 `prelaunch: recent user input`，`cases=[]`，无 Electron/来源动作/native send；后置相关进程 0、旧 ledger 未变、源/dist 和 Git 状态未漂移。需准确保留：runner **已创建**新的 attempt02 追加账本（`outcome=UNCONSUMED_OR_UNKNOWN_UNTIL_AUTHORITATIVE_READBACK`）及空 profile 目录，再被空闲门挡下；不可写成“未建账本/profile”。一次性审批已消耗，不重跑；QA02/MGR02 正封存 raw。该轮不构成产品失败或 M1 送审结果。

QA02 的第二次尝试封存清单 `C:/Users/Administrator/Documents/Codex/2026-09-23/aivora-git-c-users-administrator-documents/work/native-source-qa-20260924/evidence/attempt02-execution-20260924T044400Z-mgr02b/attempt02-review.json` 已由制作经理回读，SHA256 `C487BA05CFE68DB64ED23D1BA731C51278E685141ABA1111269EA66E7ED97D6F`，列 22 份原始/签名文件；分类 `STOP_BEFORE_ELECTRON_IDLE_GATE`。新追加账本 SHA `7DE19A96766F29CCA2360BEEC2071A66CF10C4C6332E8E5D5DF9750F81489940` 和空 profile 保留。**第二轮权威 GET 次数为 0**，因此不可把 review/submission 的 `null` 写作第二轮服务端读回证明；无项目/来源/native 发送是由 runner 停止点、`cases=[]` 和未触发 Electron 的执行轨迹证明。`normal_close=N/A`，内层 postcheck FAIL 因从未启动应用而缺正常关闭标记，不是产品关闭失败。后查 c19 进程/锁 0，旧账本、HEAD/33 路径及 27+6+73 未漂移。后续 attempt03 仍须新的追加式账本、精确签核和桌面空闲条件。

QA02 已交 attempt03 **离线静态包**，制作经理回读 `C:/Users/Administrator/Documents/Codex/2026-09-23/aivora-git-c-users-administrator-documents/work/native-source-qa-20260924/evidence/attempt03-static-20260924/static-review.json` SHA256 `C136C071BDCE216F1AC0796E027972A04E77849E3FAF84DE841B3BE6C2CADCEC`、runner SHA `C1A5DDD34729D56FB8F4C350BD6CB7789BEDF3B3999F8702F6581AB1DD8CF345`。状态 `READY_FOR_MGR02_REVIEW_ONLY`；无 attempt03 审批、预检、UI、账本或 profile。前置门核 attempt01 原 native 未发送及 12 次 GET、attempt02 追加账本及 22 件封存证据/无 Electron 来源动作；离线门禁反例和执行顺序检查均 PASS，候选 27 产品+6 QA+73 dist。新流程在创建账本/profile **之前**先做 60 秒 idle/同会话桌面/无相关进程的只读检查，失败只留原始 evidence；成功后再建追加账本与 profile，并在 Electron 启动前、建项/导入/送审等来源动作前复查，原生 dialog 发送瞬间的严格前台门保持。此包需要 MGR02 精确审签、只读预检和协调桌面空闲窗口，尚无真实 attempt03 或 M1 结果。

MGR02 已独立审 attempt03 静态包并新签 `attempt03-approval-20260924T045930Z-mgr02a.json`，制作经理回读审批 SHA256 `0F3AA71B66D07FCF307CF3B28B6D6F868B83E7D67FB1E1B3242DC74FA5249A15`。仅执行只读预检：`C:/Users/Administrator/Documents/Codex/2026-09-23/aivora-git-c-users-administrator-documents/work/native-source-qa-20260924/evidence/attempt03-preflight-20260924T045930Z-mgr02a/receipt.json` SHA256 `11FCAB1AFF2C8AD3D55B043AD3B691815A245F2C2BF1EB5D1A1899335F246F13`，exit0/`PREFLIGHT_OK`，27 产品+6 QA+73 dist、两本旧账本、首轮 12 次读回和第二轮空闲门停止证据均核；未建 attempt03 evidence/账本/profile，未启动 Electron。**MGR02 尚未放行实际 UI 运行**，等待 MGR01 协调用户桌面安静窗口；不能把签名及预检视作来源提交。M2 完整执行仍依赖 M1 的 accepted+selected 正式 handoff 和同 profile/workspace，当前无 MP4。长文应在短剧 M2 后以独立小说项目核，避免改变短剧 latest 来源状态。

MGR01/MGR02 对 M2 离线执行草案继续审查，发现四项会改变实际验收判断的缺口：Fake 任务输出版本没有正确传入、来源全文缺独立比对、Timeline 依赖缺核对、实际播放等待可能无界。QA01 仅离线修草案并补对应负例，保留原稿/失败证据；没有 M1 accepted+selected 正式 handoff 或可播放 MP4，M2 原生执行仍未放行。这些是当前草案门禁问题，不表示产品媒体链路已失败或通过。

M2 Timeline 来源依赖的核验边界已明确：MGR02/QA01 查产品合同发现 Timeline GET 没有对外提供该依赖字段；制作经理回读 c19 `services/api/src/aijian_api/contracts.py` 的 `TimelineData`（project/version/content hash、duration、timeline）与 `timeline.py` 的 `TimelineVersionV1`（asset/clip/media_package），没有可直接作为 accepted+selected 来源依赖证明的字段。后续真实 M2 证据须分别保留 Electron UI/服务 GET 行为，并在**正常关闭后**对同一 `userData/workspace` 数据库做只读依赖核验；该核验完成前不能签 M2 来源绑定或实际影片通过。QA01 仅离线修草案，当前无 M2 运行/MP4。

QA01 已将上述四项 M2 草案缺口做成离线修复包，MGR02 独立核验了最终 `review-diff-summary.json` SHA256 `2A9470B415FDA12EA923CAFC3CFF19964A20E2F24B552AFE5FFF57DAED8ABFFA`，原稿与新稿哈希分列保留。新 runner/flow/driver/provenance/media-events 分别为 `0FEB7362DCEDA8800A05C3137883B20C1ADA3E286963B0DF1428691658FBEB2B`、`D9C03C50029C30F706E0F54D837DDD82C8CFF138BE0EC00FD84E5CCCBAEFB2C3`、`F4500CD370F2E56A95C4DDABCD15C66EADBA648DE2F292D4CBB5F1CA3CF976DE`、`C6908C54720893F3BD4D7B2B9DC8781E39279EFD354B4E96699533DFF6A92203`、`6C5152F8E6834981CB99CE4BED31C1776006B88591B1DB4F5DBD04FC41441334`。七文件 `node --check`、七路径离线模拟、BOM/换行/NFC/正文篡改、缺输出版本、错来源依赖/编辑 parent、SQLite 只读字节不变、播放事件缺失有界停止及 helper 漂移负例均由 MGR02 重跑通过。制作经理另回读最终摘要与两 helper、模拟/负例原始输出哈希。该结论只覆盖**离线编排与停止门**；M1 正式 accepted+selected 同 profile/workspace 交接不存在，M2 原生/Fake/FFmpeg/实际播放未执行，状态仍 `M2_BLOCKED`，不得据此派 ART04 审片。

用户经总控明确给予约三分钟桌面安静窗口后，QA02 按 MGR02 已签一次性审批执行 attempt03 **一次**，没有重跑。制作经理回读 `C:/Users/Administrator/Documents/Codex/2026-09-23/aivora-git-c-users-administrator-documents/work/native-source-qa-20260924/evidence/qa02-submit-attempt03-20260924T045930Z-mgr02a/result.json` SHA256 `00AC66D5D3EED28D0DA066C2F4E079EB6B6177142AD405257AD6F03050C11C9D`，以及 29 件封存清单 `evidence/attempt03-execution-20260924T045930Z-mgr02a/attempt03-review.json` SHA256 `3BB120FD3F17D5D9B3A7C59DCD9A6C606A97F03F91181837C25A0BF7D5B85201`。首门 idle 65500ms、同 Default/session1，通过后创建**新追加 ledger/profile**；第二门 idle 67953ms、采样 age 592ms，通过并实际启动 Electron PID19264/HWND461324。产品主窗自然显示且 Electron 报 `focused=true`，但 `before-source` 即时 Win32 前台为 Progman HWND65820/PID7744，严格前台门在任何建项/导入/来源动作前停止：`cases=[]`、无本轮权威 GET、无 native sender/send。应用正常关闭，postcheck PASS，相关进程/锁 0，旧账本、27+6+73 和 Git 状态未漂移。分类 `STOP_BEFORE_SOURCE_FOREGROUND_GATE`；它不是产品来源审核结果。第三次审批已消耗，MGR02/QA02 仅离线归因和审下一方案，不能在该窗口自动重跑。M1 accepted+selected、M2 原生/MP4 和 ART04 审片仍未取得。

## 2026-09-24 目标状态（历史查询）

| 岗位 | 当前 objective/status | 后续触发 |
| --- | --- | --- |
| MGR03 | 首个冻结输入核对包 complete；当前 `制作组 M1/M2 阶段监督：完成冻结输入身份、全文与内部测试授权边界确认，并在固定 H87 候选和独立运行条件就绪后组织 ART01 真实来源 UI 使用核对；M2 可播放开发 MP4 就绪后组织 ART04 实际审片、反馈与返修确认。与独立 QA、版本组交接证据；不把 Fake 当真实影片，不启动未授权真实供应商。` / active | 等固定 H87 候选与独立运行条件，随后派 ART01 真正 UI 使用包；等可播放 MP4 与 QA02 证据，派 ART04 审片包 |
| ART01 | 冻结输入核对包 complete；后续“在固定 H87 Electron 候选的新独立 profile 中，以普通用户顺序核对冻结短剧全文与两万字小说的保存、送审、确认基线、批准、选来源、正常关闭重开与全文/身份读回，提交制作使用证据”已调用 update_goal 返回 complete。完成的是实际使用核对与失败证据交付，**M1 来源闭环仍未通过** | 当前无新制作实施包；等待 QA 归因及后续具名修复候选 |
| ART02 | goal=null；前次接管目标 complete | 真实可评审资产和明确文件范围就绪后另派 |
| ART03 | goal=null；前次接管目标 complete | 真实动作视频及锁定普通话音频就绪后另派 |
| ART04 | goal=null；前次接管目标 complete | 可播放 MP4 及 QA02 规格/播放证据就绪后另派 |

## 2026-09-28 恢复核对与制作交接

- 用户已明确全岗位继续；本节沿用完整产品基线 `AIVORA-完整产品需求与验收基线.md`，不替代旧证据。只读核开发候选 HEAD `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`、81 项现有状态，独立 c19 同 HEAD、87 项现有状态；主目录 HEAD `7523f010561b91c5457aca4b38919801605c42d7`、原 13 项现有状态。三份冻结输入 SHA256 未漂移：短剧 `466F23B789B47FA1231B0891E80385A13E530B02DE2F74481C4E98F5732DE008`，长文 `29A4AA9E35D684C71BDFD67CD7265FB96C0682EA861B2F2008707CCD2646D697`，K01 清单 `E4FF73680F0FEEBFB31FB3A5B5C1311AD73B0935AEA29B5419E1F7CAA2DD7711`。当前三处指定范围未检出 MP4；此搜索不覆盖其他未列目录。
- ART02 核出样片归属冲突：现有 `production/art` 角色卡及服装道具场景表是《雨停之前》林澄/周野的工程验证样例；《离别》冻结剧本则是沈砚/林渺六镜、750 帧，不得把前者的红伞/蓝便签或内置图登记为后者资产。当前《离别》仅有文字约束，缺实际获批准的角色造型、服装、卡片、小圆表、纸灯、门窗/场景媒体版本、权利与镜头引用，也未见具名第二集创作输入。已交 MGR01 由其确定 DEV04/06 资产接口唯一 owner，并交 MGR02 将显式测试资产的 AC03 持久化/跨集/跨作品隔离验证与《离别》正式资产审查分开；不阻断本地测试资产实现，也不把测试通过当正式创作验收。
- ART04 把完整基线 P14/P18/P19 交 MGR01 映射 DEV06/08：锁定获授权对白音频与对齐，多轨视频/对白/BGM/SFX/字幕的实际编辑与重开一致性，正式导出前媒体/声音/字幕/权利预检，以及同源可播放 MP4 的规格、时间码审片和技术/创作双签。候选 `UtilityPages.tsx:314-318` 配音试听/生成禁用，`MediaPages.tsx:1170-1213` 正式导出未接入；`development_timeline_export.py` 仅开发导出，Phase0 单视频轨不覆盖正式多轨。当前不能派 ART04 对不存在的 MP4 作实际审片。
- ART01 完成 `production/director/冻结输入版本来源镜头映射-20260928.md`，制作经理回读 SHA256 `5FE69607BD117E9F5714F60AF8DEB6020BA67CDEC5ED0AE27A3AF842FBD1A811`。六镜按原文映射；短剧与长文虽同题同角色，仍无六镜到小说的逐镜 SourceSpan、改编批准或正式选源版本，不可凭同名自动建立来源血缘。当前无正式第一/第二集划分或第二集剧本/镜头，《离别》30 秒片段不自动作为第一集，《雨停之前》不能充第二集。相关 P05/P07/AC03 的产品读回与显式测试资产边界已交 MGR01/MGR02。
- ART03 完成 `work/art03-f04-ac06-20260928/ART03-真实动作与中文口型验收证据映射.md`，制作经理回读 SHA256 `CE6AFAC8AAB0CF08CFBA2CDBD4E558F17A43DCC357FA0F942ACCBAD556D4B3E6`。SH-03 林渺“不知道。”是画外音，不计她可见口型；现行 F04 系统性音画偏移目标 ≤1 帧，逐句自然度另人工审。30 秒《离别》样片不能覆盖侧脸、遮挡、快语速及双人同时对白的全部 F04 类别，须另有获授权真实媒体样本或保持未验证。真实 motion/voice/lip-sync 模型、授权、回执、锁定波形、媒体哈希和 MotionProof 仍缺，已交 MGR01/MGR02 作为 DEV05/06 与 QA 的具名门。两份映射只引用既有剧本/完整基线，不新增产品需求或媒体完成声明。M1 仍无正式 accepted+selected 同 profile 交接；QA02 attempt03 前台门阻断及一次性审批消耗见上文；M2 真实执行与 ART04 实际审片继续依赖实证。

### 制作依赖短决策清单（文件/接口 owner 已由 MGR01 确认）

1. **本地实现可继续**：用明确标注的测试作品/资产实现并验证 P05/P07 版本关系、AC03 双集资产入库/跨集引用/跨作品隔离、剧本到可变镜头/说话人/画外音的持久字段，以及声音、真实动作、口型、多轨和正式导出的本地接口与非外呼测试；缺《离别》正式素材不使这些代码任务停工，测试结论只覆盖测试资产。
2. **《离别》正式创作验收须等真实输入**：剧本与长文的 SourceSpan/改编批准和已选来源、沈砚/林渺实际获批准的角色/服装/道具/场景 AssetVersion 及权利/媒体哈希、具名第二集剧本/镜头和共享指派、锁定普通话声轨、真实动作与中文口型证据。缺一项就保留对应来源、双集或影片验收未通过；不得用《雨停之前》样例或 Fake 补证。
3. **完整 F04 另立媒体实测门**：30 秒《离别》只能验证其自身六镜，侧脸、遮挡、快语速、双人同时对白还需分别取得获授权真实样本；真实服务的费用/上传/发行许可独立核准。上述条件不授权调用外部服务、生成收费素材或上传私人正文。

MGR01 已确认 DEV02 独占 `episode_script_*`，DEV06 独占 `media_asset_*` 及后续 `episode_assembly_*` 数据，DEV04 独占 SceneAndAssets/播放轨道 UI，DEV05 独占 provider 能力/真实任务，DEV08 独占正式导出计划与编码。ART01–04 已各将一个主包交相应 DEV，制作组只给输入和验收，不并写产品。当前开发候选可给本地内部 QA 的实际样本有 `apps/studio-web/src/aivora/assets/character.jpg`（SHA256 `CB627845058D88D948308F7ABBCEC839CCCC358E73E3A0266A854AA3AD86E204`）、同目录 `street.jpg`（SHA256 `377975CFF45215D6EDC0ACD1515683D1672413A128E9FA962378521CDDB38BF7`）；ART02 已核两份与 manifest 相符，均为 demo only 的设计参考裁图。另有 `services/api/tests/fixtures/media/vfr-pattern-25fps-proxy.webm`（SHA256 `0801C350D098061A9694017F4ADCC3CBE8A37C24DCE67C864644F928F286B67A`，64 帧、25/1、160×90、48kHz Opus，合成测试媒体）。这些素材仅能以显式 TEST 身份验证入库/解码/时间基；无独立对白、BGM、SFX、字幕文件/时间码/权利，也无正式《离别》媒体。DEV02 已确认现有 SCRIPT01 可保存/重开 project+episode、可变场次和 ACTION/DIALOGUE、speaker、版本/hash/CAS，拟补画内/画外 `delivery`；此为开发接收及计划，未当作新代码通过。DEV06/08 正推进 assembly/正式导出机制，结果以其实际文件和测试为准。

权利补证：上述两张 JPG 的 manifest 仅自述 `user-authorized design-reference crop; demo only`，ART02 未找到独立权利凭证，因此它们目前只是**待权利核验的隔离本地 QA 候选**，不能自动标为已批准资产或用于发行/《离别》正式片。代理 WebM 的测试 manifest 记录本地 FFmpeg `testsrc2+sine` 生成参数及源/代理哈希，可用于内部解码和时间基机制验证，同样不具正式作品人物、对白或发行授权。DEV06/04 已收到该区别。

语义资产 owner 决定：MGR01 确认现 `media_asset_*` 只管媒体字节版本、`episode_media_assembly` 只管集级可播放引用；角色/服装/道具/场景的共享语义身份、跨集状态及改版影响须由 DEV06 后续独立 `art_asset_identity_*` 数据合同/存储承接，DEV04 为对应 UI owner，DEV01 只提供迁移/CAS 短支持。此包排在 DEV06 当前 assembly、选定媒体 probe 与首个可播放工程后，不并行抢第二主包；ART02 已向 DEV06/04 交字段供后续校对。当前 C 首包不覆盖 P08–P11/AC03 的正式共享资产能力，不能据多轨草稿签收。

ART03 候选服务资料已由制作经理在 2026-09-28 对照阿里云官方文档复核，并把规格缺口直接交 DEV05/06：`wan2.7-t2v-2026-06-12` 可输出 9:16 1080×1920、2–15 秒片段，但固定 30 fps MP4；`wan2.2-s2v` 单图加公网音频驱动最高 720P，音频 <20 秒且 <15 MB，北京地域接口。CosyVoice v3-flash 存在 TTS 接口和普通话音色目录。这些只是候选能力，不是本地账户权限、真实调用、获授权声音或 F04 质量实测。冻结《离别》为 25 fps/1080×1920；30 fps 原件进 25 fps 装配必须有受控转制、源 PTS 映射、转制工具/哈希和前后音画偏差实测，720P 口型片还存在正式清晰度缺口，不能因文档能力签 ≤1 帧或正式媒体通过。官方依据：https://help.aliyun.com/zh/model-studio/text-to-video-api-reference ，https://help.aliyun.com/zh/model-studio/video-generate-edit-model ，https://help.aliyun.com/zh/model-studio/wan-s2v-api ，https://help.aliyun.com/en/model-studio/cosyvoice-tts-http-api 。

总控转达用户授权本地 MLT 适配验证后，ART04 制定唯一合成 TEST 工程规格 `C:/Users/Administrator/Documents/Codex/2026-09-23/aivora-git-c-users-administrator-documents/work/art04-mlt-test-20260928/MLT-唯一合成TEST工程规格.md`，制作经理回读当前 SHA256 `4323DFEF3EEF9337BAF49A5118DE1397B4C2AFBE2E67768E133F87C950DDF16D` 并同版交 DEV06、DEV07、DEV08、MGR02、QA02、REL02、MGR04；ART03 补声画门。此前 AF56D/D687F/7D1E 是历史修订，当前版另针对 DEV06 具名评审固定 320×568→1080×1920 为本合成 TEST 的 `STRETCH_TO_CANVAS`，无裁切/留边、白识别条完整可见，约 0.16% 纵横比变形只在本 TEST 允许，正式作品另定。工程目标为 25 fps/48 kHz/125 帧/1080×1920：蓝 V1 `[0,75)`、红 V2 `[50,125)`，仅 `[50,75)` 叠化；1000 Hz 非语音提示音 `[25,50)` 与 `[75,100)`，220 Hz BGM `[0,125)`，两条 TEST 字幕同提示音。DIALOGUE_TEST 两段与 BGM_TEST 都固定 `gain_millidb=0`，不自动归一化、限幅或鸭式压低；QA 留实测混合峰值/削顶。五件合成输入、工程和 MP4 尚未产生，路径/哈希及 TEST 脚本/字幕版本待 QA 隔离生成后锁定；现有代理只可前置 probe。C 现有视觉合同拒重叠，D 当前正式预检仍阻断，故此文档是适配目标而非可运行/通过证明。QA 独立验证实际导出逐帧、混音 PCM、字幕显隐、保存重开与播放；ART04 只在固定可播放产物就绪后审片。当前 PATH 未找到 `melt`，新工具须技术 owner 提准确版本、二进制来源/哈希并经既有审查，不由制作组安装。本轮不替换正式引擎、不迁移真实用户工程、不验证动画/口型生成。

MGR02 对上述规格提出独立语音缺口：1000 Hz `DIALOGUE_TEST` 明确是非人声，只能验证提示音/BGM 双轨与时间同步，不能证明对白可懂度、语音与字幕语义同步。现记 `DIALOGUE_SPEECH_NOT_TESTED`；ART04 已在同一规格写明以后只有取得许可清楚的本地 TEST 短语音，先封来源、权利、准确短语、生成或录制方法、48 kHz PCM、时长、哈希和脚本块，再重新固定对白/字幕帧段并由 QA 试听，才能解除此门。当前无该语音，不得把技术混音 PASS 扩称对白验收。

QA02 已在外置隔离目录生成本规格的四件合成 TEST 媒体，制作经理独立回读 `C:/Users/Administrator/Documents/Codex/2026-09-23/aivora-git-c-users-administrator-documents/work/qa02-mlt-test-20260928/four-media-20260928T022740Z/four-media-manifest.json` SHA256 `211DDD8872F1DE47A569849C7A6AE9763D125DF6BAE9F8416534976C5B83FF78`；清单绑定冻结规格 `4323DFEF...` 与工具锁 `A4554A71...`，含 FFmpeg/ffprobe 8.1.2 精确二进制路径/哈希及生成、探针、解码的原始命令和退出码。四文件实字节/哈希与清单一致：蓝 WebM `75FCA3022F0D4369175E5341505544D8AED1837C1DCE0899F35BF1D7EDB73947`、红 WebM `507DB639D74CAEBEAB3DFB9DDAD4EEA328A732D59794BEC7B49C66F51AB78AC4`，均 VP9、320×568、25 fps、75 帧、无音轨；1000 Hz WAV `E2C5F4AC222A67C22FC548275BB422A45FAEEAAB0A5EBAAED29CB0F1AFA37641` 为 48 kHz PCM/48000 样本；220 Hz WAV `590CC4A39EC6DE15C24C3EDEBB8F5754F3088BAD398932C7C194960453BBD7C4` 为 48 kHz PCM/240000 样本。各解码回执退出 0。QA02 保留两次只到工具版本步骤的脚本失败目录，未覆盖。当前只完成四媒体输入；SRT、独立 TEST 脚本版本/两个块 ID/哈希、媒体选定版本/权利/probe 正式记录、MLT 工程及 MP4 均未形成，仍不可判适配或观感通过；ART04 待固定可播放产物才审片。

DEV02 对独立 TEST 脚本确认现有 `episode_script_*` API 足够，不增加 A 表/代码。QA 须在隔离 profile 经正常 sidecar 受控创建独立项目/分集，项目合同最短 30 秒故项目 target=30，分集 target=`5`；在新剧本版本中现场生成一场的 `scn_` ID 和两枚 `sblk_` ID，两个 `DIALOGUE`/`OFF_SCREEN` 块文字分别为 `TEST 提示音一（非语音）`、`TEST 提示音二（非语音）`，speaker 明标 `TEST 提示音（非人声）`。新稿 POST 带唯一 Idempotency-Key，QA 按 201 回执及确切 version GET 读回 project/episode/version/content hash/block ID/全文后，才能写 1–2s、3–4s 两条 SRT 并锁实际文件 SHA。项目和分集 POST 无幂等键，响应丢失须先 GET/list 核对，不盲重试；不伪造 accepted source/人物/语音。该流程已交 MGR02/QA02/DEV06，目前尚无实际 TEST 脚本 ID 或 SRT。

DEV06 另澄清冻结 mapper 的实际校验范围：`delivery` 必须非空并原值进 plan，但 mapper 未强制 `OFF_SCREEN`，也未强制 speaker 恰为 `TEST 提示音（非人声）`。这两个字面值属于本次 QA 夹具输入与读回检查，不可误报为程序硬校验；无需据此改冻结 C 合同。MGR02/QA02 已收到此区别。

随后 QA02 报当前 c19 固定运行包缺 `delivery`。制作经理静态并列核对：开发候选 `s2-q1.../sp/services/api/src/aijian_api/episode_script_contracts.py` 已有 `delivery: ON_SCREEN|OFF_SCREEN`，store 要求新 DIALOGUE 显式填写；但 `C:/Users/Administrator/.codex/worktrees/c19-trim-211c9e8-qa-20260923/services/api/src/aijian_api/episode_script_contracts.py` 的封闭 `EpisodeScriptBlockV1` 仅有 block_id/ordinal/kind/text/speaker，且 `extra=forbid`。所以 DEV02 上述方案只说明**候选实现的接口足够**，不能现在向 c19 带 `OFF_SCREEN` POST；QA 实际 TEST 脚本/SRT 保持 `BLOCKED_A_DELIVERY_NOT_IN_C19`，等待 A 线安全整合成完整运行包、QA 独立审后再执行，不删除 delivery 字段降格。已把此结论交 MGR01/DEV02/MGR02/MGR04，未向 c19 创建项目或修改其输入。

**后续勘误（总控收窄前置）**：上一段“等待 A 线完整运行包”是当时保守说法，现改为等待 DEV02 的**最小正式向后兼容包**受控整合与独立 QA；不强制等待 A42+B31 全量完成，也不执行仅适用新空库的 `QA_ONLY_NEW_EMPTY_DB` 研究补丁。制作经理回读 `C:/Users/Administrator/Documents/Codex/2026-09-23/aivora-git-c-users-administrator-documents/work/dev02-script-compat-20260928/README.md` SHA256 `C8990C3160076C5508A03D959EB87F312F205B0D06E8C4BAB28BB0F82A14632C`：候选要求旧 ACTION/DIALOGUE 的 exact/latest 原内容、原 hash/IDs、旧 operation 幂等回放不变，旧稿缺 delivery 保持 `UNKNOWN/None` 而非默认 `OFF_SCREEN`；新 DIALOGUE 才须显式 delivery，旧未知不能通过制作 mapper。该包当前仍是静态候选，c19 未改未测，TEST 脚本/SRT 仍阻断，四媒体清单 `211DDD...` 保持有效部分输入。另核版本组 D/MLT 四源当前固定 `C:/Users/Administrator/Documents/AIVORA/management/manager-handoffs/release-snapshots/20260928-d-mlt-plan-adapter-worker-4-2/SNAPSHOT.json` SHA256 `5CB4BFD691A4E24C0D5E3E672EBC10D7011BAE90A2385DCF3ABAB98FFE715719`，4-1 为历史。已向 ART04 通知此勘误；冻结 TEST 规格本身不变。

QA03 前端/播放器外置矩阵现为 `C:/Users/Administrator/Documents/Codex/2026-09-23/aivora-git-c-users-administrator-documents/work/qa03-mlt-front-20260928/MLT-接口与播放器QA矩阵.md` SHA256 `88197CC919EDED324DEC9F80FB6EBC2A728DE3A684192345F25DC6810E33E047`，旧 A5CF/8E1F 留历史。矩阵分别列 SDL2 原生实时预览、预渲 MP4 页面/系统播放器、导出与重开检查；已更正四媒体 `211DDD...` 实际就绪、SRT 等缺件继续阻断。QA01 曾基于 QA-only 旧合同提出“缺 delivery 专用错误被上游校验拦截”风险；MGR02/DEV06/MGR04 对正式兼容合同 `0028DB...` 静态复核后，确认缺 delivery 可表示 `None`，mapper `6E7DFC...` 的 `TEST_SCRIPT_DELIVERY_UNKNOWN` 分支静态可达，不需因此改 DEV06 代码。但旧稿实际运行拒绝仍无独立 QA，保持 UNKNOWN。已把当前矩阵 SHA 交 MGR02/MGR04。

QA02 后续按一次批准在外置隔离目录冻结五输入，制作经理只读回算 `C:/Users/Administrator/Documents/Codex/2026-09-23/aivora-git-c-users-administrator-documents/work/qa02-mlt-test-20260928/five-inputs-20260928T035901Z/five-input-manifest.json` SHA256 `EE2166D379C1000D65138C12023209A9D535AEE17D707C04BB907B7823FB04E3`，五子文件实字节/哈希 5/5 相符；新增 `subtitle-test.srt` 为 130 字节、SHA256 `3561D5DF3229D71CE53F427C65A850DCF8C23BDFE0D7D9F03C8BC7D50DC81CDC`，两条非语音 TEST 字幕准确落 1–2s 与 3–4s。清单含实际 project/episode/script version/content hash/两 block ID，引用 QA01 reopen `IDENTITY-READBACK.json` SHA `67E4DAD955BC59EC573ADE5CD2373678738797CEC22022DFC4B0CC7798B4D32E` 与 exact GET raw SHA `C819E6473BDFA051C85341C633529F738C2E94A09BD484EE43EF3E1913879E0F`；制作经理回算这三份文件哈希，读到两个文本、speaker、`OFF_SCREEN`、scope 与清单一致。QA01 原创建 runner 的 exit 1 和 `Immediate exact-version read differs` 失败仍保留；制作经理只读对比 create 回包 `data.version` 与即时 exact GET `data` 的结构化值相等，runner 源码使用顺序敏感的 `JSON.stringify` 比较，疑属测试比较方法错误，已交 QA01/MGR02 独立归因，不能抹原失败或宣布整体脚本 QA PASS。此五输入状态仍仅 `FIVE_INPUTS_FROZEN_NO_MLT`：媒体 AssetVersion 选定、权利决定、受控 probe、MLT 工具/工程、实际预览/MP4 均未通过；ART04 未审片。

**技术 TEST 依赖勘误**：先前“C 正式 assembly 必须先支持重叠才可执行此 TEST”的说法已由总控/ART04 修正。制作经理回读 D/MLT 4-2 固定 `episode_media_execution_plan.py` SHA256 `6E7DFC0DAF5534947269C0824658E381293D0D4742145F2DBD7DB5E686C756F1`：其 `ENGINEERING_TEST` / `FROZEN_ENGINEERING_TEST` plan 直接包含双视频轨和 `[50,75)` 的 `CROSS_DISSOLVE`，因此本轮合成技术 TEST 不以正式 C assembly 重叠表示为前置门。正式多轨编辑、持久化、重开和 P14 验收仍另门，不能由此 TEST 代签。五输入 `EE2166...` 与 ART04 规格 `4323DF...` 不变；媒体 AssetVersion/rights/probe/inspection、完整适配、获审 MLT runtime 和独立 QA 执行仍未闭合。

MGR04/MGR02 后续核定本 TEST plan 的 assembly 身份必须为空；现有 assembly 模块只作为 Python import 依赖按固定 SHA 验闭包，不把正式 C assembly 数据或重叠持久化偷带进 TEST。MGR02 将 QA01 初次 runner 的 `Immediate exact-version read differs` 归因为键顺序比较误报，原 exit 1/失败证据继续保留；独立 GET-only 新 sidecar 四次 GET 200 与正常关闭核同一合成 TEST 身份，因此 TEST 脚本身份读回门已闭合。旧历史 ACTION/DIALOGUE 跨进程 API 兼容门单列继续，不由本次新 TEST 身份读回代替。MGR04 发布记录增量 SHA256 `A62C32AF1ED7A5D4091469E56530F962EDEA96F0805412806EDE8BD65713B007`；当前剩余前置是媒体 AssetVersion/rights、视频 probe/音频 inspection、D adapter/worker 依赖及获批 MLT 环境。尚未运行 MLT。

QA03 已按上述两项更新自己的外置播放器矩阵，同一路径当前 SHA256 `E366AD19C5A4A60D9014B923AA2342710DFE5AD197EB8B0290CC11DF9F260A85`（旧 `88197...` 留 `.v3.md`）：正确写 D 专用 ENGINEERING_TEST 双轨叠化不等正式 C 前置，五输入清单 `EE2166...` 为当前 TEST 输入、四媒体 `211DDD...` 仅生成历史；规格 `4323DF...` 不变。制作经理回读第 3/9/13 行并将新 SHA 交 MGR02/MGR04。矩阵仍是静态准备，没有 MLT、Electron 或 MP4 运行证据。

DEV06 已消费 ART02/制作来源事实，QA 登记合同 `C:/Users/Administrator/Documents/Codex/2026-09-23/aivora-git-c-users-administrator-documents/work/dev06-mlt-selected-bindings-20260928/QA-REGISTRATION-CONTRACT.md` 制作经理回读 SHA256 `E3EBC867D439846548BE557F740574BF73585FFCD2106EA9DD23C59C894F52B8`。四媒体的 lavfi `color+drawbox` 与 `aevalsrc` 命令、工具锁、输出字节和 SRT/脚本链是**来源证据**；未包含具名权利批准。受控 TEST selector 要 QA 实际导入四个 `asset_/asv_`，有权人工逐版本做带 basis/reference 的 `CLEARED` 决定，视频两份留持久 probe；WAV 格式/样本 inspection 从受管 PCM 字节导出，无须另造音频检查表或 POST。`prepare_test_selection` 再核五输入、脚本、资产、权利链与探针，并在 worker launch 前重验；未有真实人工决定时保持 `RIGHTS_NOT_CLEARED`，制作组不代填。正式《离别》的获批角色造型、真实动作/普通话声轨、逐类口型样本和 30 秒可播放片仍无证据，AC06/08 未测。

## 2026-09-28 用户暂停点（明天等明确继续）

总控转达用户“剩下的明天做”：即刻停止新测试、构建、下载、同步、外呼和派工；不自动续跑。制作经理本线程没有运行中的构建、测试、MLT、Electron 或 provider 进程，也未创建需关闭的进程。仅传达暂停及保存本记录，不启动下一门。其他岗位运行中/安全收尾状态以各自回执为准，制作经理不推断为全部结束。

本组固定输入仍为 ART04 唯一合成 TEST 规格 SHA256 4323DFEF3EEF9337BAF49A5118DE1397B4C2AFBE2E67768E133F87C950DDF16D、四媒体 manifest SHA256 211DDD8872F1DE47A569849C7A6AE9763D125DF6BAE9F8416534976C5B83FF78、五输入 manifest SHA256 EE2166D379C1000D65138C12023209A9D535AEE17D707C04BB907B7823FB04E3。QA02 四媒体来源回执显示 FFmpeg lavfi 颜色/白条和 1000/220 Hz 正弦音，无外部媒体输入；来源证据不等于权利决定。MGR02 冻结批准 SHA256 2050354893B99E3B5464858DA4FB1CD107B421A2F664678FA375C024BF1105E4 限离线 SYNTHETIC_TEST_ONLY 一次且 noMlt，明确不接受权利/选定版本，不批准 MLT/provider。

DEV06 QA 登记合同已更新为 SHA256 2BA4276469587AD71A70B324CF6E527BEAE0C55F461F4EAE37673C56FE21973F，取代上文 E3EBC867... 的旧引用；该合同仍为静态交接，无实际导入、具名授权人工每版本权利决定、视频 probe 或 MLT 运行。四媒体 manifest/回执仅能定位 QA02 隔离运行，不能核实自然人作者或权利主体；sidecar 通用 local-user 也不能当具名审阅人。正式《离别》所需获批角色/场景、真实运动、普通话声轨与口型、30 秒可播放片仍缺，F04/AC06/AC08 未验收。已有五输入与脚本 TEST 身份读回只证明各自范围；历史原始 runner exit 1 保留。

总控转达最新 R2-only EXE 构建 PASS：SHA256 2F23AC50CEA16D60D3C2AA1013F11F7C7D00570767740C2026A9C4243468E692，18568181 字节，receipt 1ED80F0B；制作经理未独立回算，且新 EXE 长 profile、短 TEMP、Busy73、正常关闭均无通过回执。R1 最小 overlay/作者 TS 门仍分线待验；c19 无新写授权。用户此前隔离构建许可在暂停期间不得据此继续。

恢复第一步（仅用户明确“继续”后）：各 owner 先报告安全收尾/运行中状态和源、产物 SHA；制作经理核对 DEV06 合同及 TEST manifest 是否漂移，再由 MGR02/QA 按独立授权处理真实资产登记、人工权利决定与 probe。MLT 工具和运行批准、正式媒体/配音/口型仍各走自己的门，不能以当前 TEST 或 R2 构建代签。
## 2026-09-29 本轮收尾与再次暂停

用户明确“完成本轮后就不要执行了，明天继续”。制作经理本轮仅只读复核冻结《离别》剧本 SHA256 466F23B789B47FA1231B0891E80385A13E530B02DE2F74481C4E98F5732DE008、ART03 逐镜映射 SHA256 CE6AFAC8AAB0CF08CFBA2CDBD4E558F17A43DCC357FA0F942ACCBAD556D4B3E6、现有制作文字与 TEST 素材，并把六镜真实画面/普通话/口型/连续性/时间线/MP4 的缺件交 MGR01、DEV08 和 MGR02；未新增媒体、作品、规格或产品源码。本轮实际交接已完成，无本线程运行中的生成、构建、测试、MLT、外呼或需安全结束的进程。

现有 production/art 与 production/post 属于不同作品《雨停之前》；产品 assets/manifest.json 的图片标 demo only；QA02 五输入 manifest SHA256 EE2166D379C1000D65138C12023209A9D535AEE17D707C04BB907B7823FB04E3 仅合成 TEST。未见《离别》获审角色/场景/道具媒体版本、六镜真实连续动态、锁定双人普通话声轨、逐句波形/口型证据或正式可播放 30 秒 MP4；正式 rights 人工决定、provider 许可与真实任务仍未取得。F04/AC06/AC08 及独立 QA/审片保持未验。此前 resolver 1D80A540... 是昨日已固定版本，DEV06 登记合同 2BA427... 所引 8FC... 是陈旧文档指针，已纠正给 DEV06/MGR02/总控，制作组不另启动源码故障调查。

ART02/ART03/ART04 已收到本轮暂停通知；各岗运行中与完成状态以本人一次性安全收尾回执为准，不能凭消息送达代称全部确认。未开始的正式制作、素材登记/权利决定、真实媒体生成、MLT/MP4 原生验收保持 NOT_RUN；不为收尾补跑。明天仅在用户明确继续后，先核三个岗位安全收尾回执和当前候选/素材哈希，再按对应 owner 的具体开发或 QA 缺口接续；无新素材及授权时保持缺输入，不重复写规格或派发生成。
暂停回执补记：ART02、ART03、ART04 均已分别确认暂停且本岗无运行中操作。ART02 完成两份冻结 manifest 只读来源/哈希核证，资产入库/测试/生成 NOT_RUN；ART03 完成现有证据映射及 DEV/QA 缺口交接，真实服务/媒体/MLT NOT_RUN；ART04 冻结 TEST 规格已交，实际 MP4 审片 NOT_RUN。三岗均承诺明天只在用户明确继续后按实际输入恢复，不自动续跑。