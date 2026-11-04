# AIVORA 第34批：生产装配时间轴（2026-10-11）

精确总基线 `32d014624aad134a6884121a58a26b75088104c9`；本批父提交 `5d990703679ca98c4139e47cd880a2d034f129a3`，本地候选分支 `codex/aivora-product-local-20261011`。启动clean。原参考分支读前核验和最终本地提交记录另存；不改main、远端、CI或Windows电脑。

## 实际代码与边界

生产 `AssemblyTrackEditor` 接入真实 `AssemblyTimeline`，从当前 `AssemblyContent` 的画面、音频、字幕区间派生比例轨道与刻度。未复制TimelineWorkbench的fixture、useDemo、演示时钟或示例镜头。复用整数帧、`frameTimecode/parseTimecode/anchoredScroll/rulerStep`及原单一保存/UNKNOWN链；只有新增wrapper明确拒绝empty与exclusive末端 `total_frames`，DROP_FRAME限定准确30000/1001。

时间码HH:MM:SS:FF可输入并显式Enter／按钮定位，非法输入保留并提示，Escape明确恢复。帧输入与range仍可操作；所有view操作不修改业务content/dirty/日志。完整比例轨道支持点击定位、真实viewport测量、1–64倍相对fit缩放及playhead屏幕位置锚定；fit自动响应窗口宽度。画面上一／下一镜头与Voice音频定位共用原片段选择guard。版本/hash/作品/分集/视图/时基的key变化重置时间码草稿、缩放及测量；当前未保存内容变化保留视图并依据当前范围夹紧。

聚焦时间轴区域后←/→逐帧、Shift±10、Home/End、↑/↓镜头或Voice片段、+/−、F；Ctrl+B/Delete/Ctrl+Z/Ctrl+Shift+Z调用现有分割/删除/父撤销历史，只改变当前草稿。输入、按钮、contenteditable后代、IME、Alt/Meta与编辑重复按键不触发区域动作；未应用裁剪/字幕、busy/reliability/UNKNOWN仍阻止选段、编辑及撤销。另点原保存才会写入。原DRAFT播放、导出、32视觉32音频／30分钟／1920、原件32MiB、权限、安全与CI边界未改。

局部CSS覆盖旧mockup30px固定行及44px span规则，给真实时间码/帧控件正常文档流，修复PRE六组合中实际可见的输入与V1标题重叠。未改变既定主题、五阶段母版或专业右栏。

## 根检查及原失败

初始受影响5文件48个不同renderer测试通过；独立缺陷修复后最终复用旧40与新增生产控件13个共53个不同测试通过，新增生产控件13个、旧装配19/Voice6/编辑adapter及旧TimelineWorkbench纯helper回归。旧widgetfixture测试不作为生产新功能实测。最终8项重放不另计总数。全仓TS typecheck、范围ESLint/Prettier和正常contracts:check通过；本批不重复未失效32/33后端/desktop全量。所有stdout/argv/time/exit原件在evidence目录。

首次实际web类型检查发现引用剧本文块的旧字幕没有text；兼容后文本字幕轨添加“字幕 · ”前缀，避免既有编辑查找与轨道正文重复，原装配19未改测试而通过。测试中的tuple字面量联合及故意非法30fps fixture需明确测试类型，初始类型失败保留、修后全仓通过。初步 `tsc -p tsconfig.json --noEmit`使用只有references的空配置，**不计实际类型通过**；后续实际tsconfig.app和全仓typecheck结果才计。第一次48项中1个字幕重复文本失败保留，第二48通过；随后最终测试类型修复重放8通过。

DF浏览器夹具是owned复制SQLite经现有store显式保存20,000帧、30000/1001 DF、两张真实导入图片0–10000／10000–20000。明确移除25fps原分镜/候选引用，不冒称错误时基同来源；独立只读核对真实version正文、canonicalhash、媒体原件和SQL回执。夹具setup有且仅1次写入，与浏览器导航写0分列。准备脚本save成功后误认为返回wrapper，在 `.version`断言抛AttributeError；原脚本/失败说明保留，之后只读read_version与SQL核对，没有重发或第二次保存。原UUID失败前未落盘，**不声称UUID已核对**；也不将fixture setup当生产UI显式保存验收。工具输出未自动写原stdout文件，说明不是重构原日志。

