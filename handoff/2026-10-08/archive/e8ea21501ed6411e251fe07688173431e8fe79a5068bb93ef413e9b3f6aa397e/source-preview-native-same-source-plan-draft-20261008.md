# QA02 同源 Electron 来源预览红框验证计划（待审草案）

状态：`DRAFT_NOT_EXECUTABLE`。本文件只定义下一次验证的范围和关口；没有分配 runId、profile、evidence 路径或一次性批准，也没有启动 Electron。旧 v9 运行已释放，其批准、runId、profile、构建和结果均不得复用。

## 目标与范围

在**新冻结的同一候选**上，经 MGR02 审门后做一次自有 Electron UI 验证：真实来源从草稿提交后，来源预览显示审核中状态、刷新与基线确认两个按钮；分别检验 1424×720、1424×881、1024×881 的可读性、独立滚动、隐私内容不重叠、真实命中及 Tab 顺序，并在正常关闭后用同一新隔离 profile 重开读回。该轮只核对来源预览及提交后的状态；不执行“确认来源审核基线”，不作审核决定，不进入生产者调用、媒体生成或最终 UAT。

## 当前静态定位（非运行证据）

- 2026-10-08 回读的 DEV04 作者根为 `C:\Users\Administrator\.codex\worktrees\s2-q1-g1-d00-default-deny-59f-20260923\sp`，HEAD `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`，工作树有未提交文件。因此 HEAD 不能单独代表运行字节。
- `apps/studio-web/src/aivora/StoryPages.tsx` SHA-256 `C70CE0F6F8518C4EE042FFFE94762ACC2BF7CA365A400719B193778F46876B91`；`apps/studio-web/src/aivora/v2-story.css` 为 `D57ACFD69CE6190A85C0A4041798CF572889534D0FA228BDA01A5A12C83E2B6E`。DEV07 安全合并后，作者根 `apps/desktop/src/main.ts` 回读为 17466 字节、SHA-256 `51076243C1E39B544196D01EFDB76A1567138C255AAAC79D31131418ADD68D40`；下表保留合并前的 `A1359F9E...` 对照。
- 作者根当前缺少 `apps/studio-web/dist/index.html` 与 `apps/desktop/dist/main.js`。不能从这组源码直接声称存在可运行的同源 Electron 候选。
- 静态路径：草稿页“提交来源审核”打开真实提交确认抽屉；确认后先按项目/版本/哈希核对来源，再提交一次并刷新状态。真实审核态的来源预览显示状态、刷新、基线确认两个按钮；第三个故事导航按钮只属于 fixture。基线确认会写入审核结果，故本轮只观察其布局、焦点和命中，不点击。
- 2026-09-28 的 v6 原生 1424×720 为 RED；v9 在原生输入前停止，布局样本为 0。它们是历史对照，不是当前候选的通过证据。`main.py` 在有 sidecar 安全上下文时也注册媒体资源路由；其注册错误会阻断整个 sidecar 启动，但来源提交/预览并不调用媒体资源响应。

## 2026-10-08 同源准备差异

| 路径 | DEV04 作者根原始字节/SHA-256（`main.ts` 为合并前） | c19 QA checkout 当前字节/SHA-256 | 判定 |
| --- | --- | --- | --- |
| `StoryPages.tsx` | 64450 / `C70CE0F6F8518C4EE042FFFE94762ACC2BF7CA365A400719B193778F46876B91` | 60520 / `34D272A7ED104E2A983BAB774212C17F6CF7F9913198212B7052E7487B67DA60` | 不同源；c19 有两按钮外观，但草稿提交流程仍是旧路径。 |
| `v2-story.css` | 10770 / `D57ACFD69CE6190A85C0A4041798CF572889534D0FA228BDA01A5A12C83E2B6E` | 10770 / 同 SHA | 样式相同，不能替代页面与模型的同源性。 |
| `model.tsx` | 62466 / `38C629E5C2C34BC1466396239B6EEC38C26A85F609D421903A4DCCDB7E041F93` | 60568 / `0B2F661BFB9F156489667603F070DA04AE3F28633452201236D65249996CE211` | 审核行为输入不同。 |
| `apps/desktop/src/main.ts` | 15970 / `A1359F9EBC54090AD882C12B85E5CFB36917060D20D6B2DE245D9E364EA04C32` | 15836 / `BDAB4361B5D0671735253C8A57258FC48005165F07969DCD9D56C3BDC5636DAC` | 原生入口输入不同；新 IPC 与 c19 打包资源检查须合并后重验。 |
| Web `dist/index.html` | 缺失 | 906 / `AFE003E1635BAC787FC77FB32BCA0F34594D99D14DB8E63D0BF4A447F75C9D46` | 作者根未构建；c19 产物不能证明包含当前作者源码。 |
| desktop `dist/main.js` | 缺失 | 15694 / `4541E89FFC4944ED449FD85F1C01AA6CCF7AEA14C5D53C3593327CDBDA78FB03` | 同上。 |

