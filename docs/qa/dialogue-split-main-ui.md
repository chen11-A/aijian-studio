# 完整句拆镜：真实主进程审核与接受入口

基线 `93e96f9`，已合入可信超限 consumer `1ce801d`。本片接真实 Pro 单镜助手及剪辑页“查看完整句拆镜方案”，不生成配音、图片或视频。正常 Chrome 拆镜专项门另排；本文件的 jsdom/FS 验证不冒充 Electron、解码或听感验收。

## 用户流程与事实

- 本机返回完整原台词、每个完整句子镜、估计时长、`parts × versions` 视频数及全部 notes/limitations。视频数不含配音、图片或重试；默认未勾选，关闭或只查看不接受结构。
- 必须明确勾选并点击“接受这份拆镜结构”。实际调用 main 的 prepare/apply；没有把 renderer 离线预估当主进程审核，也没有循环生成。成功后仍需逐镜检查、重新确认后续生成数量。
- `actualLimit` 仅来自已冻结 session helper + main live registry；显示“本次目标”的真实配音需求/上限及未提交目标视频事实，与子镜的文字估计分开。opaque evidence ID 不进工程、历史或工程包。
- 原镜全部版本在本机强制历史保留，素材文件不删。新镜不继承旧 take/首帧/七段审批等派生状态；原 audioClips 完整保留原 ID/绑定，全片时点不自动重排。工程包不包含本机历史，不能用 ZIP 冒充原版可恢复证明。

## 保存、完整 delta 与未知结果

查看只短暂使用原队列保存当前稿并读完整 raw hash，native 读取与人工审核不持 owner。仅 savedAt/directory 的普通保存不重置创作检查；prepare 遇到已证明仅元数据变化时最多重读一次，完整 CAS 从未省略。

`FilmSaveLease.save` 只补返回现 enqueue 已完成的 stored 回执，不增保存、不改锁/退出状态；旧调用可忽略，旧 void mock 类型仍兼容。新 preflight 没有真实 receipt 立即拒绝；完整 write receipt 与 raw 一致后才采用实际物化的媒体。`film/library.saveFilm` 已有的 assemblyUrl 还原差异按已知规则精确处理，不泛滤创作字段。错误/迟到 readback、选版或源变化零 prepare，保留后来编辑。Pipeline 的既有 void lease 消费者用最小忽略返回适配，不改执行协议。

结构投影只保留一份纯 JS 实现，置于已有 contracts runtime namespace，main 生成新 UUID 后委托；renderer 只用它核对 fresh raw 全事务。子镜 ID 必须全新且唯一，句界/偏移、同场镜号、外围字段、cache 清理及全部原音轨都完整对比；唯一持久例外为 writeProject 定义的 savedAt，directory 不滤。伪造 child/source、缺/额外字段都不作为部分成功。

新增只读 `verifyFilmDialogueSplitBackup({projectId,historyId,beforeHash})`：合法 input 先过同 factory active gate；main 用真实历史 snapshot reader 校验路径、project/series、checksum、reason 与**原完整 raw hash**。不 restore、不写、不返回快照/路径。APPLIED ACK 也必须同时通过完整 delta 与这个真实备份验证，splitSource/history summary 自身不是权限或备份存在证明。

传输未知进入常驻“拆镜保存待核对”面板，仍共用原 external queue、readOpeningFilm 保稿与 quit unknown，不自动重发 apply。完整结构+backup+二次 fresh raw 才能确认；后来编辑/选版冲突留两份，明确选择“采用已核对的拆镜版并放弃这份保留稿”前不覆盖。换作品后核对原作品不 apply/write 当前作品。每次 async hash 后最终 current/draft 核对、apply 与 confirm 同步执行，confirm false 不清 pending。

丢 ACK 且 main 实际未写：只有 fresh READY，或合法原 scope 经同 factory gate 后的固定 PROJECT_CHANGED，配合两次完整 exact-before raw，才能核对仍是原结构。INVALID_INPUT/任意 failure 不算生命周期证明；fake registry clock 过期也可完成核对，不靠 sleep 或自动再接受。确有结构变化时仍完整验证 delta+backup，不走这个未写分支。

native 已确认后 release 保存后来编辑失败属于普通 failed save，保留失败队列/退出保护，不制造无来源的 unknown。

## 实测与复跑

- Desktop 5 文件 59 项通过：原 consumer/history/backup/CAS、只读实际 snapshot 验证（错/缺/跨项目/series/reason/完整 beforeHash/篡改后重算 checksum）、真实在途 BUSY与新 ID/完整投影。`/tmp/dialogue-split-ui-native-final.log`。
- Web 最终联合 15 文件 142 项通过：新真实 Pro/native/FS 29 项、dialog 5、queue 8，及原 manual/group、history、quit、save、video-review、pipeline、rules。`/tmp/dialogue-split-ui-joint-final.log`。
- 两个真实微任务守卫受控移除时 2 项失败；恢复后通过。`/tmp/dialogue-split-ui-microtask-before.log`；最终联合包含两项，临时移除已还原。
- 官方双端类型/生产 build、目标 ESLint/Prettier/diff 校验；隔离 compiled desktop + shipping contracts CJS 真 require 37 namespace，prepare→3 子镜/6 视频估计→原子接受→实际备份验证，原文件 bytes 保留、fetch=0。`/tmp/dialogue-split-ui-runtime-final.log`。

未验证真实会员、供应商调用、真实 TTS/音画质量或正常 Electron 窗口。本机 Chrome 沙箱限制未绕过；新增拆镜浏览器专项与旧正常 Chrome 矩阵需集成源另验。
