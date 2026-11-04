# 手工本地媒体候选及装配选用（第32批设计）

设计起点为本地候选 `41e4895781294507c1eede42f01ae035db16fe51`，实施父提交为最小UX修复 `6d28690b01df7b0303c17b63a31acebe75c3c81c`，精确工作基线仍为 `32d014624aad134a6884121a58a26b75088104c9`。原开发代号31的初始设计审查按原文件名保存，未声称那时已有完成实现。Windows离线，本批只实施本地源码和受控测试。本地导入并非Provider生成结果、审片签发或费用凭证；所有界面仍标明DRAFT及费用UNKNOWN。普通/专业模式使用相同对象和数据权限。

## 产品路径及单一数据真相

制作页面第30批已保存的完整制作请求，可以明确选择一个作品所有的、已导入的IMAGE/VIDEO**精确资产版本**，写入新的 `episode_manual_media_candidate` artifact version。输入含作品/分集、请求版本与content hash、资产ID/版本/SHA、完整手工关联说明。不可使用“最新素材”“最新请求”替代用户选择。候选只关联既有资产原件；不复制文件、不写episode_references作为装配替代、不创建另一媒体库、任务、模型、供应商或费用记录。

候选内容保存完整关联输入、固定 `LOCAL_IMPORT` / `MANUAL_ASSOCIATION` / `UNKNOWN` 来源与费用边界，并快照精确素材的文件名、kind、mime、size、SHA及导入技术元数据。可信作者由后端限定human/local-user。候选历史20条keyset分页，历史快照只读，文件丢失/权益变更不会改写历史。候选可关联旧请求，但这不授予后续装配许可。

装配页面列出同作品同分集候选，显式选入当前视觉轨的一个片段或明确添加片段。选入只改变未保存编辑；用户另行点击保存。保存后的片段新增可选 `manual_candidate_ref`（candidate version/content hash、preparation version/content hash、固定MANUAL_ADOPTION意图），与真实media ref、storyboard_ref完全匹配。它保留用户手工选用证据，而不是宣称镜头已由模型完成。现有装配作者记录提供可信human/local-user保存作者。旧片段不注入null，原schema/version/content hash保持字节兼容。

片段剪切、移动、undo保留来源；换素材或重绑定分镜必须显式解除候选来源或被保存校验拒绝，不能留下虚假来源。候选选择保持精确ID，即使头版本变更也不自动改选。帧率必须与请求快照精确相同，不能静默舍入。选入没有保存/预览编码/Provider/发布/费用副作用。

## 输入、原件、权益与批准

后端在同一SQLite事务中只读指定资产版本，先SQL检测技术JSON长度，再解析闭模型；不通过 `MediaAssetStore.get_asset` 全历史展开。不使用Windows限定的selected-reader结果模拟Linux实机能力。

关联新候选时核对原件在既有32MiB验证范围内实际存在、安全路径、SHA/size/稳定文件签名，拒绝UNKNOWN/丢失/变更/错误hash、IMAGE/VIDEO意图与kind不一致、RESTRICTED及坏权益历史。PENDING_REVIEW可记录手工DRAFT候选但不等于权益已清楚。资产行必须确实LOCAL_IMPORT。技术尺寸/时长不符合输入不能表示已满足要求；现有媒体probe/装配时长校验仍分别生效。

历史候选读取验证输入完整闭合、精确请求历史/snapshot、不可变素材元数据、hash、作者、依赖和原写入回执；不要求当前文件/最新许可，历史原件状态不冒充当前可用。

**新装配保存、DRAFT预览、DRAFT导出等真实消费者**对候选来源重新检查原件/最新权益、精确请求分镜/G5、所选参考原件。若请求绑定script version，必须匹配当前已确认剧本；无script pin的旧手工分镜可在明确DRAFT范围继续，不授予确认。存在visual pin时沿用当前G5签核验证；历史的批准不自动变为当前有效。撤回/替换批准、script confirmation变更、库/身份锁失效、原件/许可变化阻止新选用/保存/执行，不篡改旧历史。正式审片/真实生成/真实模型验收仍未实现。

手工关联记录可继续指向历史请求，但不授予当前G5或剧本确认权限；实际选入后的新装配保存和DRAFT执行必须通过上述新鲜度校验。历史关联的可读、可另存不代表可执行。关联本身仍检查所选本地原件及最新权益。

## 依赖和预算

