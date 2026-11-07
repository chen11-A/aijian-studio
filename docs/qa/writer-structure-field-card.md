# 全项目编剧结构字段卡与专属撤销

本片接通现有编剧场次结构事务的完整字段审核。任务范围始终是全项目，来自剧本、分镜或其他创作页的原始 origin 仍保留；选中场/镜只提供参考，既不强造 script 选择，也不声称只改当前对象。

## 完整原事务

`prepareWriterFieldReview` 调用原 `applyStoryConfirmation`，并复用原 `applyContinuityChecks` 计算通用文字检查影响，不复制分场、原文重建、选声、合并人物/地点或清理算法。

全部实际变化须可安全表达才进入字段模式：场次新增/移除/顺序与每个创作字段，保留手工场的编号，受影响场未使用自动镜头的完整清理，初始原稿 `sourceAfter` 逐字保留，以及 `writerAssets` 全部人物/地点成员、顺序、选声/声明和完整 `writerPlan`。未知形状、无法对应的引用或不安全内容整体沿旧卡，不显示子集后应用全部。

原解析器的 P01/P001 编号形式保留区分，显示为可读原文段号；编号原稿按原串显示，不误当对象 JSON。任意 JSON、路径、秘密、非法段号仍拒绝字段模式。段落归属、人物/地点信息、数量和预计秒数标为原声明/规则结果，不重签事实、不声称语音对齐或真实媒体时长。

每个普通文本最多约 8k UTF-16 字符（安全校验后的完整文本），单元最多 64k、总字段文本最多 512k、最多 512 行；超过可完整安全表示的范围整卡 legacy，绝不截短展示后提交全文。

## 原保护与 receipt

使用原 source/结构/预算/用户锁/媒体/音轨/任务依赖及人物地点快照 CAS。旧素材和 take 不删文件，新增工作会阻止覆盖或逆操作。手工结构编辑、导入书籍、B07 原子接受/备份/unknown 以及生成费用流程没有改写。

复用独立 session story token，保存真实 request origin。结构卡只撤销自己仍在 past 的精确 entry，调用原 `undoStoryConfirmation`，保留其他 past/future、无关编辑和媒体；不撤最近全局 entry，不回放整旧 film。自身应用选出新首场后，post-selection 只维持 applied/own undo 状态，不能成为新 forward 许可。

同次 manual references.capture 同时保存在 `StoryDraft` 与私有 `RoleCard`。请求与未应用确认使用原 forward 守卫；own applied/undo 不再跑引用输入指纹。替换、拒绝、导航、换工程、顶栏已撤销、保存忙碌与失败均有真实消费者回归。已应用但未保存不谎称成功；逆操作恢复旧首场身份时也保留准确保存反馈。

需要原 `fillCast` 额外请求的结果整体 legacy，保原路径。字段模式确认时重新核对，保存等待后也不会向变化后的 live 偷发未审核的 writer 提取。没有新 provider/TTS/video、自动重试或新增付费数量。

## 本机证据

- `/tmp/writer-card-final-targets.log`：11 文件 270 项通过，含 writer 真实宿主 22、完整纯投影 22、原 cleanup/story token、director/art/action/performance/@兼容及提示完整性/最终中文契约；范围重叠不累计成全仓数量。
- `/tmp/writer-card-original-final.log`：原 Pro 编剧/两完整工作流/相关结构选中 7 通过、134 未选，原断言未改；它与主矩阵不累加。
- 真实原 parser/producer 覆盖原稿空白与 CRLF 逐字、可靠段落编号、保留手工场只改号、完整旧自动镜头、人物/地点顺序、引用镜被本次删除/引用人物被本次改变后 own inverse、保存失败/忙碌、source/媒体/音轨/新依赖及迟到响应。
- 全 workspace TS、web build、目标 ESLint、Prettier 与 diff 均 exit0：`/tmp/writer-card-final-types.log`、`/tmp/writer-card-final-build.log`、`/tmp/writer-card-final-eslint.log`、`/tmp/writer-card-final-prettier.log`。全仓/浏览器由总控冻结集成另验。
- 原阶段失败日志保留。`pure-stage.log` 的闭合投影缺项已由实际 P01/P02、编号原稿与 agent:writer 来源定位；`host-stage.log` 是 raw fixture 与真实 canonical gender/ageBand 差异；`host-stage2.log` 是在无镜第一场错误引用 @镜头1，后按真实有镜第二场显式选择；`complete-scope-stage.log` 是旧仅 script 展示门未移除，修后 `complete-scope-stage2.log` 为 2 文件 44 通过，origin/源/媒体守卫未移除。

没有改 API、native、contracts、scripts、依赖锁、原费用/能力或覆盖率门。尚不声称未知扩展字段都能显示，也不把旧全库通过数算作本片验收。
