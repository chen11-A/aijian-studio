# AIVORA 第36批：本地声音与文字字幕显式自审

精确总基线 `32d014624aad134a6884121a58a26b75088104c9`；父提交 `2e26ccb268e35bf56e1449711016aab9f85728de`；仅本地分支 `codex/aivora-product-local-20261011`。第35批提交、seal、源码投影、23卷CAS和完整Git增量包保持原件。未推送、合并main或触发远端CI。

## 本批代码与实际边界

装配、Voice已接生产 `LocalMediaReviewPanel`，使用实际固定桌面六方法、preload、transport、API和既有SQLite artifact/version/归因操作链。可显式选择已保存完整声音原件或固定文字字幕片段，亲自核对后填写具体观察、选择结果、勾选自审声明并保存，再回读不可变历史与独立当前适用状态。三个输入均默认空，未预填通过。对同集的历史、原操作与对象选择采用独立准确版本，不按最新一项推断。音频新建入口与字幕新建入口共享事实；普通、专业权限与数据质量相同。

记录精确绑定作品/分集、保存装配 version/hash/revision、片段正文hash、原件与存在时剧本来源。服务端同一有界事务重新核对，历史和新鲜状态分开。当前替换、文件丢失/变更、权利限制或来源替代后记录不会自动继承；历史仍可读。新建目标不要求与所选声音/字幕无关的画面G5通过，不降低原正式门。

未保存观察保护接入原装配导航/卸载guard；装配/字幕/裁剪有输入时禁新自审，观察输入与装配contentDirty分开避免循环锁。旧异步结果、A→B→A和晚到保存按精确scope/request/epoch处理。写入前原命令必须日志写入读回；UNKNOWN保持原命令、锁定新写，仅显式原GET恢复，坏回执/404/无法关闭日志不算成功，不自动POST重发。

声音播放器仍是完整原件，未应用序列裁剪或混音；字幕仍是固定文字与帧范围，不是实际画面字形/遮挡/可读性。CHECKED只表示已核对并记录；全部记录固定 `manual_review_only:true / formal_status:BLOCKED`。正式 SoundApproval/SubtitleApproval、MixApproval、G7B/G7C/G8政策没有定义，本批没有代拟检查表或签发。普通装配替代没有完整持久事件ledger，本批实现读时失效与不继承，未宣称全链失效完结。具体合同见[架构说明](../architecture/local-sound-subtitle-self-review.md)。

## 验证、失败与独立审核

最终28源/测试/配置/真实DTO夹具/生成合同freeze清单 `evidence/aivora-batch36/root/SOURCE_FREEZE_AFTER_NATIVE_GRID_FIX.json`，SHA256 `3265bebd27d2695e9a049092af935934dc22ec57eaf86a3e6b7af19e2461597c`。原c499、两源StrictMode ac2、三次CSS冻结及中间CSS字节均完整保留；业务控制对应ac2，最终仅两个CSS文件发生局部布局delta。新renderer16个不同控制PASS，受影响既有五文件108个不同控制按未失效证据链PASS；不把19项局部重放重复相加。新desktop39PASS、另3个真实HTTP/SQLite记录字节跨层回放PASS（回放不产生新HTTP或写入）。后端新增27与相关旧37 nodeid交集0，union64 PASS；另纯模型脚本不加pytest数量。以上均是实施者验证，不称独立批准。

全仓TS类型检查和288源strict mypy通过，受影响ESLint/Ruff/Prettier/格式检查通过。正常合同生成保持128条全部旧paths及519全部旧schema对象完全相同，新增四个公开只读GET/15模型；native写入与原操作GET继续不公开。提交后正常contracts:check另存交付回执。没有重复无关全量coverage、构建或安装；原安全审计、CI、许可证及失败门槛保留。

原始失败与argv/UTC/exit保留。root第一次新测试有受控mock递归/缺hook参数/初始busy等待错误，第二次是未等待原日志关闭污染下一case；修复测试后15PASS，未发真实HTTP或重发业务。既有受影响测试的两个失败由可选接口提示额外alert角色引发，生产改为可见普通p，未改旧测试或保护，19项局部重放PASS。后端和桌面实现者也保留初期fixture/参数/lint诊断，不算产品既有错误被消除。

