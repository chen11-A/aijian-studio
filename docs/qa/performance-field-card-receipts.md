# 表演字段卡与专属撤销

本片段只接单镜表演建议，复用原真实 `ShotDirectionTransaction`，不调用新的供应商、TTS、视频生成或自动重做。动作、美术完整事务与结构卡专属撤销不在本片段。

## 固定完整投影

`projectPerformanceFields` 只读请求捕获的 transaction/selection。支持 `performance`、闭合 typed `performancePlan`、`performanceSource`、`delivery`、`source` 与变化的 `performanceState`，不以当前 film 重算“原来”。计划中的人物/表情/视线/呼吸/声音/来源声明/时间提示全部投影为安全文案；时间始终叫建议时间，不声称语音或画面实测对齐。

必须整笔可投影才进入字段模式；未知 key、路径/凭据/内部 ID、不安全文本、无法对应本镜的 sourceId、非空未分配计划或别镜 review 等整卡退回原展示，沿原事务完整确认，绝不只显示文字却隐藏应用其他字段。尚未变更的锁定语气不列入差异且继续受原应用守卫保护。新增两个精确通知独立登记，旧 118/106 等契约分组保持。

表演字段/scene state 本身会改变原 assistant 输入版本，因此这张卡的 session 身份单独保留；不写入 FilmProject、历史快照、工程包或任何授权/事实 proof。只有原工程、页面、场和镜头精确匹配才显示/操作。换 scope 会退休旧请求，返回同 scope 也不能重放旧回调；新卡替换、拒绝、保存中重入、其他角色的旧回调均有业务守卫。

## 精确 receipt 的撤销

`pageHistory.recordDirection(tx)` 返回 session token，原调用可忽略返回值。token 随真实 past/future 的原 undo/redo move 保留，history reset 后不复用 token 序号。

`undoDirectionReceipt(current, scope, token)` 只查该 token 的已应用条目，再调用原 `undoShotDirection` 的原子 after 值、scene state、用户锁与工程/镜头守卫。成功只移动该条到 future，保留其余 past/future；不调用全局最近 undo，不回放旧 FilmProject。冲突时返回原对象且不写入。卡状态据 token 的实际 past/future 驱动；顶栏已撤销或历史缺失时旧卡不能撤其他内容。卡撤销成功会退卡，原 redo 历史仍保留。

确认和撤销复用原 persistence 保存/未保存提示与 quit flushAll，不改变队列或 lease 规则。保存失败仍保留实际 live 修改并明确未保存；不因回调完成就假称已落盘。保存中按钮禁用，业务 ref 同时独立拒绝旧回调。

## 定向证据范围

- 新动作层与 formatter 加原页历史/方向 4 文件 38 项阶段通过；新增已有 future 的两次 redo 回归随后也通过。
- 原 prompt/art 字段、页历史/方向与 SuggestionCard 等 7 文件 66 项通过。
- 新真实 Pro 宿主 12 项通过：完整固定基线、0 提前应用、专属撤销保无关编辑/迟到媒体、deferred 保存防旧回调、拒绝/替换/导航退休、真实存盘失败、顶栏已撤 token、错工程/错角色和 after/state/锁冲突 0 撤销写入。
- notice 两文件 108 项通过，覆盖原静态提示完整性与独立新增两码的精确文案。

旧 Pro 锁定 delivery 用例进入新字段模式后，旧“表演·镜头/放进分镜”查询已按真实字段确认迁移，保留原 performance、delivery 和 userFields 的全部保存断言，另核确认前没有改写。最终联合 10 文件 186 项通过（包含上述 12 宿主及相关分层子集，不重复累加）；另原 Pro 宿主所选 20 项通过、121 项未选。两端正式 TS 类型与 web 生产构建、目标 ESLint/Prettier/diff 收尾通过。旧“仅所选 typed performance/保护锁”两参数也只迁移了真实字段入口，原计划/场状态/旧动作/语气锁断言保留。未运行完整 141 项或全仓覆盖率，不宣称 Windows/Electron 浏览器已验。
