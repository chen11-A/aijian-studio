# AIVORA 第33批：声音入口、精确导航位置与窄窗编辑可达

精确总基线 `32d014624aad134a6884121a58a26b75088104c9`；精确父提交
`6e1df140030dc27232454ad4c2ba9e78824cd211`。仅本地候选分支，不操作离线Windows。
本批四个生产文件、三个受影响测试文件；不改公开API、契约、数据库、Provider或费用授权。

## 实际实现

production制作页和成片组装页的标题区增加“声音与字幕”入口，沿用现有 `d.go`
及未保存/busy/UNKNOWN导航守护。声音页“本集成片组装”返回同一作品同一分集。
普通/专业使用同一对象与数据权限。旧fixture入口保留。

制作请求组件只在renderer会话中记录scope与用户已核对请求的version/hash。返回后
仍通过原 `getMediaPreparation` 精确GET，核完整闭回执、schema、scope、version/hash；
不要求旧选项在首20条历史中，不用最新请求替代。实际输入内容、候选与UNKNOWN日志
仍从原链读取；定位缓存不保存业务正文，不发POST、不清除原输入。父Workflow只接收
当前scope的已验证对象，旧异步A→B→A结果不能改变新选择。

装配组件仅记录scope、viewkind、已保存version/hash、segmentId与序列frame。
同一可靠已保存版本、仍存在的片段及合法帧范围才恢复；版本或范围变化明确要求
重新选择。Voice隐藏画面轨，因此Voice位置与assembly位置分别保留，避免覆盖
画面片段定位。该缓存不是业务持久层，不修改原SQLite装配、head下限或完整原操作journal，
不自动保存。关闭renderer后的导航定位恢复不在本批声明中。

声音主体复用已有 `v2-media-body native-assembly-body` 有界滚动容器，使窄窗下方
音频编辑控件可鼠标到达，标题返回入口仍可见；没有改声音业务或新增CSS体系。
现有本地录音DRAFT仍明确不证明对白内容、声线授权或口型同步，正式语音生成未接通。

## 受影响验证与证据边界

根验证59个不同renderer用例：制作请求8、装配19、声音6、候选/组合guard5，以及
原MediaPages21。后21为旧fixture导航回归，不能证明新production入口；新增入口由
受控实际浏览器另验。新语义回归5项覆盖精确旧版本超首历史页恢复、hash变化与
UNKNOWN原日志保留、缓存读取晚到ABA、Voice往返片段/85帧恢复、版本变更/另一分集
不套旧定位。重复子集不累加。最终TS类型检查、七文件ESLint/Prettier通过，正常
`pnpm contracts:check` 通过且输出未改；未重复未失效的第32批后端/desktop全部测试。

七文件最终冻结
`a77c6de48d0d692fa610dcbc1c2291a1d5b85d02cd06ed2b6c5eebd3cbca3d83`。
初始一文件入口冻结、首次七文件冻结、两个TS字段/夹具类型错误、首次31通过1失败
的回归原日志均保留；最终修复实际生产字段为 `detail.content.input` 的scope，
夹具只加已有类型断言，没有降低契约检查。首次命令中不存在的Workflow/复数Candidate
测试路径由Vitest忽略，不算运行文件；候选/组合guard随后按真实单数文件单独5项通过。
第一次误用 `pnpm typecheck` 在TS阶段停止，Python阶段未执行；最终沿既有TS检查命令。

独立只读审查最终七项SHA全部一致，10个不同新UI控制通过，33个根重叠回归单列：
合法cached历史不能闭UNKNOWN、dirty refresh/guard、异作品/分集回执、三种非法帧、
Voice拒绝画面marker、dirty新片段和不同UNKNOWN正文不能写到旧保存hash的定位。
有限范围未发现可证明的新P1/P2，不推导全产品无缺陷。最初UNKNOWN探索错误期待
dirty正文恢复旧40帧，实际canonical比较正确阻止；原脚本/failed输出及修正理由保留。
独立报告SHA `342f650127291469d4ac5d1b2e24873b5d364a93bb9816f0c5418f8664466ec2`，
32成员manifest SHA `d09ee0d0df894b69251d7918229cafafc2516b494244c6591a2c0edfb7262a1f`；
包含两个清单共34文件422288B逐字节复制，见 `INDEPENDENT_COPY_VERIFICATION.json`。