独立审核由 `/root/professional_ux_workflow` 对实际 localhost Vite生产入口、实际桌面客户端、认证本地API和独立SQLite执行，实施者两代理不算独立批准。首次data URL能力探测被政策拒绝，未重试或绕过；合法localhost已成功，无需受控DOM fallback。前两次界面观察分别是scratch桥缺health别名，以及实际Store保存的16:9项目被公开项目接口9:16拒绝，均0review POST，错误/原库保留，不通过桥改DTO伪造成功。第二项单独登记为真实产品合同支持缺口，不能仅叫测试数据问题；新的9:16夹具只供自审闭环核对，不覆盖16:9失败。父补充用户历史明确偏好16:9写实电影感，权威PRD要求领域模型不锁死画幅；实际创建与公开/客户端guard仍硬编码9:16，多比例sample inspector不等于生产选项，装配横屏和独立ProductionBrief不改变项目比例。未检查或改动用户电脑已有项目，后续只做明确局部合同/创建入口修复与回归，VisualBible/正式全链比例仍另列。独立真实生产操作随后发现StrictMode重挂时历史busyRef未释放的永久busy缺陷（0POST）；root最小修复cleanup的只读owner，不清原写命令/journal，并补StrictMode首个延迟坏scope回执不得覆盖第二个合法回执、0自动POST控制，16项最终PASS。PRE实际失败/截图/HTTP保留，独立已完成11项真实UI/SQLite业务控制：显式声音保存、四种窗口/普通专业同对象读取、文字字幕输入保护与保存、两种UNKNOWN原GET恢复、双作品双分集/A→B→A/忙时导航、原件丢失/变更历史读回、新装配显式保存及旧记录失效。实际产生4个自审POST与1个独立装配POST；设置数据写入不混计。最后样式delta另用只读控制核对，不把这些重放重复计入11项。980专业实测还发现声明受全局column影响及父grid隐式列532.453px超过自身content466px；保留PRE、dec650两窄窗口真实FAIL、祖先诊断，最小改为声明row/正常checkbox及现有native单列minmax(0,1fr)，不重画布局。最终980普通/专业两项只读布局PASS，实际label文字关联和旧timeline/素材控件仍可达、0POST且DB字节不变；1440普通/专业两项沿用dec650未失效PASS。11业务/ac2、两宽CSS/dec650、两窄CSS/3265分层复用，不合并称15项全链验收。独立stdlib核对26个case数据库、203次完整API正文canonical SHA、131个完整SQL正文hash和32次原件字节hash；实际1314 GET、4原自审UUID+1装配UUID归因闭合，两份原夹具成员未改。该脚本只读且不调用产品parser/hash/store，不把GET数量当作独立测试数。最终seal保留全部原始失败。

## 交付与继续产品

第36批源码投影继续包含精确总基线以来全部非evidence变更。新证据采用增量CAS：旧35的精确23卷、旧index SHA及完整历史map/blob metadata作为显式只读依赖，36只存尚未封存的新内容；不再携带旧字体或全源码快照。旧提交/原raw/错误/86卷和35seal不变，未采用历史排除规则。新helper只增加明确 `--evidence-parent` 且逐卷SHA/尺寸核对，源独立应用仍不需要任何证据卷；组合完整tree与所有历史SHA在精确提交后实际owned恢复验证。源码投影、完整字节树与真实Git历史仍分别说明，路径不冒充下载链接。

获授权的一次Library只读检查成功，但本次唯一正式保存助手在准备/上传前网络失败，未创建文件ID、没有已保存链接、没有第二次尝试或直接工具fallback。保留原sealed35源码ZIP `1,361,336B / b2aab7b7d337f58336377aa086beb43a12ef411a817589b4ae10c1e4ac67186f`，最新用户确认下载仍27，28是历史正式保存而未获用户确认。原助手/失败原件与小说明保留，不能把只读成功当作正式上传成功。

全23页/五阶段、原始Word逐页核对、正式媒体/Voice、口型、声音字幕签发/母版/完整输出、持久全链失效和Windows原生安装播放恢复仍开放。较大布局与预算两问未向用户提出，不称用户欠答；没有代选付费供应商、币种、额度或扩大权限。每次未来真实调用仍需完整账号/模型/内容/费用/额度不确定性逐次确认。电脑恢复后同步先检查未提交内容，任何重启先请使用者保存确认。

本批无真实模型/图像/视频/语音、费用、凭据输入、用户账号/电脑操作，未绕过工具/网络拒绝。第37批已明确局部16:9项目合同、读取、新建选择与只读设置一致性修复，继续保留VisualBible/G5固定portrait政策和完整16:9正式全链未完成边界；正式政策与真实模型/Windows部分依赖不能以自审记录代替。
