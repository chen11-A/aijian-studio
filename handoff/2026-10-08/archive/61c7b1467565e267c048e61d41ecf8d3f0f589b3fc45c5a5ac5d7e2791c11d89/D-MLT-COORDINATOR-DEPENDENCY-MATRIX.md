# D/MLT 工程 TEST 与正式导出依赖矩阵（QA01 静审）

日期：2026-09-28。只读静审，没有向 c19 同步 D 文件、import 作者模块、运行 MLT、创建正式 export operation 或调用 provider。以受保护快照为界，不把作者活动树当固定闭包。

## 固定证据

- D 四源码快照 `20260928-d-mlt-plan-adapter-worker-4-2/SNAPSHOT.json` SHA `5CB4BFD691A4E24C0D3E3E672EBC10D7011BAE90A2385DCF3ABAB98FFE715719`，状态 `AUTHOR_SOURCE_FROZEN_DEPENDENCY_OPEN_NO_C19_SYNC_NO_QA`。四件分别为 execution contracts `3499EFFC…1B3A45B2`、script/assembly mapper `6E7DFC0D…756F1`、MLT adapter `318E7DC9…1269AD`、MLT worker `1B262570…51E8FC30C`；快照明确四件 c19 基线均不存在。
- 正式 product coordinator 候选快照 `20260928-d-product-export-coordinator-candidate-1/SNAPSHOT.json` SHA `7656B764A73D0B55E687FA56A260F3F3ACDFE1E1E0B79469E6EAAA41EA9F68C9`，候选文件 SHA `696754FFADE0FEA4235E28FD131DF9D6DAB6AE40A49C104A3A58E3F3057E3D09`，未同步 c19。其依赖审计 `20260928-d-product-export-coordinator-dependency-audit-1/DEPENDENCY-AUDIT.json` SHA `D4878F7ACC489742EF8F4DF837543871AEFDECB5A50E6DB39CDF7CDCECB5840C`，仅 direct/first-layer 17 件，递归闭包未结。
- ART04 工程规格 SHA `4323DFEF…DDF16D`；QA02 五输入清单 SHA `EE2166D3…B04E3`，QA01 五件字节与 SRT 独立审计 SHA `C980A856…261C5E`；TEST 身份新进程 GET-only 收据 SHA `67E4DAD9…8B4D32E`。五件真实字节、两字幕与 TEST script ID 已固定，但这些文件尚无四个被选定 AssetVersion/权利/探测收据。
- 正式 A 旧历史兼容 TestClient 新态及跨进程 GET-only 局部 QA 已有独立证据；不等于 D 工程或正式 export 验收。workspace owner lock 单文件快照 SHA `B8ACA815…921E6`、源码 SHA `94F62129…410F6`，尚未接入 c19 sidecar。

## 依赖与目标