两根 HEAD 均为 `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`，但上述文件未提交，HEAD 不足以绑定候选。c19 当前有 114 条 Git status 记录，不能视作冻结包。旧 v9 的 QA03 `after-route-fix.json` SHA `0AB5D6FB10FC49F62FF173AE9E9E7FAF891E0D3F229F203DD7EE9E49EA9D59A8` 所登记的 Web/desktop dist 分别为 `6D997E0C719E218B906ED733E39D7E3679272E034741D6033B6987EB1D2BDE62` 与 `09C1DE910BED84EE5902188116AF8EE0A02560BBC9CBC2799DD90E8F682A9F82`，也不等于 c19 当前 dist。本轮尚无可绑定的同源 dist provenance。

MGR04 已建立待构建的**唯一物理衍生源** `C:\Users\Administrator\Documents\Codex\2026-09-23\qa03-local-sub2api-native-source-v4-01\source`。QA02 回读该根的 `StoryPages.tsx` `C70CE0F6...`、`model.tsx` `38C629E5...`、CSS `D57ACFD6...` 与 `main.ts` `51076243...`，均与上述作者输入一致；Web `dist/index.html` 和 desktop `dist/main.js` 仍缺失。派生调用 `QA03-V4-NATIVE-MAIN-DERIVATIVE-01` 的 `run-01/result.json` SHA `E845FEE3340B04845E953704C0DC89014D260BF888EAE57C0C45D60DADE5A3E6`，状态 `PASS_STATIC_DERIVATIVE_COPY_ONLY`：14,466 个常规文件、771 个链接、仅一次 `main.ts` 替换；`target-inventory.json` SHA `790464130998D9E8661F1CBEDC10581E73D40A54D780C484E577596DEB16615C`，输入 `POST-G-BASE-MANIFEST.json` SHA `9EE57EF54924D2714D04F10956A2D3B0CC0C5A7E60076FA6DE423543BB6D76DB`。MGR04 报告已独立全树回读通过。该衍生源没有 `.git`，其身份须由基线清单、派生回执与文件清单绑定，不能伪填 HEAD/status；构建包正在准备，尚无构建/原生结论。

MGR04 指出的 desktop 源差异：v4 stage `main.ts` 的 `A1359F9E...` 有新 IPC 行为，但缺 c19 `BDAB4361...` 的 `packagedResourceRoot()`、打包 renderer index 检查及相应资源预检。DEV07 作为唯一写者已交出单文件合并候选 `51076243C1E39B544196D01EFDB76A1567138C255AAAC79D31131418ADD68D40`；QA02 在作者根独立回读到同一哈希，并静态见到新 IPC 注册与 `startSidecar` 前 renderer 预检。作者根 `work/dev07-main-resource-safety-20261008/` 中的补丁 SHA 为 `719D3FF2EC4D1C413CCF7B348D254A00D826DAC50A4D75693EC1C40D1103C517`，manifest 为 `A07747352166643DD29B7C8DFC341E978A34B15FD170FA7E97C7120135FFD114`，handoff 为 `508A4EFCD6CE861F6A954138196D22E3BC8C89B0A16FB81F15A6B137A95D1711`；QA02 已独立回读这些文件哈希，MGR01 报告反向补丁检查及源范围审核为 true。**这仅完成源合并交付**；下列独立拒绝用例、集成同步、typecheck/build 与原生 QA 均尚无本轮通过回执。旧 v4 stage 与 c19 SHA 均不能直接定为最终 desktop 输入。

