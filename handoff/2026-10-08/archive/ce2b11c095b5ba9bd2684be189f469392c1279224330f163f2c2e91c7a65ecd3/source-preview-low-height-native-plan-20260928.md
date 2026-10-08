# QA02 来源预览低窗原生复验准备（2026-09-28）

状态：静态计划已具备固定构建输入，仍未授权原生运行。MGR04 已受保护同步 CSS 到 c19，状态为 `SYNCED_NOT_VISUAL_QA_ACCEPTED`；QA03 已释放同源强制 Web/Desktop typecheck 与构建窗口，四项 exit 0。下一次 Electron 执行仍须 MGR02 核新 runId、独占窗口及计划/runner/helper SHA 后明确批准。

## 固定输入及旧 RED

- 作者冻结包：`C:/Users/Administrator/Documents/AIVORA/management/manager-handoffs/release-snapshots/20260928-source-preview-low-height-css-1/SNAPSHOT.json`，SHA256 `673497C7AAEA3C5B836CD2F1B991C6298E606D42809D084F4DE2E782C696EA9E`，状态 `AUTHOR_FROZEN_NO_C19_SYNC_NO_QA`。该包内 `v2-story.base.css` SHA256 `FCCB6ACC0476641B0BFBE0D47028D008CF2C0FBCA35956F2B053C5D49EA16523`，新 `v2-story.css` SHA256 `D57ACFD69CE6190A85C0A4041798CF572889534D0FA228BDA01A5A12C83E2B6E`。
- c19 同步回执：`C:/Users/Administrator/Documents/AIVORA/management/manager-handoffs/release-snapshots/20260928-source-preview-low-height-css-c19-sync-1/SYNC-RECEIPT.json`，SHA256 `6F76ABAFEE75BFFE219F3E1646A17296989B39D96D7D59D7F56B48F3955E0EE8`。只读回算 c19 CSS 为 `D57ACFD...`；回执记载 REL03 32 项和其余 status 109 项无漂移、HEAD `211c9e8b...`、相关进程 0。同步仅证明文件到位，不是 Web dist 或原生布局 PASS。
- QA03 新同源构建清单：`C:/Users/Administrator/Documents/Codex/2026-09-23/aivora-git-c-users-administrator-documents/work/qa03-ac05-front-20260924/run-05-rel03-css-build-20260928/after-node.json`，SHA256 `0BE9ED4DA07E85BBBB959B2FFE6BDEFB5B031D0C8F67A0746532FEFD708F9291`，HEAD `211c9e8b...`、status 110、source 113、dist 82；新 Web HTML SHA256 `6D997E0C719E218B906ED733E39D7E3679272E034741D6033B6987EB1D2BDE62`，CSS asset `index-jsEG3DHn.css` SHA256 `8B8AA7581262D68B1737A61C5587C4D545020C8C9AB73C211FC317555004ED0A`。这些是构建与局部 Edge 检查的输入，不代表 Electron PASS。
- 唯一 CSS 增量为 `@media (max-height: 760px) and (min-width: 1351px)`：`.v2-source-side` 改为两行 `max-content` 且从顶部排列，`.v2-source-preview` 的摘录轨道设 `140px` 且 `overflow: visible`。外层 side 仍负责纵向滚动；这是代码预期，尚无新版本原生证明。
- 旧 v6 原生结果 `.../evidence/qa02-source-preview-20260928T013557Z-qa02a/result.json` SHA256 `DBB542BAC58350589C71E8A46E687BE3E7D95ABB49490956CD38225C427FCEEA`。1424×881 摘录高 135.31px、状态和三个动作可见；1424×720 在 `lower: excerpt lost usable height` 停止，截图 `launch1-failure.png` SHA256 `A4B127001AEB260B9581F43DB2147D21B8F08823E455BE9A9D3FDB54309ABE1E`。1024×881、Tab 和重开尚无该版本结果。旧阈值保持，不能只放宽断言取得 PASS。
- 合成来源正文仍用旧计划的 70 行文本，UTF-8 7270 字节、`source_documents.raw_sha256=85bcb2992bbb609acac6e23fc29c8c320ce10350873cba9d690b7e28b370b789`；新运行只换唯一项目名/runId，不用真实用户内容。

## 取得可运行输入前的门槛