## 独立审查／实际浏览器

设计有条件通过：独立21父Gitblob、7组纯helper控制、完整风险表30原件加2清单已逐字节复制，manifest `9d92221182b005e9636992daf926b0e519edf28bf664ef7ade63f960be991343`，报告 `9f43495cadece4626c03629d12abae9e8d5ce627f02601ed74bd8b1fd5be13ad`。不是实现通过。初始6源freeze `0b0692b83419ca76e8becbf9a8cd2ab77eac1ea051d58bc963a0896ed556096a`。

独立实现初冻结定位了三项真实edge并保留最小复现：1px边框在600px/3000帧fit点击100帧实际偏至105；未提交时间码85→86→85复活；defaultPrevented Delete仍触发回调。另发现重叠音频同row遮挡。修复分别减viewport.clientLeft、外部帧变化清view草稿、拒已消费事件、display-only interval packing且max-height260垂直有界。追加4回归，最终2的52通过；最终2源freeze `1ed3f1b754c64dcec5e7a2c314e346ee506b7f153692429c0a7e45368b1ae43c`，原freeze不可变。

真实audio重叠fixture复制原已保存150帧/25fps装配，1次导入自有10秒PCM静音WAV、1次显式精确保存（无语音/编码/播放）；两个BGM/SFX0–150段在同一media version。完整UUID/payload保存前落盘，original+readback+canonicalhash核对，视觉refs保留。两个setup动作与DF的1save单列，browser所有写入另列。新literal字幕合同禁止互相重叠，仅legacy-only保留旧geometry；没有构造违法新字幕或改合同，legacy重叠browser留空。

独立设计必要P3无障碍反馈也已补齐：时间码aria-invalid、useId关联当前nominal帧号范围/local错误；外部seek/有效jump/Escape/改输入清error。另将极短比例段border/padding改为inset-shadow，保持真实声明宽度；初始是静态比例风险；后续受控browser合法dirty分割产生1帧条、实测width与scale差<0.032px及padding/border0，再撤销且DB不变。不称已发生saved短段故障或已保存短段播放验收。新增1回归，最终13新控件测试过，旧40未失效合计53；全仓TS与受影响ESLint通过。最终3源freeze `bdf78d60ffb894d17d0792e19f916eef26dd47755358f25cbcebf959c8638531`。独立最终implementation已封存：5项可行动发现范围内均修复；第二冻结10组生产控制+第三冻结3差异控制通过，按未失效证据复用不累加root53。包含实际hook UNKNOWN原UUID/fullpayload/历史/零新save、trim/Voice真实样率、fit/百万帧/旧ROscope等。报告SHA `abe80407d5c8be4ce09b4282c4ae52f61c734a0b45fa4d2ccba2d7acd5069969`，manifest `b8366bfd8b2822691ed1f2706eab3c8691000d0bb81b5f6a6f56189f7c06aa9e`；1580原件+2self记录逐字节复制全部SHA匹配，129396846原件bytes含三份完整旧source快照/字体/图片，不是新生产资产。最终3六基础组合、DF/dirty/resize/UNKNOWN/audio八深度实际mouse/key和DB只读通过；tiny几何仍须按具体证据边界解释，不借静态替代。root实际查看最新33 PRE980pro帧85、final3r2 POST980pro TC85及1440ordinary fit，输入/V1重叠消失但窄窗常驻长guide多行，独立UX确认屏幕效率P2。最小工程折叠改为details默认收起＋原完整guide和常驻草稿保存/非实时一句提示；不改变handler/CSS/业务数据及五阶段/侧栏，最终4只1renderer JSX差异，其余5源不变。最终4源freeze `79eaaeafb2490057d9cf0aeb57c88b06304b39969cb40a75bf0e3ee85374a008`，13新增控件重放/fullTS/范围lint过；新source六组合展开收起/逐帧/截图单列复测，不重放未失效DF/UNKNOWN。最新33精确PRE六尺寸/模式组合、18PNG和99成员已封存；旧number+range0→1可用，没有新增时间码/zoom/keys。实际看3图见旧帧输入与V1标题重叠P2。最终3和最终4各自封存精确source、实际mouse/key、scroll/focus/整数映射、完整GET/数据库/hash/写入原件；最终4仅帮助差异复验，不用source证明代替其实际展开/收起及区域焦点验证。

