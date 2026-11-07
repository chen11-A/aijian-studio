# 全项目美术字段审核与卡片撤销

本片段覆盖现有 `ArtTransaction` 的已知字段、场景/道具新增及原纯美术算法的派生影响。真实作用范围是全项目，当前选中对象只提供上下文；不是单人修改，也不包含结构重排、生成或付费调用。

## 显示与准入

- 请求基线固定。全部变化、完整新增内容和可解释引用都能安全表达时才显示字段卡，否则整卡沿用旧模式，不以部分字段预览提交完整事务。
- 调用原 `applyArtTransaction` 纯模拟，仍由原 `setFilmStyle`、`resolveCostumes` 产生预览影响。画风变更会对全项目当前镜头与场景参考图产生待核对标记；服装风险是规则计算，不是新原文证据。
- 确认前对真正影响派生创作结果的输入复核：新增镜头、增加参考图、服装原文/范围变化要求重新查看。保存时间、缓存、晚到镜头素材不使原建议失效。没有画风变化的普通场景字段事务不凭新参考文件无谓拒绝。
- 字段展示使用捕获的名称、场次与段落范围。未知声音、无法对应的声明引用、未知形状、路径或敏感文本使整卡退回旧模式。素材声明不代表文件存在、原文事实或已核验媒体。

## 专属撤销

`recordArt` 返回仅当前会话使用的独立 token。卡片只撤销自己仍处于当前 page history past 中的精确事务，并调用原 `undoArtTransaction`；不调用最近全局撤销，不回放旧工程。保留其他 past/future 条目、无关新编辑和晚媒体。顶栏已撤销、清空历史、换工程/页面/选镜、替换或拒绝后的旧回调不能撤销别的条目。

原字段 after 值、用户锁、新增实体的完整内容及其后续场景引用仍由原算法守卫。逆操作重新计算当前派生状态，不恢复旧标记或重新签发事实。保存期间拒绝/重复确认/撤销均受业务守卫；写失败仍明确为已应用但未保存，沿用原保稿和退出保护。

## 本机验证

- 最终定向 `/tmp/art-card-final-targets.log`：10 文件 188 项通过，包含 15 个真实 Pro 美术宿主、动作 13、表演 12，以及完整字段/窄准入/art receipt/原 art transaction/history/提示契约。
- 原 Pro 美术兼容 `/tmp/art-card-original-final.log`：15 通过、126 未选；另原 B11/prompt `/tmp/art-card-original-prompt-direction.log`：15 通过、126 未选。两次选中范围有重叠，不累加。保留真实静帧 producer、媒体路径回读、手工锁、保存与逆事务断言。
- 正式全 workspace `typecheck:ts`、web build、目标 ESLint/Prettier 和 diff 检查均通过，日志 `/tmp/art-card-final-types.log`、`/tmp/art-card-build-final.log`、`/tmp/art-card-final-eslint.log`、`/tmp/art-card-final-prettier.log`。全仓测试由总控在冻结源码另行集成，本片段未跑或冒称全量。
- 原 `B11 applies and undoes a fixed art proposal without losing a subsequently generated frame` 现在明确：离页退休旧卡、旧回调零写；真实生成帧后回页重新请求、确认新固定建议，再撤销仍保留原真实帧。另两个 delayed art save 用例只迁移准确 ready/确认入口，仍拒绝 undo/page 后的迟到成功提示。
- 原失败日志 `/tmp/art-card-consumer-stage.log`、`host-stage3.log`、`original-stage*.log` 保留。它们记录夹具入口、保存文案和 script 页遗漏独立会话卡消费的发现；最终结果按对应源码快照记录，不抹去失败。

没有真实会员调用，没有新媒体生成能力或自动重做。未支持的声明或引用形状仍保守使用旧展示；本片段不宣称所有未来美术字段均受支持。