候选到制作请求是 `derived_from/blocking`；制作请求到精确分镜已是blocking；装配到所选候选新增 `references/blocking`。既有storyboard/script依赖仍保留。中央assembly provenance校验覆盖保存、读取、preview/export、invalidation和script impact，精确验证新边并保留旧边规则。每次递归读取沿用同一 `ImpactMaterializationBudget`，SQL body/source-span/edge数先检查，单源2MiB、distinct recursive source总32MiB不绕过；候选自身256KiB，20条分页共享预算。已有DRAFT32视觉/32音频/30分钟/1920及32MiB原件验证范围不扩常量。

## 原写入归因与UNKNOWN

迁移46添加candidate original write receipt及assembly original write receipt，均append-only/FK/unique version。UUID保留原输入大小写字节；receipt只保存key hash、完整payload+可信actor hash、实际CAS、artifact/version关联，不再复制内容真相。

candidate新native POST与GET-only原操作查询对应固定IPC/preload接口；public只有history/detail GET。装配既有版本POST保留兼容入口，生产UI改用带Idempotency-Key的精确写入及新的GET-only原操作核对。完整装配payload包括content、parent、expected_revision、change_summary。版本/依赖/receipt/CAS在BEGIN IMMEDIATE同一事务内；先构造完整结果再commit。commit后响应构造失败归类500UNKNOWN，不能变成明确422/409。

前端在第一次POST前保存完整原intent并回读，session scope Map跨真实page/remount维持原intent。任何不确定/坏回执/header/hash/过期ABA异步结果只允许同原UUID和完整payload hash的GET核对，不自动重发、不从最新版本或内容相似推断成功或不存在。日志缺失可恢复原X，日志被Y替换必须保留Y并BLOCKED；清除必须完整原intent相等且remove后回读empty。明确拒绝只能凭封闭、精确code/status/request UUID回执；404原操作缺失仍UNKNOWN。旧assembly v1日志不能被新v2覆盖或自动洗掉：显示未归因旧日志、保留并阻止新写入，需要用户后续明确处理。

## 页面防丢与布局

制作请求和手工候选在一个制作页面内共享导航guard协调：先检查busy、UNKNOWN原intent可完整保留、阻断日志，再一次询问全部未保存输入；任何子控件先阻断时不能清除其他控件dirty。每个子对象维护自己的完整日志，但同一页面guard不可后注册覆盖前guard。候选用折叠/精确请求选择的详情区，保持既有主题/字体/图标/左导航/五阶段，不做大改版。装配内明确展示片段来源与未保存选择，并保留timeline现有功能。

## 本批必要证据

定向测试：双作品双分集、A→B→A与过期结果；未保存输入与组合导航guard；原日志丢失/被替换/坏闭回执/错header/hash/旧schema及UNKNOWN不重发；事务各失败点与postcommit响应失败；selected资产SQL预算/坏元数据/错owner/SHA/kind；丢失/变更原件、RESTRICTED/坏权益历史；旧请求历史可读而新选用script/G5失效拒绝；保存的片段确实消费同一候选/input/asset，错误引用/源替换拒绝；deps/invalidation/impact消费者预算；旧无candidate装配hash不变。批准、关联、选用和保存都不调用Provider/编码/发布/费用。

当前头恢复另保留已核对的修订下限与同修订身份；旧头、NOT_FOUND和同修订不同version/hash均不得覆盖输入或解锁新CAS。历史original的不可变result_revision只归因原操作；若其动态head_revision更高，只记当前头下限，另读真实当前版本。对白、引用字幕、literal字幕来源和显式CONFIRMED剧本均参加同一SQL-before-JSON累计预算。共享闭模型校验支持有明确值schema的字典，仍拒绝无约束additionalProperties、坏类型、孤立代理项及超限元数据。

桌面沙箱preload保持仅Electron运行时依赖；精确写入、手工候选、既有制作输入和确认影响通道在preload使用固定字面量，并以共享契约的字面量类型编译校验。当前桌面构建配置为tsc直接输出，不能依赖打包器消除任意运行时导入。此批定向修复此前确认影响与制作输入引入的同类回归；不以测试VM通过声明Windows原生实测。

运行受影响Python/renderer/desktop定向单元与集成测试、typecheck、scoped lint/format、contract determinism与旧公开surface兼容。独立设计/实现review保存完整原始证据与SHA。受控浏览器UX检查另有代理，必须区分实际像素交互、源码推断、Windows待验；不把fixture/浏览器结果称为native/model实测。不执行build/install。