1. MGR04 的上述 CSS 同步回执已交付。运行前仍须再读 c19 `apps/studio-web/src/aivora/v2-story.css`，确认完整 SHA `D57ACFD69CE6190A85C0A4041798CF572889534D0FA228BDA01A5A12C83E2B6E` 且无后续漂移；旧 CSS、作者新 CSS 与同步后的 c19 文件三份分别留存。
2. QA03 的上述新构建清单已交付。封 plan 前再逐项回算 HEAD、完整 `git status --short --untracked-files=all`、source 113/dist 82 路径/字节/SHA、Web HTML 与低窗 CSS asset；任何漂移即停。不得沿用旧 HTML SHA `C6CDCEF...` 或旧 QA03 manifest `6922890...`。
3. MGR02 核对新清单、CSS SHA、独占 c19 窗口、零相关进程后，为**全新** runId、隔离 profile、外置 evidence 目录和一次性 runner/helper/plan 各 SHA 签批准。旧 v6 profile、G1 challenge、result、截图与回执只读保留，不复用。

## 一次原生运行合同

- 从全新 profile 启动最多两次 Electron。仅导入上述合成文本；在第一启动中只对当前合成 project/version/hash/revision 执行一次 G1 `submit` 原生确认。确认 helper 仍须核唯一 AIVORA owner、dialog 标题、按钮、Gate/action、修订、Win32 PID/HWND/可见/启用/前台；若需焦点，只能在匹配后最多一次激活同一 dialog 并读回。发送前持久化 intent；发送不明、身份变化或失败立即停，不复用 profile。绝不确认来源审核基线、signoff、decision、provider 或上传真实内容。
- 进入 `#source` 的 `.v2-source-preview` 后，先保存**未断言的原始几何 JSON 与截图**，再逐条判断；即便首个断言失败也能保留该尺寸精确 rect/scrollTop。三尺寸顺序：1424×720、1424×881、1024×881。每尺寸核 `window.innerWidth/innerHeight` 与 Electron content size 一致。
- 每尺寸记录 entry、side、preview、privacy、excerpt、status、actions、三个按钮的 rect、computed overflow、`scrollTop/clientHeight/scrollHeight`、`elementFromPoint` 命中和 enabled。entry/preview、preview/privacy 不得相交；隐私卡在预览之后的正常文档流中，可通过指定外层滚动容器到达。摘录必须可滚动，滚轮后 `scrollTop` 增加。
- 1424×720：`.v2-source-side` 应形成可滚动外层，记录从顶部到末尾的 `scrollTop` 变化。对“刷新来源状态”“确认来源审核基线”“审核来源版本”逐个执行 `scrollIntoViewIfNeeded`，每次截屏并证明该按钮完整位于 native viewport 内、尺寸非零、未被遮挡、`elementFromPoint` 命中且 enabled；状态文字也须完整进入 viewport。摘录可用高度至少 120px，以验证新 140px 轨道没有重现旧版压缩；这比旧版 72px 底线更严格。三按钮可以依次滚动到达，不要求同屏并排。
- 1424×881：保持旧断言，摘录至少 72px，可滚动，状态和三个按钮在卡片及 viewport 内可见、可命中；外层滚动不应导致隐私卡覆盖预览。
- 1024×881：按窄屏 `.v2-source-body` 纵向滚动路径，逐个检查状态、三个按钮和隐私卡可达、可命中、互不覆盖，摘录至少 72px 且可滚动。
- 实际点击仅限“刷新来源状态”（只读）与“审核来源版本”（导航后返回）；“确认来源审核基线”只检 enabled、hit-test 和 Tab 焦点，不触发点击。记录键盘 Tab 到三个按钮的顺序及必要的滚动读回，不发送 Enter/Space。
- 第一启动正常关闭后，核进程为 0、锁可独占，再以同一隔离 profile 第二次启动，重开该合成项目并在三尺寸复核关键 rect/滚动和三按钮可达性；第二次不得再送审。最终正常关闭、read-only DB 核唯一已消费 G1 submit、唯一 review submission、`review_version_id=latest`、`accepted_version_id=NULL`、provider 连接/批准/消耗均 0、`integrity_check=ok`/外键无误，并回算新清单全部源码/dist/HEAD/status 无漂移。

## 判定与交付

三尺寸、Tab、滚动、隐私卡及重开均满足且后验清洁，才可称此 CSS 的原生布局 PASS。任一尺寸真实遮挡、摘录高度不足、按钮不可到达或重开变化为对应尺寸 RED；工具定位、原生焦点/发送不明或无新 QA03 dist 为 UNKNOWN/未执行，并保留原始退出码、截图、几何、DB、进程/锁和指纹。局部结果不能扩展为 provider、费用、安装或整品验收。实际媒体播放另待真实合规素材及可播放导出链，不能以假帧或静态截图代替。