最终4独立实现增量1个生产DOM控制通过，完整guide文字与普通/Voice保持、summary键盘不会触发业务回调；JSDOM的原生click展开/关闭不冒充浏览器默认键盘行为。该增量与独立最终2的10／最终3的3按未失效链单列，**不加入根53**。最终4增量报告SHA `c272aeca448f8ffdacd0abc4f3a8816898a839186290e77c0fd662db04b4367d`、manifest `ea834cbfa5d8136afa6cbb9609519edb71c2d51ed09658f04f92cb6cc5cf6d59`，23原件+2self全部逐字节复制，旧1580清单保持原hash。

受控Chromium最终3基础6＋深度8、最终4帮助差异6，共20个不同PASS案例。不是20个全在最终4重复跑：其余5源及全部功能handler前缀不变的字节证明支持复用。全部31案例目录包含最新33 PRE6、成功20和harness诊断5；5个诊断分别是Chrome整数化clientX期望、宽窗click落左导航、25fps帧范围误期待25而实际00–24、undo后未显式重选、UNKNOWN离开确认默认dismiss，原始stderr/steps/SQLite/截图完整保留，不当成产品失败或PASS。96PNG是全部实际截图，不等于96项测试。agent版本回执核对74；根另用stdlib（不导入当前product helper）完整canonical JSON/SHA和只读SQLite独立核对204次完整hash出现记录，并确认31库SHA操作前后全部相同、新STORE_EVENTS_34业务write0；204不是唯一版本/测试数，两个独立计数不累加。

根实际查看7张PNG并逐SHA记录在ROOT_ACTUAL_PIXEL_REVIEW.json；轻量UX报告保留其中5张原字节PNG与具体frame/scroll/source上下文，**不是同帧同scroll逐像素对照**。真实980帮助折叠后时间轴409→374.1875（减少34.8125px）；1440/1600 336→345.1875（增加9.1875px），展开分别462.1875/389.1875。不称所有窗口更紧凑。clip list仍需滚动；未测量当前原件预览可见面积，不外推31面积比例。真实保存BGM/SFX重叠两row可见，未播放；legacy重叠字幕与真实saved极短段browser验收仍留空；已执行的合法1帧dirty几何诊断与未执行saved版本区分。大量超过260px轨道竖向拥挤未实测。所有owned dev/runner/worker已停止。浏览器0写入与准备夹具2个owned保存／1个owned导入分别列示，真实模型、费用、用户电脑操作均0。

独立浏览器最终封存547成员/145570928bytes，连3self记录共550文件逐字节复制；全部成员SHA相同。报告 `a1c707ca4ccc52c0ff7ac423f26443c476524090f21053db8687c736f0efb121`，manifest `de532e4611f3ce569da4cdd980a5e800985dcf04d1eecf37b8325cb5e988a62d`，verification `6aad910c9d4cb7b5f9d0248b36a89a72ed0248278bd625716a8cc50b80c36021`。五完整source快照用无损CAS ZIP+每快照逐文件映射保留（1053/1056/1056/1056/1056；1066唯一字节blob），ZIP SHA `e237c872e7c69bc37cddeefa12fcc14ef13ae92d1a896556086f65c660a076e2`；根重新读全部ZIP成员及每快照每源blob，长度/SHA全通过。所有原source目录未删改，无历史/失败排除规则。agent直接看13张、root另直接看7张，重叠不累加为20张不同图片。原非法TC的通用last notice可能在有效定位后仍显示旧信息，当前局部ARIA已正确清除；可选P3以后仅清本控件拥有的旧notice，不能清UNKNOWN/保存状态，本批不扩scope。

