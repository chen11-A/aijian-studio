# 5-3 剩余交互：独立正常浏览器门

复用旧 clean `/workspace/aivora-interrupted-audit`，旧分支 `codex/aivora-interrupted-audit@d2ad837` 保留；新 `codex/aivora-ui-interaction-browser` 从 `29140d5` 开始。原四态 WIP 检查点 `58968f9` 独立保留。实际发现的 cut-history 小修已单独冻结 `f7fdd889fdbfdde8e8bb431495523ca3db34f516`，本 QA 基于它，不修改其它产品代码。

新增 `ui-interactions` 四个固定态 × 两窗口 1280×800/1920×1080 × 两画幅 16:9/9:16 = 16。原 468 定义/步骤保留；484 仅定义，新增正常 Chrome 尚待运行。没有读取/目视 CI 截图或人工全片视听。

| 原编号/状态                 | 实际消费者与强断言                                                                                                                                                                                                                                                                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 02 / ui-context-menus       | 实际 right mouse click 分镜卡、场次和时间线片段；ContextMenu 的完整条目与现 More/页面操作对应、Escape 关闭。done 版本实际有五个分镜操作（包含“重新生成画面”），不套旧无媒体四项 oracle。真实“后移”→Ctrl+Z 恢复原镜序；无生成操作执行。菜单含禁用项仍做原全盒几何/滚动检查，只不对禁用按钮做不可能的 actionability 点击。                                       |
| 04 / ui-title-composition   | 原顶栏双击→Esc 放弃、Enter 一次原 native rename；原六镜三版/音轨保留。Chromium CDP Input.imeSetComposition/Input.insertText 驱动受控可信 composition 管线，合成中数字/Enter 不导航/提交，随后显式提交；不派发 JS KeyboardEvent/不注入 React state。此项只证明受控 composition guard，绝不称 Windows/系统中文 IME 人工验收。助手输入保留给字段，不发模型。      |
| 07 / ui-property-counts     | 真实 summary 点击展开/折叠，声音两项→计数2、展开不显示数量、清一项→1；高级填写/清空实际画风字段，折叠1/空、展开无数字。核 data-count 与人读 title，保全部媒体，非只镜像 CSS 文本。                                                                                                                                                                             |
| 09/10 / ui-transport-delete | 原剪辑页 L/K/J 和速度控件，↑/↓ 按 main 回执 actual clock 跳切点、←0边界、→按现常量1/30秒请求；不声称 codec 逐帧精度。输入、ContextMenu、实际导出 dialog 不误删。Delete、Backspace 各一次六→五→Ctrl+Z六；严格等待本次 native/真实保存队列就绪再继续，五次 exact canonical hash/selection/opId 请求，保全部原 takes/stills/版本/音轨，0 legacy/cancel/provider。 |

## 夹具与安全范围

消费实际 ProWorkspace。复用已有 `seedProProject` 六镜三版、evidence 原六条音轨、assembly 新 ABI 与已验媒体请求 spy，只加当前 native rename 的有界实现。原 paid/text/voice/project creation/legacy assembly 仍 forbidden。未移除 paid forbidden 来容纳本机能力。被删镜头的原 clip 引用为撤销保留，本机 waveform 请求对缺 owner 只能 SOURCE_CHANGED：严格唯一 clip、固定本地源与输入形状，绝不产峰值/文件。五个实际结构 revision 对应现 hook 重查正常 owner 数 6+5+6+5+6=28，另两次 orphan 拒绝，exact 数量及每次参数匹配在短宿主锁住；非任意 N 或实际 FFmpeg 听感证据。

原 geometry 阈值、完整可滚到、elementFromPoint、禁用态与错误退出不变。使用真实菜单/输入/键盘/指针，不 force、不改原 mouse 轨迹、不伪造 currentTime getter、不注入候选 CSS。受控 loadedmetadata 和声明 artifact 的 play/seek spy 只验实际 UI 消费/时钟计算，不能代替自定义协议、真实解码/播放/耳听。

初始短 host 暴露两个真实事实：done 三 take 菜单比旧无媒体样本多一项，现 oracle 精确五项；自动 assembly refs 使 cut undo 失效，已独立 before→产品小修→actual Pro 真 stale clock/重合成证明，详见 `cut-history-native-assembly.md`。未用更改 QA 容差掩盖。原 WIP/失败日志均保留。

## 已执行与待验

- 同默认 ABI 实际 Pro 四态 **4/4**：`/tmp/ui-interactions-host-final.log`；各实际菜单/rename/计数/运输及恢复路径，无模型/提供商。
- 旧144+新9 Node 契约 **153/153**：`/tmp/ui-interactions-all-contracts-final.log`。包括默认六镜三版、seed保全、rename完整记录/外作品选择不抢、无效输入拒绝、orphan只拒绝、paid禁门、CLI unsafe/setup 与固定16、二次白名单/max8/有限几何与行号且 PRIVATE/NaN/Infinity 不泄露。
- 目标 7mjs ESLint/node check、全部9文件 Prettier/diff；旧 workflow 完整前缀相对 `29140d5` byte-identical，产品源码相对 `f7fdd88` 无 diff。最终检查日志 `/tmp/ui-interactions-eslint-final.log`、`/tmp/ui-interactions-format-final.log`。
- 独立 Ubuntu `pro-ui-interactions` job，Node24.15，15分钟，正常 Chrome sandbox=true。先 Node9，再实际16；artifact 精确 `.aijian-dev/pro-ui-interactions-audit/report.json`、`1280x800-*/*.png`、`1920x1080-*/*.png`。公共诊断只固定 state/控件名/标签/有界数字与源码行号，不输出原 DOM/正文/路径/错误栈。源码 hash 覆盖真实 Pro/ContextMenu/dismiss/assembly/结构历史和新脚本。

新增正常16待 root 专用候选运行。原平台/人工/真实 Windows OS 菜单、输入法与视听边界保留；父链自动前置图 P0 契约另在 backend 开发，本片不扩大生成许可或宣称该缺口已闭环。
