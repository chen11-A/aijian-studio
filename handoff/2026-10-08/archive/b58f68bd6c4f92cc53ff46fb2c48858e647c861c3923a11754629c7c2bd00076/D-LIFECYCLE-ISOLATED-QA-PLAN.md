# QA01 D 生命周期静审与后续隔离 QA 门（未运行）

日期：2026-09-28。仅对 MGR04 冻结 `20260928-d-managed-lifecycle-author-candidate-9-1/SNAPSHOT.json` 作只读检查，SHA-256 `6096EFFD8C035C8F442CDE5DE34D48B8365352FB719D6FA1FAFDB3D8A14F7F2B`，九个源文件逐件重算 9/9 匹配。此快照声明 `AUTHOR_CANDIDATE_STATIC_DEPENDENCY_OPEN_NO_C19_SYNC_NO_QA`。本计划与 repo30 独立合成迁移 QA 不互相替代。

## 源身份与静态接线

| 文件 | SHA-256 | 静态观察 |
| --- | --- | --- |
| `product_export_claim.py` | `5806157915962BFB607AC96E571C627BEE48A04350C82A628F096CA704567995` | `replay_existing` 先核同键同请求并读旧 receipt；正式 release profile allowlist 为空，新 claim 在写 ledger 前拒绝。 |
| `product_export_operation_coordinator.py` | `E6A8C912709CB9EA4C4458E785FF41C03D4A41D28D62710236CF68C80411D994` | `claim_only` 与 `execute_claimed` 分开；失败按阶段转 UNKNOWN；定义启动恢复方法。 |
| `product_export_single_video_service.py` | `A241DEBF74F791B808C84FD0BBDD6F5E0C876366E49B84EC9B173CB71028AD30` | 新 claim 建非 daemon worker；旧 receipt 不建 worker；线程启动失败尝试 `WORKER_START_FAILED` UNKNOWN；stop/join 有界。 |
| `product_export_runtime.py` | `294B0A911193B36A2D62D8427D982E210966A6569341DA0D12A5C6057385249E` | 同 sidecar 持一个 Job manager；先旧 receipt，后才发现 toolchain；stop/join 代理 service。 |
| `product_export_operation_routes.py` | `8158A7FD35B32FA492C7393B407DDD1EA6020044B49E5224C3437AE50DFFE9CE` | POST 新单 202/旧终态 200、GET、取消；未知 503 要求先读操作，无自动重发语义。 |
| `main.py` | `ECD229676AB58DCBF569730996C7D2B74CE7CC350D23CDA9505E3046D262947A` | 仅 sidecar security 与 runtime 同在时注册正式 export router。 |
| `sidecar.py` | `03B5EE2E3C80BF3550AA918D4825451CAEADD8FF95BEDF20759F50E8C3FBD4F2` | 第422行于 listener/repository 前占 owner lock；446-452 创建 Job manager/runtime；511→517→523→544 依次 stop accepting、Job shutdown、join workers、锁释放，失败不主动释放。 |
| `product_export_windows_job.py` | `11A5762844F0C79471DFB46719E00ACC0D951A71FAC4E11F9C58202A2DBACFA2` | 进程暂停创建并纳入 kill-on-close Job，管理器追踪、等待活跃成员归零；需 Win32 独立证明。 |
| `product_export_encoder.py` | `6DB31BA0542B074853A5F86833B2719AE2524B02ADCF95A5592DD3FA36EB59B8` | 调用 Job manager 后进行有限进度/输出读取并释放；无真实 ffmpeg/MP4 验证。 |

## 当前唯一整链阻断与 owner

冻结快照明确给出组合缺口：`main.py`/`sidecar.py` 仍导入 B31 `provider_connection_repository`，作者当前 repository SHA `4032F9C2...` 为 schema31；本轮独立迁移包固定的是 repo30 SHA `C2104917...`。**不能把九源整文件与 repo30 直接拼接运行**。需要 DEV05 提供经审的 D-only `main`/`sidecar` overlay，或由 MGR04 冻结并审全套 B31 依赖闭包与同源 repository，再固定真正可执行的隔离包。`product_export_claim.py` 已在九源快照中定为 `58061579...`，未来若改变须重新审本门。MGR04 管理冻结与组合，DEV05 拥有 main/sidecar 接线，DEV08 拥有 claim/coordinator/service；QA01 不改产品源。

