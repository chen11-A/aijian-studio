# B07 主进程 canonical 审核与原子拆镜（第一 native 切片）

本切片接 main prepare/apply、强制本机备份与原子结构替换。没有 Pro 接线、额外 TTS/图片/视频、raw 音频切割或真实超限 evidence；后者仍独立实现。旧 renderer 离线计划只作预估，真正接受必须使用本主进程返回的计划与审核摘要。

## 单实现与 ABI

中立 `@aijian/contracts/film-dialogue-split-plan` 是真实 JS/.d.ts 运行模块，统一 sentence planner、canonicalDialogueLines（保持旧 shotLines 兼容优先级）、speechSeconds（真实测量优先）、0.4/0.6 常量和创作 context。renderer 原入口委托它，main 不 import renderer，也没有复制算法。Node/浏览器 ICU 可能不同，所以 native prepare 与 apply 必须在同一 main runtime 重编，不假设浏览器预估指纹通用。

`prepareFilmDialogueSplit` exact `{projectId,expectedHash,shotId,versions}`；实际 record.id 必须等于请求，不信 series fallback。main 读已落盘 canonical 源，验证完整 shots/scenes shape、唯一 ID、镜号、所选 take 自洽、无危险 continuity、无 queued/running/uncertain 任务，再给 `READY {projectId,shotId,projectHash,reviewFingerprint,model,plan,notes}`。plan 仍是估计，不保证真实语音 cap；当前普通生成模型由 canonical draft 选择现 1.5/full-lite。

`applyFilmDialogueSplit` exact 同 scope 加 `reviewFingerprint`。renderer 不提交新镜 ID、任意 rows/路径或函数。main 重编同 canonical 计划；原完整 raw hash 与独立语义审核摘要都必须相符，正常仅 savedAt 保存可用 fresh raw 接续同审阅。review 不持 active/lease。固定频道为 `film:dialogue-split-prepare / film:dialogue-split-apply`，只真实主窗口主帧、一个参数；sandbox preload 只依赖 electron。

成功为 `APPLIED {project,backup,childIds}`，project 来自实际 canonical readback。失败只有固定码 INVALID_INPUT、PROJECT_CHANGED、BUSY、UNSUPPORTED_PLAN、BACKUP_FAILED、WRITE_FAILED、WRITE_UNCONFIRMED，不传原 Error.message/路径。

## 原队列内 backup + CAS

history factory 的 main-only `withDialogueSplitBackup` 在原 `transactFilmProject` 内完成 canonical raw 校验、结构 guard、wx/fsync 完整快照、新 raw 复核及条件 write；没有 capture 后普通 renderer.save 窗口，也没有嵌套 transact 死锁。准确 reason 为 `before-dialogue-split`，历史标签“拆镜前保留的原版”；该内部 reason 不开放为普通 capture 参数。

备份失败零结构写。源记录超过可读历史安全容量不能接受。实际 write ACK 后 stale/empty/wrong-project 读回，或 write 可能已落盘却回执失败，返回 WRITE_UNCONFIRMED、unchanged:false、backup，并保留所有文件/快照。写前明确失败才 unchanged:true。同 factory prepare 在真实 write pending 时必须 BUSY；非 BUSY 只证明上一生命周期 settled，不能证明成功。后续 UI 必须用原 external-write lease/unknown 全局保稿与完整 canonical delta核对，不自动 reapply。

## 创作、旧素材与审批

所有子镜都用 main 新 UUID，不复用第一镜旧 ID。只精确替换一个目标、同场后镜加 N−1，其他镜/场完整保留；不 filter 修复无关坏记录。目标外 null/bad shot/scene 或重复 scene 都拒绝，零结构变化。

子镜沿用原 scene、景别、机位、运镜、画面/动作/表演文字、人物、风格/说法等白名单创作。仍原样携带的用户字段锁保留，再加 line/seconds；不把空 prompt 的旧锁带给新镜。台词按完整原行 UTF-16 映射，估计时长含每镜头尾。

子镜不复制旧 takes/stills/poster/selectedTakeId、source review、导演/表演/动作计划、directorFrame/VideoPrompt、promptZh/En 或 reviewedVideoPrompt。因此旧 seven-part 审批不能给新镜授信。旧 sound.sfx 动作时点不猜分配；整体 ambience/musicMood 可沿用。旧 assembly/export 与已结束 pipeline 派生缓存清掉，完整旧状态在备份里。

当前 audioClips 完整保留原 ID/shot/take/路径/增益等关联，不删除或自动转给新 UUID；旧全片音轨时点也未自动重排，须人工审核。旧 proof 不转给新镜。原视频/音频文件 bytes 不变，不调用 provider。

每子镜 `splitSource {schemaVersion:1,historyId,sourceShotId,sourceLineIndex,startOffset,endOffset,reviewFingerprint}` 是有界创作来源，normalize 保留合法值，不是恢复/媒体授权。**原镜完整版本仅在本机强制历史可恢复；工程包只包含当前稿、不含本机 history。** 真 ZIP 导入后 metadata 可保留，但 history 列表为空、对应 restore 明确失败。没有悄悄导出旧 history 或新增藏素材容器，也不声称 ZIP 携带原所有 take。

## 实际验证

- desktop 5 文件 31 项通过，1.26 秒，`/tmp/dialogue-split-native-final-tests.log`：完整 snapshot checksum/重启 list+restore、全新 UUID、完整原 take/proof/audio/文件、字段锁与派生审批失效、late edit/take/project/continuity、坏外围行/dup scene、backup fail、snapshot 期间外部新稿 raw CAS、write 前后/旧空错回执、真实 pending 屏障、timestamp-only fresh CAS、主帧/沙箱 ABI、当前稿 ZIP 不含本机历史。
- web 6 文件 40 项通过，4.06 秒，`/tmp/dialogue-split-native-web-tests.log`，含原纯拆镜/旧 duration/旧结构 guard、真实 parser 闭包和 history 客户端回归。与前阶段 37/38 重叠，不累加。
- 正式双端类型、workspace build、最后受影响 desktop build、目标 ESLint/Prettier/diff、shipping contracts CJS builder 与提交后原 contracts check 通过。CJS 实际收录 37 个 public namespace。
- 隔离 app/dist + compiled contracts CJS 真 require：main prepare→原队列完整 snapshot→apply，3 子镜、6 视频估计、原 bytes 保留、fetch 计数 0，无 renderer import/source fallback。日志 `/tmp/dialogue-split-native-isolated-cjs-final.log`。文件夹具用原始字节证明结构/保存，不冒充真实编解码或音画质量验收。

未验证真实会员/付费调用、Electron 正常用户窗口或 UI 结构接受；当前未接可信慢语速超 cap evidence，也不从中文提示倒推 raw/零派发。下一独立切片补真实服务回执链，视频预算仍须重新明确确认。