合并后的独立拒绝用例须绑定**同一个新 `main.ts` SHA**并留原始结果，作为 desktop 构建前的源关口：

| 输入/动作 | 预期拒绝或保持条件 |
| --- | --- |
| 打包资源根、sidecar/config/媒体工具链锁、renderer 目录或 `index.html` 缺失或类型不符 | 启动预检拒绝，不使用不完整的打包资源。 |
| `process.resourcesPath` 为相对路径、UNC、含 `..` 越界段，或资源实体为 symlink | 拒绝不可信路径/实体；记录具体输入与错误，不以普通存在性检查冒充通过。 |
| renderer index 预检失败 | 在 `startSidecar` 之前停止；sidecar 启动调用计数为 0，无窗口被当作通过。 |
| 合并后的正常输入 | c19 的资源预检仍在，v4 新 IPC 注册通道/处理器清单完整；不能仅以能启动窗口证明 IPC 保留。 |

这些是计划中的独立源/隔离验证项，尚未执行。DEV07 交付与复核者须提供用例、命令、原始 stdout/stderr/退出码和合并后 SHA；QA02 只回读该回执与最终候选字节。不得为了这些用例启动可见 Electron，也不得把它们算作来源预览原生布局通过。

集成/构建所有者应以该**物理衍生源**的固定基线/派生清单与 `main.ts` 替换回执为输入，按其授权流程生成 Web/desktop dist。输出须含构建命令、环境/退出码、stdout/stderr、构建前后源文件及 dist 的完整路径、字节数/SHA、派生树清单对比和 sidecar 启动原始证据；若后续换源，须重新建立候选身份与审门。QA02 回读后若任何输入或输出漂移则退回构建关口；此处不代行构建或移植产物。

## 进入执行前的顺序关口

1. **同源候选与服务启动**：以 `qa03-local-sub2api-native-source-v4-01\source` 的固定基线清单、派生回执和目标文件清单为唯一当前候选身份；先取得 DEV07 对 `main.ts` 新 IPC 与 c19 打包资源/renderer index 预检的安全合并回执、新 SHA 和上述独立拒绝用例的原始结果；再由集成/构建所有者提供完整源码/生成物清单、每文件字节数及 SHA-256、Web 与 desktop 构建回执和启动入口。QA02 回读目标文件与清单一致，特别核对 `StoryPages.tsx`、`model.tsx`、`v2-story.css`、合并后的 `main.ts`、`apps/studio-web/dist/index.html`、`apps/desktop/dist/main.js`、source manifest/review API 路由及会随 sidecar 一起注册的 `media_asset_routes.py`。在授权的隔离预检中保留该候选的原始 sidecar 启动握手、stderr 和只读服务响应；来源创建/提交及其 API 回执只在获批的单次原生运行中采集。历史 QA01 媒体响应 GREEN 只能辅助说明旧候选的启动修复，新的媒体响应测试并非本布局轮次独立关口。任一必需文件、合并或拒绝用例回执、启动证据缺失/漂移即停止，不借用 c19 旧 dist。
2. **新计划包**：QA02 从该候选生成独立、一次性的 runId、隔离 profile/evidence 绝对路径与长合成来源文本及 SHA；固定 runner、wrapper、只读 OS helper、原生提交 helper 的字节哈希。修改旧 v9 runner 的三个按钮与“提交后跳故事”假设，按当前两个按钮和停留来源页的真实路径重写 locator/断言。语法检查和静态预检通过后封存计划、工具及候选清单。
3. **审门**：MGR02 审阅固定计划包、一次 G1 真实合成提交范围、至多两次 Electron launch、独占前台条件和无旧 profile 复用，给出绑定该计划 SHA 的一次性明确批准。前台不可稳定获得、批准不匹配或任一准备证据缺失时停止；不靠降低焦点门槛或换 runId 连试。
4. **单次原生执行**：用新隔离 profile 启动；记录 PID、窗口、路径、locator、截图及原始几何。仅一次合成来源 G1 提交，读回真实 review 状态。先采 1424×720，再采 1424×881、1024×881；保留每个断言前的原始截图与值。正常关闭自有进程，在相同 profile 重开，读回项目/版本/哈希/审核状态，再正常关闭并检查进程与锁释放。

