# 本镜声音建议：明确选轨与整组核对

本 UI 以 dev `97d181d` 为基线，包含已审核单资源 foreign 守卫 `73f10e5`。复用稳定 native `applyBundledFilmShotAudio`，没有循环调用旧单资源 add，没有生成/供应商调用，也未改原保存队列、退出协议、native/DTO 或工具许可。

## 用户路径

剪辑 → 查看本镜声音建议 → 核对全部段、来源/许可、计划时间、包络和限制 → 明确勾选轨道 → “选用所选轨道的完整建议”。默认全不勾选；空轨不可选。每条选中轨道保留全部 segments，只追加，不替换已有片段。确认一次最多发一个 exact 八字段请求；双击由同步 gate 去重。仅这段写入/核对期间锁定关闭与刷新，查看和人工审阅不持保存 owner。

成功后当前版本列出配声组及实际段数/轨道，可明确移除对应组；只移引用，不删文件、原片、定妆、takes 或其他片段。原本地素材逐段列表/移除入口保留。原字段撤销仍可撤此前文字编辑，不能把它冒称这次声音添加的撤销；界面直接说明撤销添加应移除对应组。

## 完整组与保存安全

- 选用时沿原 lease 保存/采用真实 canonical 媒体，再读完整 raw hash；绑定当前工程、镜头、选版和已核对输入。主进程重算语义 fingerprint，fresh raw CAS 不被 savedAt 元数据缓存替代。确认前工程无新增片段，预检失败零 apply。
- 复用中立纯 helper 的固定成员序列化，逐 UTF-8 SHA256，再对固定排序完整成员集 SHA256。全局 clipID 唯一，非本组重号也拒绝。原始 raw 旧片段必须原序逐项完全保留，其他 raw 创作字段不变，只有明确保存元数据和本次 audioClips append 可变。
- 新增 N 段与所选 lanes 的完整原计划按唯一 key 一一匹配；相同内容的重复段仍按数量保留，包络/增益/启用/素材 SHA/绑定/名称完整检查。raw 与 normalized 全组各自验 body，不借 upgrade 修好畸形 metadata。receipt 缺键、额外键、部分成员或错误摘要均保留 unknown，不能假成功。
- 未确认响应只 inspect/readback，不自动重发。先有效 inspect 证明同 factory 旧操作结束（BUSY/传输失败不证明），再 fresh raw 与完整 intent/delta 证明结果。无 ACK 可以证明完整结果；metadata 本身不是授权，也不能代替完整组/原始 raw 校验。
- single/group 共用原 global pending Map、全局 footer 核对、冲突摘要/文字备忘/显式采用保存版本。关闭旧 dialog、换页/作品使 generation 过期，不会跳过未知结果登记。所有 unresolved 状态释放 owner，但原 quit 仍真实报告 unknown/failed。
- 迟到结果只精确追加整组，保留同页或原工程后来编辑；当前另一工程不 apply、不 write。删除旧片段、换源或真正 canonical 冲突保留两份，只有用户重新核对并明确采用 fresh 保存版本才解除。最后 live/draft 检查、apply/confirm 在同一无 await 段；兼容本 lease 唯一合法 rebase 引用过渡。
- 整组移除先异步验 SHA，再同步重核当前 ref/选择/组输入 token 与精确 IDs；未知、缺员、改过或跨组碰撞不能聚合移除。已确认 native 结果后，release 保存新编辑失败是普通未保存错误，不能制造无 external 状态的假 pending。

## 实际验证与边界

- 最终联合 15 文件 **158 项通过**：完整组 proof 24、实际 Pro 19、group 两类微任务、原 single 两类微任务、原手动库 19，以及只读 viewer/队列/退出/保存/历史/画面字段/架构检查。日志 `/tmp/shot-audio-apply-ui-final-joint.log`。
- group 实际宿主覆盖默认空选/取消、单次完整 lane/复用资源多段、双击锁、预检编辑失效/失败零 RPC、部分 receipt/canonical 不成功、BUSY unknown 与 global readback、generation 已失效仍登记、同页/foreign 保稿、切版仍保原媒体、冲突显式采用、release 后编辑保存失败、整组移除/碰撞/await 期间变化拒绝，以及此前字段 undo 保留声音组。
- 原 foreign 快路径的真实队列受控 before 两项失败在 `/tmp/shot-audio-group-microtask-before.log`，已独立闭环 `73f10e5`；本分支合 dev 后的新联合覆盖正常 safe rebase 与两类 guard，未放宽单条 validator 或超时。
- 新旧浏览器 Node 契约 **35 项通过**，日志 `/tmp/shot-audio-apply-ui-node-contracts.log`；正式 web build（含 `tsc -b`）、目标 ESLint/Prettier/diff 检查。没有本轮全量覆盖率声明，完整联合门由总控执行。
- 原 260 态不变；建议默认查看 16 态按真实新界面改为三条 lane 初始未勾选、唯一确认 disabled/零 apply，仍完整检查原内容与几何。旧 source `799b8cc` 的 16 态通过不借给当前新 UI；显式 apply/移组/unknown 正常 Chrome 执行态另批补，不混称本批已过。

UI 宿主使用受控合成 native 回包与文件集合，不是实际 ZIP/FS/FFmpeg/听感验证；真实 native 复制、去重、资源 pin、包络及真实媒体检查已有独立产品证据。本批不自动试听、不声称看过/听过、原生成来源认证、全片自动配声或 Windows Electron 完整窗口验收。