## 较大布局供父选择，尚未提问用户

第33批历史检查点/矩阵曾将delegate内布局问题写为用户待答；父最新纠正：父尚未见具体问题且未向用户提问。历史原件不重写；本记录和当前矩阵以此更正为准。较大布局**没有用户欠答状态**。

建议A：所选原件监看与片段裁剪相邻，提供显式紧凑／较大高度切换；专业右栏显式收起/恢复并保留Inspector/assistant tab与上下文。减少已测多屏往返、释放既有308px，但需决定预览高度与轨道剩余空间；较大预览会增加滚动。仍是原件监看，不是实时成片。建议父展示此具体方案后再决策。

备选B：保留现有预览位置与固定专业右栏，仅加入编辑/原件间显式定位、低频来源JSON折叠和固定当前版本/保存状态入口。变更较小、上下文始终可见，仍占308px且长集往返仍存在。不能借此本批擅自重画母版。主题/五阶段/普通专业同数据权限均保留。31的预览DOM比例只支持当时scroll到原件状态，不外推34；POST若未测量可见像素不得宣称占比。

## 剩余／交付边界

正式媒体/Voice独立精确缺项报告已完成，75父Gitblob+11记录+2manifest逐字节复制；报告SHA `ab5c2b7873e92ff9150fceef7a9a1ea8ce28f2c17bc8baec9036490ad1cd5810`，manifest `3d3d184cfa548dd741659a0be09611301e790a8965d2f794c13ec1e9828c0be3`。详见evidence/independent-protocol-gaps/FINAL_PROTOCOL_GAPS.md：当前TEXT/官方建议、SOURCE.EXTRACT专用task不同于媒体；production只有IMAGE/VIDEO准备＋LOCAL_IMPORT候选，Voice仅本地audioOnly。缺可证模型能力profile、完整每次输入/上传/费用授权、exact submit/幂等与原clientID lookup、status/取消竞争、输出bytes/hash/provenance/候选QA消费、新通用预算/ledger及正式派发UI闭环。source_kind目前只LOCAL_IMPORT，task费用NOT_RECORDED、allowed_actions只有VIEW_DETAILS，现成source.extract+USD合同不能冒充媒体或用户已选币种。Voice还需immutable VoicePlan/合法声线与克隆同意、exact对白读本批准、TTS/试听修订/人工签发、音帧对齐和真实口型、SoundSpotting/CueSheet/ducking/MixMaster。

给父一次集中澄清材料：沿已定服务，寻找实际图片/视频/配音/口型各接口文档与获授权model/voice ID（submit/idempotency/原lookup/status/cancel/output/账单，不问用户表名或hash）；预算原两问；Voice合法现成声线或克隆样本及其授权范围。没有在夜间向用户重复提问或索取secret。工程supplier-neutral typed意图/history/只读恢复、VoicePlan与来源、budget“未配置”可继续零外呼设计实施，不把预算未知当所有工程停止理由；这些后续尚未实现不报为完成。

预算仍是原两问：分集是否占作品总额度、确定超额如何交互（现有建议不等于用户批准）。正式审片签发/PictureLock/master/完整输出规格与原Word逐页核对开放。Windows原生窗口、实际播放/DPI/键盘、模型质量、安装恢复等未验证，不执行构建/安装/编码/实时调用来填空。

无推送/合并/远端CI、真实Provider/图像/视频/语音/费用/凭据、用户账号或Windows工作区操作。Library正式helper tools/list网络失败未证明恢复，不重试/绕过，也不把scratch路径当下载链接。33所有24分卷与31/32旧原件保留；本批提交后保留完整累积源码/原始证据、SHA与三种精确基线隔离恢复，另有小型审查源包及轻量UX报告，正式保存仅在服务恢复证据成立后执行。
