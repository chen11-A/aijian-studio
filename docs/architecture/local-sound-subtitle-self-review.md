# 已保存本地声音与文字字幕的自审事实

第36批沿用 `docs/product/AIVORA-完整产品需求与验收基线.md` 的 P14/P18/P19 与精确版本、修改失效、历史可读要求。总基线为 `32d014624aad134a6884121a58a26b75088104c9`，父提交为 `2e26ccb268e35bf56e1449711016aab9f85728de`。它实现有限人工观察记录；正式 SoundApproval、SubtitleApproval、MixApproval、G7B/G7C/G8 的检查表、阻断级别和签发政策尚未定义，不用新增勾选代替政策。

## 生产入口和单一事实

装配与 Voice 共用 `LocalMediaReviewPanel` 和既有保存装配。普通、专业模式使用相同原件、记录和数据权限。Voice 新建时只选音频，仍可回读同集全部历史。没有第二套装配、浏览器业务库、Provider、编码、发布或费用动作。

新建目标只来自已保存装配的实际音频片段或固定文字字幕片段。未保存装配、字幕或裁剪输入禁止建立新的观察。人工记录必须同时提交非空具体观察、显式选择 CHECKED 或 NEEDS_CHANGES、显式 `self_review:true`；三者默认均不预填。CHECKED 的产品文案是“已核对并记录”，不是质量通过或正式批准。

声音核对绑定完整导入原件的 asset/version/SHA/尺寸/类型/文件名和实际保存声音片段。播放器复用既有精确原件读取；它播放完整原件，未应用序列裁剪或混音。字幕核对绑定文字、整数帧范围、画布与实际保存片段；它不是实际字形、遮挡、可读性或字幕母版验收。不证明音质、音画同步、口型或真人试听。本批受控操作使用自有合成测试素材，不能替代使用者实际自审或 Windows 播放验收。

## 精确目标和事务

目标 GET 要求 project/episode、保存 assembly version/hash、类型和 segment id。目标快照包含保存装配 head revision、完整所选 segment 与其正文 hash、时基/画布/总帧、实际原件或固定文字，以及存在时的精确剧本 version/hash/block/hash 与保存 provenance。服务端从现有 SQLite 读取并核对；客户端不能提交另一个自造 target 正文。

POST 使用原操作 UUID 作为幂等键，完整 input 带 target snapshot hash。人工记录自己的 parent/revision 用于该集自审历史 CAS；它与装配 revision 分开。服务端在同一 BEGIN IMMEDIATE 中复核当前保存头、所选对象、今天原件与权利、来源和正文，保守共享既有32MiB读取/散列与10k查询预算。输入不能把数值1转换成声明true。结果记录使用同一 artifact/version 与归因操作收据；actor固定 local-user，所有正文固定 manual_review_only:true、formal_status:BLOCKED。

固定 preload/IPC 方法只有 target/list/get/status/save/original 六种，真实主窗口授权在选择 API client 前检查。没有通用 URL/channel 或 renderer actor。公开 OpenAPI 提供四个只读 GET；native write 与原操作恢复维持私有 native 路由和专用生成 closed schema。桌面/renderer分别校验完整闭合模型和 canonical SHA、scope、原命令、版本父/序号/result revision、UTC 日历和分页头；新 HTTP 读取上限1,500,000B，超时30秒，分页最多20条，不扩大旧读取或DRAFT限额。

## 不可变历史、当前失效和来源

历史 version GET、分页和原 operation GET验证持久事实及其保存装配、片段、原媒体元数据、来源和依赖边。它们不依赖今天原件存在、权利允许或新鲜确认，因此文件丢失/变更或来源替代后仍能读取原观察和精确原操作。

独立 status GET读取当前适用性。CURRENT 只表示本记录绑定仍相同；STALE 表示装配、原件、权利或选用来源已变化；读取预算或事实无法核实返回 UNKNOWN。renderer还把CURRENT的 current assembly三字段与已读不可变 record.input交叉核对。新的未确认草稿或同源重复确认不导致假失效，实际 confirmed 来源替代会失效。任何状态均为 formal_status:BLOCKED，既有 PictureLock、MixMaster 和正式输出缺项继续阻断。

普通保存装配替换目前没有专门持久 change-event ledger。本批通过精确不继承绑定与读时状态失效实现记录隔离，未宣称完整持久替代事件/全链影响报告已补齐。已有剧本确认替代历史、依赖记录与原失效政策保留，不回填旧事件，不把缺影响报告当作通过。

## UNKNOWN、输入保护和异步隔离

发POST前先把原 UUID/完整命令写入现有本地恢复日志并读回；日志损坏、额度不足或读回失败时0POST。日志只保存恢复意图，业务事实仍在 SQLite。无法确定归因时锁定新保存，保持内存和持久原命令，不自动重发、换UUID或用最新历史推断成功。

桌面只在 POST完整可信时做一次原操作 GET并要求两个 data 完全一致；坏/丢 POST直接 UNKNOWN，不自动查或重发。使用者的“只读核对原自审保存”只 GET原UUID加完整payload hash。404或坏回执不证明未写入。可信结果但日志无法关闭同样保持 UNKNOWN。明确预提交拒绝仅接受严格错误合同/状态/code白名单，不解除其他原操作。

未保存观察、结果与声明通过原页面/作品/分集导航和卸载 guard保护；明确放弃才清空，装配换版时原输入仍保留并禁止新提交。目标与状态按保存装配 epoch、request 和mounted scope拒绝过期结果；同集immutable历史按mounted episode/request隔离。A→B→A的旧实例不能写入新A。卸载后晚到写结果不会清掉原日志；重新进入时可以准确读取旧装配绑定的原操作，不能重新发送。
