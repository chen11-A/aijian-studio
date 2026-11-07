# 单镜动作完整字段卡与精确 receipt 撤销

本片段沿既有手动动作指导请求接线，不新增供应商、配音、视频派发或自动重做。美术完整事务/结构卡不在本片段。

## 显示与真实事务一致

`projectActionFields(tx, origin)` 从保存的请求事务投影所有实际变化：`action`、`actionBeats`、完整 `actionPlan`、整个 `sound`、`source`，以及变化的整场 `actionState` 和本场 `unassignedBeats`。不使用当前可变 film 重算 baseline，不用文本相似度冒充字段差异。

动作节点含开始/时长、人物/对象、身体部位/方向、力度提示、接触/反应、声音提示、难度/替代动作；伤情、道具和安全/待核项也完整显示。时间始终标为建议时间，null 不猜成 0，不声称实测动作或口型对齐。原节点标记只转“原动作段/新动作段”序号，不展示内部 ID；镜头来源/伤情/道具引用仅接受能在本 scope 说明的引用。不能映射的别镜来源、未知 key、重复/歧义 ID、不安全值或超出有界文本，整卡沿旧模式，不隐藏其他事务写入。

`assignActionBeats → withShotActions` 的原语义保留：新动作通常追加进有序 `actionBeats`，原主动作不会因此被替换。新宿主测试按真实 `shotActions` 全序列验证确认/存盘/撤销，保留原主动作和迟到媒体。当前镜头被原规则拒绝的动作可显示在完整 state/待对应差异中；确认只保存待核数据，不冒称动作已执行。

## 同一精确撤销路径

本片段仅将已验的 performance 私有字段卡窄泛化为按 transaction.role 的 direction 卡，复用同一 page-history token、past/future 状态及 `undoShotDirection` 原子逆事务。确认前后均核 exact card、当前角色、工程/页面/场/镜头；拒绝/替换/导航退休/保存中重入/旧回调不能操作其他卡或全局最近一条。

卡撤销保留其他 past/future 与无关编辑/媒体；after、场状态、用户锁冲突原子拒绝并 0 撤销写入。沿原 persistence/lease、未保存和退出 flushAll 规则，不回放旧 film，不清全局历史，不复制或重签批准/事实 proof。session 卡/token 不入 FilmProject 或工程包。

共用安全文本/closed-shape 小函数抽到 `direction-field-format.ts`，原 performance 投影语义不变；新动作 ready/applied 两码独立登记，旧 118/106 等 notice 分组不变。

## 定向证据

- 原动作/performance/B11/顶栏历史目标 27 项通过，114 项未选；没有改旧宿主 oracle。
- 新动作宿主 13 项：固定完整基线、真实 append 序列、完整 state/待对应 producer、专属撤销/迟到媒体/其他编辑、busy/旧 callback、错误工程/角色、锁/state/after 冲突和存盘失败。
- 原 performance 12 宿主在共用方向卡后保留并通过。
- 动作投影 19 项：完整 field/state/beats、安全/未知/歧义来源、节点身份变更、时间与有界文本拒绝。

最终联合 12 文件 218 项通过（包含上方宿主/投影/notice 子集，不重复累加）；另原 Pro 目标 27 项通过、114 项未选。正式 workspace TS 类型、web 生产构建、目标 ESLint/Prettier/diff 均通过。原 contracts 检查在提交后执行。仅本机 DOM/纯业务回归，无真实会员调用；未运行全仓覆盖率、完整 141 宿主或 Windows/Electron/新浏览器矩阵，不复用根 b100 的全量结果冒称本源已通过。