独立浏览器修复前15个case保留两个真实往返定位失败及既有Voice滚动失败；修复后
10个case全部通过，19截图含三份候选setup诊断，不能当19个测试。1440×900、980×680
的第2画面片段及85帧往返均保持同version/hash/完整refs，制作原请求返回精确GET
及Workflow source enabled。Voice实际wheel移动且下方frame控件真实鼠标聚焦。
相邻双输入dirty取消一次确认、装配dirty取消及两UNKNOWN完整journal字节保持。
每case数据库前后SHA相等，新增业务写入0、pageerror0。受控最初普通/专业入口8
组合与最终10case区分，不扩大成最终所有模式/尺寸像素验收。

完整独立UX报告另回应原件预览占比/多屏距离、面板拥挤、时间轴效率、常用点击数、
普通/专业区别和全部仍开放建议，复用原31/32证据而不虚构最终33面积比例。
完整报告见
`docs/quality/evidence/aivora-batch33/final-browser-ux/UX33_INDEPENDENT_FULL_REVIEW.md`，
SHA `fcb2472871cfab662623b4b9952699c5842b3eff7faf52508e1d50e0a7925c1a`。
310成员68557833B清单SHA
`068d1bca35ed7ec43246930f26835c7952c3735b1b587f7d23f66f772fdd9843`；
加三个self记录共313文件68617980B逐字节复制，差异0。57PNG中PRE38/POST19，
独立代理实际看像素13张，根另记录两次实际像素查看，不宣称全部57逐张看过。
26隔离SQLite含25完成case及1脚本诊断，前后hash全相等；113实际版本读回另以
stdlib canonical SHA和SQLite正文交叉核验。两份Vite已停止，原32seal只读复核未变。
首次根复制器错用files/entries而非members字段，在写任何成员前停止，修正后全复制；
未改变独立清单。真实生产renderer、installed Chromium/direct Vite、隔离SQLite
读取桥不冒称Windows原生窗口、真实声音播放、原生IPC、Provider、编码或模型验收。
禁止构建/安装/真实调用保持。

独立UX汇总可直接转述的结论如下，详细窗口/source/截图/量测路径均在完整报告：

- 第31批滚到原件后的panel未裁剪DOM矩形占主面板56.07%–59.39%，img框36.88%–43.03%；
  包含标题/留白，不是实际绘制像素、初始固定主预览或第33批比例。当前原件预览不能替代
  未保存序列/裁剪/字幕/混音实时监看。既有1440装配内容2832px、scroller582px，
  wheel2100到原件时轨道/保存已离屏；预览和剪切上下文多屏分离继续开放。
- 既有专业右栏308px不可显式收起。30实测1600/980主区1048/540px，普通收起为
  1368/860px；最终33源码分支仍同。此为布局效率差异，没有模式改变数据权限的证据。
- 真实整数帧/range ArrowRight 0→1可用，但生产尚无可编辑时间码、zoom/fit及专业
  剪辑快捷键；旧fixture缩放不计生产。输入焦点和Windows真实播放另验。
- 32两尺寸历史→候选source→asset为4点击5wheel，保存另1点击；33新Voice入口与
  返回各1点击，制作历史核对+三个导航+展开候选共5点击。计数属于具体fixture路径，
  不把全部审片/生成/导出完整工作流的点击数凭空补齐。
- 下一优先级：预览/裁剪/保存同视野；时间轴跳转/缩放/快捷键；专业右栏可收回宽度；
  精确source摘要与可展开完整JSON；人读名称/版本层级。busy、UNKNOWN、rights、来源
  失效与批准上下文必须保留；新增布局待用户选项答复。

本批源码/文档范围diff检查通过；完整原始证据diff可保留空行等警告，不删失败日志、
不采用历史归档排除规则或降低CI门槛。精确stage/commit/transfer信息另由本地交付清单记录。

## 后续依赖

预览与裁剪/保存控件的新布局按产品基线第9节已向用户提出具体位置选项，尚无回答；
不把等待时间当作选择。原多屏操作距离、时间码/缩放/快捷键、侧栏与来源信息层级
仍开放。明确的修复往返定位和既有滚动可达不依赖该新布局选择。

完整23页五阶段继续按矩阵推进；正式媒体/声音协议、预算账本授权、完整输出/审片签发、
Windows安装/恢复/播放和原Word逐页核对仍开放。Sub2API网关已明确，不重复询问或
自行选择付费供应商。未来真实调用逐次展示账号模型、完整内容、费用额度与不确定性并确认。
原DRAFT上限、安全审计、CI/coverage、许可证及历史证据规则保持。

正式Library helper的只读tools/list网络失败尚未确认恢复，本批不绕过或重复调用。
所有源码、原始失败、历史证据及可转移补丁按本地交付清单保留；本地路径不是下载链接。