## 新 runner 与一次性包的冻结条件

旧 v9 runner SHA `5EC21EB6B0F7A4A33660E271722B9BB788FCAA019202B622C33D5CA4E83E301F` 只作设计参照。新 runner 须绑定新候选 root/manifest，删除 v9 写死的 c19、旧 dist、旧 CSS 同步/媒体响应 GREEN 和旧批准哈希；保留文件逐项 SHA、profile/evidence 不存在检查、最多两次 launch、原始截图先于断言、失败不重试、正常关闭和同 profile 重开。其来源流程应使用草稿页“提交来源审核”→抽屉“提交真实来源审核”→原生 G1 一次确认→**留在来源页**等待真实 review 状态；第二次打开项目后从真实项目入口导航至来源页。不能再用 v9 的“开始理解故事”与“返回来源审核”跳转假设。

布局 locator 以当前 `StoryPages.tsx` 的 `.v2-source-preview`、`.v2-source-excerpt`、`p.v2-source-support[role=status]`、`:scope > .actions` 为范围；真实 review 卡中必须且仅检验“刷新来源状态”“确认来源审核基线”两个动作。删除 v9 `reviewButton`、第三动作 hit-test/文字断言与三按钮 Tab 预期。按真实键盘 Tab 记录进入两个按钮的顺序、焦点与可视范围；只允许点击刷新，基线确认只做布局/命中/焦点核对。三个尺寸均保留状态/隐私区非重叠、摘要独立滚动、外层必要滚动和按钮完整可见证据。新 runner、只读 OS helper、G1 helper 与 wrapper 均需在计划中绑定各自 SHA；旧 helper 也须回读当前字节后才能复用。

在同源 dist 和完整新清单到位前，**不生成可执行 runner、runId、profile 或证据目录**，避免生成可被误用的旧候选包。冻结时只生成一个新 runId（`qa02-source-preview-YYYYMMDDTHHMMSSZ-qa02a`）、位于候选 `.aijian-dev/<runId>` 的全新隔离 profile、位于 QA 外置 `evidence/<runId>` 的全新证据路径，以及长合成来源字节/SHA；确认三处均不存在。计划文件必须绑定完整清单 SHA、Web/desktop dist SHA、源码关键 SHA、runner/wrapper/helper SHA、尺寸/阈值/禁止动作和一次提交/两次 launch 上限，再申请 MGR02 对**该计划 SHA**的一次性批准与单独的可见前台授权。

## 原生验收与原始记录

| 检查 | 每个尺寸的通过条件 |
| --- | --- |
| 来源摘要 | 1424×720 可用高度至少 120 px；其余两种尺寸至少 72 px。正文在其独立滚动容器内可滚到末尾，外层布局不替它吞滚动。 |
| 状态与动作 | 真实审核状态可见；“刷新”和“确认来源审核基线”两个按钮完整落在来源预览卡片内、不换行裁切；元素中心 hit-test 落在自身或子元素。第三 fixture 按钮不作为真实页要求。 |
| 隐私与键盘 | 遮蔽/提示区不覆盖状态、正文和按钮；真实 Tab 可到达两个按钮并保持可见焦点。 |
| 读回与退出 | 提交次数至多一次；同 profile 正常重开后身份及状态一致；保存 PID、profile、窗口尺寸、原始截图、locator/几何、网络与 DB 只读回执、退出码及清理收据。 |

任何尺寸、读回或环境门失败都保留原始失败并停止本轮，不自动重试或补送审。静态/Edge、历史 Electron 与本次原生结论分别报告；按钮可见与命中不能推导基线确认成功，审核状态也不能推导最终故事或媒体验收。

## 当前结论与待决输入

当前仅完成新计划草案。DEV07 `main.ts` 源合并候选已交付；物理衍生源已获静态复制与全树回读通过，已成为本计划当前目标。执行仍缺该 SHA 的独立拒绝用例原始回执、衍生源 Web/desktop dist、固定构建和 SHA 清单、该候选的 sidecar 启动原始证据、按真实两按钮路径更新的 runner 与新一次性计划包、MGR02 对该包的批准及单独明确的前台可用条件。来源 API 原始回执在获批运行中记录。取得上述输入并重新回读后才能申请原生执行。
