# QA02｜D 快照 Windows Job Manager 单次局部运行结果

2026-09-28，按 MGR02 唯一批准 `MGR02-QA02-WINDOWS-JOB-MANAGER-LOCAL-ONCE-APPROVAL.json` SHA256 `B1CBC4FCFBAB983FB5829A57ADC072FDD857CD5E078D21B42BCE8CFCCC816434` 执行一次。批准输入：计划 SHA256 `89647037EBD76555805BD48F459A64821436479BCC1CD93035DE61558B75FD05`；Python 脚本 `38F7F8CA7E2C7E2434ADBFA28DCF7D713BB6BF935C40D138F452C7A51C2C82C1`；Node 包装器 `10D38485E2D734E2585B4BD45035A7F73B810516F8CAAE2F596FA77A658BD73F`；快照/SOURCE/Job 实体分别 `839074A0F355D42E5AAC2E309184524E10F90C14817EDECB544FC1AE7B6A6CA4`、`8879C124F5F722A734AF185C37B31AA6A4409EE6A8F9ED4B58C4F151D6CCDA9D`、`11A5762844F0C79471DFB46719E00ACC0D951A71FAC4E11F9C58202A2DBACFA2`。运行前目标目录均不存在；没有重试。

## 原始回执

- 外层目录：`C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\native-source-qa-20260924\windows-job-manager-local-invocations\qa02-windows-job-manager-local-01`。`intent.json` SHA256 `041AF4E83626FC3DE27F2410282F999E5124D5FCBE11C11FC7A2134F042C6853`；`receipt.json` SHA256 `508AA006B892A280CFAB35C93D7E15485C7372C248888B9CC90E5BB36AD45DC4`。亲自启动的 Python PID 13484，exit 0，无 spawnError/signal；40 秒超时未触发，`closeObserved=true`、`rawFinal=true`；外层 stdout/stderr 均 0 B、SHA256 `E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855`。
- 内层目录：`C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\native-source-qa-20260924\windows-job-manager-local-runs\qa02-windows-job-manager-local-01`。`intent.json` SHA256 `739BCF9C03F699E5DB14479BACFE13114EE58FF14CC744F1ED244C57CF91DCB6`；`receipt.json` SHA256 `A369A964410C8292E5865F8A4001244219C240D8CD05FFC3A1B18EA62EB020C6`，状态 `LOCAL_SELF_OWNED_JOB_MANAGER_CASES_PASS_NO_PRODUCT_INTEGRATION`。这是一份局部测试收据，不是整合/产品验收。

## 局部判据回读

| 项目 | 实际证据 |
| --- | --- |
| 失败拒启动 | 相对路径报 `ProductExportJobError: Invalid Windows export process inputs`；外置无效 exe 报 `[Errno 216] Cannot create job-bound export process`。两次 manager owned count 0、`_uncertain=true`，没有返回受管进程。 |
| 自然退出 | 自建 helper PID 7360；确切句柄 `IsProcessInJob=true`、ActiveProcesses=1；foreign manager release 被拒；exit/postCloseReturncode 均 0；owner release 后 owned 0、Job 与进程句柄关闭、reader 结束且无错误，manager 非 uncertain；后续 shutdown 后新 spawn 被拒。`child-exit.stdout.raw` 22 B，逐字 `QA02_SELF_OWNED_EXIT\r\n`，SHA256 `528531CD9E4C8AF0F42E132EADCA67B6A884DBE8BDD947C47DBA63DBFCD7C65B`，stderr 空。 |
| shutdown 等待 | 自建 helper PID 3828；确切句柄 `IsProcessInJob=true`、ActiveProcesses=1；`shutdown_and_wait` 返回，`_closing=true/_uncertain=false`；exit/postCloseReturncode 均 1；owner release 后 owned 0、Job 与进程句柄关闭、reader 结束且无错误。stdout/stderr 均为 0 B；终止可能发生在 Python helper 打印固定标志前。因此只证明进程归属及 shutdown 的终止/等待，不证明 helper 业务体已经运行。 |
| 运行后清理 | 只读查询本轮确切 PID 13484/7360/3828 均未存在；按本次脚本绝对路径筛选的 Python 进程为 0。没有终止其他进程。 |

运行后再次读到 c19 HEAD `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`、`git status --short` 110 项，与本次运行前相同；冻结 Job 实体 SHA 仍为 `11A576…ACFA2`。本轮只运行外置自建 Python helper，不调用用户数据库、真实 encoder、MLT、网络或 provider。

**验收边界**：只证明冻结 D 快照 Job Manager 对单个自建 Python helper 的这些路径。未测并发/多 Job、spawn 与 shutdown 竞争、注入式 WinAPI 失败、后代进程、sidecar 绑定与 workspace owner lock、旧孤儿、真实编码及启动恢复；D 整合仍待其各自的同源集成与 QA 门。
