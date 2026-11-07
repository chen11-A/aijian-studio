# 当前场导演结构字段卡与专属撤销

首片只覆盖一个实际当前场、一个 director batch。编剧全项目结构、多场导演事务、需隐式补提人物/地点、无法完整安全表达的字段或引用继续整卡旧模式；本片不宣称所有结构编辑已完成。

## 原事务与固定审核

`prepareDirectorFieldReview(base, transaction, origin)` 调用原 `applyStoryConfirmation` 完整纯模拟，并复用原 `applyContinuityChecks` 展示通用文字/记录检查的重算影响。完整展示真实新增、移除、顺序、改变的创作字段、台词/说话人、完整导演计划、原文声明核对、文本 coverage、shotBudget、未分配动作及其列表插入位置。原镜按固定请求镜号识别，新增镜按建议号；不显示原始 ID、路径、对象 JSON 或凭据。

原文和任务快照是原 CAS 依赖，不是新写入证据。段落成员、模型时间、动作节点和镜头秒数均明确为声明/计划，不代表事实证明、逐词语音对齐或真实成片时钟。任意素材 token 无法可靠映射时保守回旧卡，不冒称已有参考素材。

审核使用固定请求基线；确认以最新 live 调用相同原事务/完整投影，真实创作派生结果不再匹配则零写。旧 source、after、用户锁、coverage、预算、媒体和音轨/任务依赖保护均沿原算法。没有放宽用户手工结构编辑、B07 本机备份或 unknown 流程。

## 原 fillCast 后续边界

原 `applyPendingStory` 保存后可能再异步请求 writer 抽取人物/地点，这不是固定导演事务内可预知的变化。因此需要该后续的作品整卡 legacy，保原流程。字段模式确认时再次核对该条件，保存等待后也不会借后来变化的 live 偷发未审核 writer 请求。正常字段模式只保存这次原事务，不生成、重试或增加付费数量。

## 会话 receipt

`recordStory` 返回独立 session token，并明确保存实际 request origin；原顶栏 undo/redo move 保留同 token。`storyReceiptState` 与 `undoStoryReceipt` 精确查自己 scope/token，并调用原 `undoStoryConfirmation`，保留其他 past/future 和无关新编辑。没有最近全局 undo、旧 film 回放、新逆引擎或重新签发 facts。

自身 apply 替换首镜时，以实际 post-selection 保留 applied 卡与撤销入口，不能成为新 forward 许可。用户换工程/页面/选镜、卡被替换/拒绝、顶栏已撤销或 history reset 后旧回调失效。保存忙碌不能假拒绝；保存失败仍保当前改动并明确未落盘。逆操作恢复不同首镜身份时也按实际恢复后 scope 判断保存结果。

## 本机证据

- `/tmp/director-card-final-targets.log`：9 文件 207 项通过，包含真实 Pro director 宿主 19、完整纯投影 10、story token 7、原 story/structure 和动作/表演值格式器、提示完整性/最终中文契约。原 118/106 及既有新增提示分组未改。
- 实际 `parseDirectorShots` 的完整 `directorPlan/sourceReview`、新增删排、固定原镜身份、原 pure 覆盖/预算/未分配动作均有真实数据回归。
- `/tmp/director-card-final-consumers2.log`：9 文件 97 项通过，包含 director/art/action/performance 真实宿主与手工结构、page history、重试兼容；`/tmp/director-card-original-final.log`：原 Pro 导演/编剧/storyboard/walk/结构选中 14 通过、127 未选。范围与主矩阵有重叠，不累加成全库。
- 最终全 workspace TS 和 web build 均 exit0：`/tmp/director-card-final-type-confirmed.log`、`/tmp/director-card-final-build-confirmed.log`。全库/浏览器由总控在冻结源集成，本片没有宣称已过。
- `/tmp/director-card-token-stage.log`、`pure-stage.log` 保留首阶段失败：夹具误期待 board 撤 project.title，已改为真实同页另一场画面历史条目，未改变历史引擎；`host-stage.log` 记录 hydrate 添加可选空字段/文字检查的发现，已完整投影并复用原纯检查，不用部分显示继续全事务 apply。

没有真实会员调用、媒体生成或供应商费用。未修改 API、native、contracts、scripts、依赖锁、原严重度或测试门。
