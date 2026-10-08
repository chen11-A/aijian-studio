# QA01：DEV06 rights 链负面隔离门（待 MGR02 单签）

日期：2026-09-28。状态 `PREPARED_NOT_RUN`。本门只使用固定 c19 QA Python 对 AE937 54 件包的明文消费视图，在全新外部 SQLite 副本上核 assembly rights 链的空链、孤儿 head、跨资产 ASV 和缺 ASV 拒绝。不调用 public route、sidecar、provider、FFmpeg/MLT，不读取媒体 blob，不写 c19 或用户 DB；不造人工 CLEARED/RESTRICTED 身份。旧 D/repo30 与历史 Resolver54 的既有证据按原字节保留。

## 固定输入、双视图与许可

| 项 | 固定身份 |
| --- | --- |
| QA 消费者 | `C:\Users\Administrator\.codex\worktrees\c19-trim-211c9e8-qa-20260923\.venv\Scripts\python.exe` SHA-256 `461D6E5F9A0DCB724798D2B6DBD57555A9EB3084522CC5DC5B2347934F5A4060`，必须以 `-I -B` 运行。 |
| DEV06 54 件目标 | `C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\dev06-resolver54-rights-chain-closure-20260928-v2\MANIFEST.json` SHA-256 `AE9379444336873DDF94D5A5DD92A0A7C851671BB1BCCF90D51C70889BD15595`。消费者 `read_bytes()` 在加载前、import 后、每例后按 manifest 对 54 件逐项重算；已加载 `aijian_api.*.__file__` 必须全在此固定源目录且 SHA 匹配，不允许作者树 fallback。 |
| 独立长度基线 | 同目录 `DEV06-RESOLVER54-V2-BYTE-LENGTHS.json` SHA-256 `A6145E0FCB9141D1199FC606EDA65F2AFA54EDF9D06C542BB84A434043117BA5`：53 件取历史 Resolver54 冻结原路径，assembly 新件取哈希固定的 DEV06 作者原路径，分别以 PowerShell 回读 SHA 与字节数；逐项与固定 Python 消费视图的 SHA/长度相同。原 manifest 仅含 SHA，不含长度；运行器显式核此独立长度清单及实际 `read_bytes()` 的长度和 SHA。该基线不复制源码。 |
| 物理读取视图 | 同一路径 [双视图回执](C:/Users/Administrator/Documents/Codex/2026-09-23/aivora-git-c-users-administrator-documents/work/qa01-mlt-20260928/DEV06-RESOLVER54-V2-DUAL-VIEW-READBACK.json) SHA-256 `BAAE3FDAE7F06950D250DB96934D8FAC98D0EDF65DD710DBBCB9A1BC47FA3233`：PowerShell/.NET 1/54 匹配、53 件 E-SafeNet 原始视图；固定 Python 54/54 明文匹配。两视图并列保留，PowerShell hash 不冒充运行源码 hash。不变更加密策略，不移动/复制源包。 |
| 只读 QA 输入 DB | QA02 r04 的 `profile-04\workspace\workspace.sqlite3` SHA-256 `65EF2306FD83CFDAA454754A3B6A6E1919431F1C570826ABC37E93A6795A11FC`、空 WAL、schema30；已有 4 个 QA ASV、零 rights decisions。每例由 SQLite backup 建独立新库，源库前后 SHA 必须一致。未复制媒体文件。 |
| 一次运行器 | 同目录 `verify-dev06-rights-negative-once.py` SHA-256 `141B9E0570A22B98E2B54DB4EF480B3A933486697D34894FDC434864593CC8E8`；仅 AST 静态检查，尚未执行门。 |
| 输出 | 同目录 `dev06-rights-negative-01`，运行前必须不存在。 |

MGR02 若签此门，须按同目录 `DEV06-RIGHTS-NEGATIVE-APPROVAL-REQUEST.json` 的固定字段创建独立 `DEV06-RIGHTS-NEGATIVE-ONE-SHOT-APPROVAL.json`。请求文件不是批准。运行器在任何产品 import、输出目录或 DB 副本创建前核解释器路径/哈希/flags、54 件明文视图**逐项长度与 SHA**、固定 DB 与空 WAL、审批字段和新目录。批准后只运行一次：

```powershell
& 'C:\Users\Administrator\.codex\worktrees\c19-trim-211c9e8-qa-20260923\.venv\Scripts\python.exe' -I -B 'C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\qa01-mlt-20260928\verify-dev06-rights-negative-once.py'
```

## 顺序与首 RED

1. 空链：固定 QA ASV 没有任何 human rights decision；调用目标包 `_collect_checks(..., writing=False)`，期望 rights `PENDING_REVIEW`、decision id 为 null。旧列恰好也为 PENDING，本例不能单独证明旧列被忽略；媒体可用性单独记录，不计本门正例。
2. 损坏链：仅在第二个隔离副本插入孤儿 rights head，**不造 human decision**；目标 `create_version` 和 `_collect_checks(..., writing=False)` 都须返回 `RIGHTS_CHAIN_INVALID`，assembly artifact 仍为零。
3. 跨资产与缺 ASV：各用新的隔离副本，以资产 A 配资产 B 的 ASV、以及不存在的 ASV 调用 `create_version`，均须 `ASSET_VERSION_NOT_FOUND`，且无 artifact。此例证明媒体引用 scope；不声称已测试真实 rights 跨版本历史。
4. 每例后重算 54 源哈希、核加载模块 `__file__`；源树恰有清单 54 个 `.py` 且无预存 `.pyc`；末尾核原 QA02 DB 不变。仅所有负面断言成立才可标 `PASS_ISOLATED_RIGHTS_NEGATIVES_ONLY`。

首个 RED 条件包括审批/脚本/解释器/源/DB 漂移、双视图下消费者读不到 manifest 字节、任何 `aijian_api` 模块来自作者树或清单外、schema 非 30、QA 输入出现 rights decision、错误码/数量不符、异常创建 artifact、源库变化。保留 `RESULT.json` 的原始异常和堆栈，停止且不重跑。若预检失败，输出目录尚未创建，外部命令 raw stderr/exit 是首 RED 证据。

当前 QA 工作根下 46 个 SQLite 文件只读检索均无 rights decision。**人工 CLEARED→RESTRICTED、合法链中的 revision/previous/asset SHA 损坏以及 public GET/POST 映射均 `NOT_RUN_NO_APPROVED_SEED_OR_ROUTE`**，须获授权真实人类决定 seed、固定 SHA 与独立门；本门结果不能替代。产品/DB 与最终 D 合包未验收。