另有一项可定位的完整产品启动门缺口：coordinator 第69-75行定义 `recover_interrupted_at_startup()`，但冻结九源的 sidecar/runtime/main 没有调用。**不能据此立即接到 ready 前。**旧运行的归属和孤儿 encoder 退出尚未证明；此时把 CLAIMED/RUNNING 改 UNKNOWN 并开放新 sidecar，可能让旧进程仍写输出。需要 CTL/MGR04 先确认旧 Job/进程退出的可验证条件及 UNKNOWN 不自动重试策略，DEV05 再按获审接线；此前保持启动恢复/正式新接单关闭。QA 对该门的隔离旧 receipt 回读另行审签。

## 组合定版后待审签的最小 local/mock 包

| 用例 | 输入与动作 | 通过门与证据 |
| --- | --- | --- |
| 同 workspace 双 sidecar | 全新独立 profile，A 正常启动并回读 handshake；B 指向相同数据库路径启动一次；A 正常关闭后 C 再启动一次。 | B 在任何 listener/repository/ready 前仅 stderr 完整 `AIVORA_STARTUP_WORKSPACE_BUSY` 并 exit73；A 仍可 GET；B 不改 DB；C 可取得锁。记录 A/B/C PID、端口、handshake、raw、DB backup/hash；全部正常关闭并核无残留。 |
| unsafe 与启动异常 | 独立 profile 逐个相对路径、错误 DB 名、UNC/符号链接路径；可控 mock 注入 listener/repository 失败及 stop/join 失败。 | unsafe 无握手/监听/DB 写；正常启动异常清理已启动资源。stop/join 失败时源码不能主动释放 owner，且要证明没有活的 Job 子进程越过锁释放。进程退出本身会让 OS 释放锁，因此“异常保锁”只指进程仍存活时的有序停序，不宣称进程退出后永久保锁。 |
| Job/worker 停序 | 只启动本地良性 helper 的受控 Job 子进程或无编码 mock；触发父 sidecar 正常/异常关闭。 | 先 `stop_accepting`，Job `ActiveProcesses=0`，再 worker `join`，最后 owner release；PID/handle/时间戳与原始输出留证。不调用真实 ffmpeg、MLT、provider。 |
| 正式空许可与旧回放 | schema30 隔离副本，冻结且独立构造旧 operation receipt；相同 project+operation+请求 POST，再以变更请求 POST；新 operation POST。 | 旧精确回放 200 且不发现工具、不新建 worker/ledger；不同请求 409；空 release allowlist 的新请求被拒并保持 ledger/spawn 数量 0。旧 UNKNOWN 不重调度。 |
| 新 claim 与线程故障 | 只有在正式 release 许可经独立批准后才可做真实 claim；在此前仅用受控 service/mock + 隔离 DB 验证 worker.start 注错、claim 后执行异常、取消、重复同键并发。 | claim 后线程启动失败写 UNKNOWN；一键只一个 worker；GET 返回明确终态或 UNKNOWN；cancel 先停进程后可确定取消；不自动重试。mock 结果仅为本地逻辑，不作为正式输出证明。 |
| 启动恢复 | 仅在证明旧 Job/encoder 全部退出及 CTL 审核 UNKNOWN 策略后，人工构造隔离的 CLAIMED/RUNNING 合法 receipt，启动新 sidecar，不运行 encoder。 | 在已证无旧进程前提下先转 UNKNOWN、GET 读回，再开放 listener；同键 POST 仅旧 receipt，不新调度。当前九源缺接线且孤儿条件未证，此用例保持关闭。 |

运行封套须固定同源快照、依赖全闭包、Python/Node 解释器及每份脚本 SHA；每个用例单独新 profile、原 DB/backup SHA、请求/响应 raw、PID/退出/清理状态。仅按 MGR02 已签范围逐项执行，失败保留 raw 并停止，不以截图、静态接口或本地 mock 声称 Win32 Job、原生 Electron、用户 DB 或可播放 MP4 验收。此计划尚无可执行封套，因为上述组合缺口未闭合；启动恢复还须单独解决旧进程退出门。