| 关口 | 工程 TEST 目标及现状 | 正式产品导出目标及现状 |
| --- | --- | --- |
| 剧本身份/字幕 | 已有 TEST project/显式 episode/两个 `OFF_SCREEN` block，新进程 GET 与 SRT 两句一致。mapper 对原数据库 `content_json`、原 `content_hash`、项目/episode/两个 block 再核；入口须读取受信真实版本。 | 正式剧本与人工确认/上游来源另有门；合成 TEST 版本不能代替正式作品。 |
| 五份输入 | 五件字节已冻。mapper 的 `FrozenEngineeringTestBindingsV1` 仍需四个**真实导入** `asset_id+asset_version_id`、每件 SHA/字节、视频 probe、音频 inspection。当前清单只含文件路径/哈希，不能据此造 AssetVersion。 | claim/render plan 必须使用产品所选版本与发行放行边界；工程清单不是正式 selected source。 |
| 权利与探测 | mapper/adapter 明确要求四件 `rights_status=CLEARED`、确切 `rights_decision_id`；视频对应 probe evidence/hash，音频独立 inspection SHA。权利决定、选定版本、受信 reader、收据绑定尚未提供。 | product claim 也依赖相应权利、probe、selected reader 与 release gate；candidate dependency audit 指向 rights store、probe store、selected reader，均不在 c19 当前闭包。 |
| 执行计划与 XML | D mapper 是纯映射，不能自行读取 QA manifest/资产/权利；adapter 以可信 `resolve_selected` 再核每件托管文件、manifest、字幕、工具 SHA，生成 125帧/25fps XML 与 profile。四源码只是静态快照，c19 未接入，不能在当前 c19 直接 import。 | coordinator 仅接受持久 `SINGLE_VERIFIED_VIDEO` 计划，明确拒绝 MLT 计划；工程 XML/worker 不可作为正式 executor 替换。 |
| MLT 与声画 | worker 需要 REL02 审过的完整 `melt` 可执行文件、模块目录/插件及版本/服务清单，且现场 SHA 与锁一致；目前无获批 MLT runtime/许可安装回执。五输入只是源，未生成或验证 XML、MP4、混音、字幕、25帧叠化。worker 返回仅内存 `MltExecutionEvidence`。 | 正式路径需单视频 executor 实现、注册、可验证 MP4 及持久输出收据；coordinator 的 `SingleVideoExecutor` 目前只有 Protocol，未有受保护实现/路由/启动接线。 |
| operation / 幂等 / 恢复 | 工程 worker 的 `operation_id` 只限定独占 job 目录；没有 product schema28 claim/不可变收据、重启恢复、并发 winner 与取消仲裁。不能称持久 operation。 | coordinator 候选调用 schema28 claim/store、同键回旧收据、执行前标 RUNNING、取消信号与 UNKNOWN，但 c19 repository 仍 schema26；schema28/31 的有序迁移、依赖完整闭包、路由/启动接线及真实 executor 未结。`recover_interrupted_at_startup()` 要求无活 worker 且须由宿主调用；workspace 独占锁尚未集成。并发 claim、取消竞态、commit 未知、finalize 前后异常均未做独立运行 QA。 |
| 当前可执行性 | **WAITING**：先固定四 AssetVersion/权利/probe/inspection 与可信选择、完整 D 依赖与隔离目标，再审 MLT runtime；之后才能计划外置工程 TEST 一次运行。现有数据仅支持静态计划审查与输入字节核对。 | **WAITING**：先冻结 coordinator 完整递归依赖及版本化迁移/宿主接线/正式 executor，再隔离库测持久幂等、取消、恢复；工程 TEST 通过也不会自动放行正式导出。 |

## 静审发现与验收边界

1. `build_art04_synthetic_execution_plan()` 的注释明确它只比较调用方传入的身份和内容，**不读取** QA manifest、资产库、权利或工具；不能把五输入清单通过等同于 `FrozenEngineeringTestBindingsV1` 合格。当前缺的主要不是第六个媒体文件，而是四个已选定且可追溯的产品资产/权利/探测身份。
2. adapter 对五输入目录、manifest、工具 SHA、selected file 做再次核验；`materialize_mlt_engineering_task()` 写独占 job 目录，worker 要求批准 MLT 模块服务并验证 MP4，但没有持久工程 operation 收据。无获批 runtime 时，即使 XML 静态生成也不能报 MLT 合成通过。
3. coordinator 候选限定单视频计划；静态检查见 `get/request_cancel/recover_interrupted_at_startup/submit_and_execute` 入口，但快照承认 main/startup/executor 未注册。它是正式产品路径候选，不能把工程 MLT worker 接进去当作正式执行器。其依赖审计当前只列 17 件首层，产品 schema31 与 c19 schema26 组合未定；不应以单文件 import/局部脚本成功推定持久重启安全。
4. 独立 workspace owner lock 来源只有合作 sidecar 排他能力；作者接线新 SHA `B95B9C4E…B35AD` 尚未成受保护集成闭包。锁也不证明崩溃前编码器子进程已退出。正式 startup 恢复须在锁、worker 退出/探活与 UNKNOWN 规则同一隔离门中验证。

下一次可审的最小材料：工程侧四个导入 AssetVersion 与权利/视频 probe/音频 inspection 的确切 ID/哈希及受信 reader、五输入 manifest、受保护 D 四件和完整依赖清单、REL02 MLT runtime 锁与安装目录哈希；正式侧完整 coordinator 依赖/迁移顺序、宿主接线、executor 实现及隔离持久竞态测试计划。当前矩阵不授权同步或执行。
