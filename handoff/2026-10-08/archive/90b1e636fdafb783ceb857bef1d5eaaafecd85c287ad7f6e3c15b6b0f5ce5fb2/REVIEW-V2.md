# core154 reader 物理复制：v2 静态复审包

状态：`STATIC_PREPARED_NO_COPY_NO_IMPORT`。MGR02 指出的旧启动器无界双流读取、等待及环境继承问题已修订。旧控制目录 `qa02-core154-reader-copy-control-20260929` 的 launcher、packet、PRE 原样保留为 draft；**当前有效候选是本 v2 目录**。本目录无 `GRANT.json`、`ATTEMPT-USED.json`、`run-01`、`launch-01`，目标包仍不存在。

| v2 文件 | SHA256 |
| --- | --- |
| `PACKET.json` | `E100EB599140B5C51D0C52BB50564FF8BFDF6CC695300DF9E4975875B7278B69` |
| `copy_once.py`，与旧候选完全相同 | `51D5DBDDEF7A38B8BC00F21114414FDBB15694B1A462A1AB28EB6EA603BF37EA` |
| `launch_once.ps1` | `FE9898D692F9B8016C43DD1CB6D470615F43FE5D9DBBBACBBF14DDE938293830` |
| `PRE.json` | `595EC58F3521F57ABD0485D2FCA03098BF0B20E84FF63B0961CEF56EAB6A72AD` |
| `STATIC-HASH-PROBE.json` | `65B48528DA49996F166D0682C98EB81194D29C5837FA7705F4EE8995321B74AB` |
| `static_hash_probe.ps1` | `728330749EB1DFF799DF384DBA7F9A784EA398CED5B63984838053B9635F8063` |

## 启动边界

- 子进程清空继承环境，只传 `SYSTEMROOT,WINDIR,USERPROFILE,APPDATA,LOCALAPPDATA,TEMP,TMP,HOME` 八键；五个 profile 目录预建，profile 中四个子目录、零文件、零链接，启动器另查 profile 根和各目录不是重解析点。`-I -B` 固定 Python，隐藏窗口。
- 启动器先运行 30 秒上限的净化哈希探针，回读 runner 消费者 SHA、八个实际环境键、隔离标志和 profile；再运行单次复制，120 秒上限。双流异步读取；超时 `Kill(true)` 杀子树，后续进程和双流各作有界等待，记录超时、kill 错误、流是否完整及可取得的原始输出。绝不自动重启。
- 只要 `GRANT.json` 存在，启动器就在任何 packet/输入预检前用独占新建 `ATTEMPT-USED.json` 消耗单次尝试。启动前异常由 `LAUNCH-RED-STOP.json` 或 `launch-01/EXIT.json` 保存原始异常；下一次启动因标记存在而停止。运行后 `launch-01` 保存哈希探针原始 stdout/stderr 与摘要、`PREPARED.json`、复制 stdout/stderr 和 `EXIT.json`。
- runner 产品逻辑与旧候选字节完全相同；它仍完整回读复制前源 154、复制后源 154 和目标 154，并拒绝额外文件、`.pth`、重解析点及哈希/字节差异。仅承诺物理复制回读，不承诺 `__file__` 或 reader 行为。

## 静态证据与预算

固定输入仍是 QA01 core153 实体包的 153 文件，以及 Resolver54 冻结 reader 的 1 文件。`PROPOSAL.json` SHA `D4E2D1650F05B027FD6C625F9A701E7AE8C1AA404DCA225AC787F597F9672E37`；core153 manifest SHA `262C485F782D7B685DDD3D32ECF190DD2DF5B2E6008D9644EF0F6EAFD25E0E64`；Resolver54 `FILES.json` SHA `FB7B477C6BC5EEAF6DCA4D1A970275062ED658C0EFF6F3998AE1D73D9A537B72`；reader SHA `BF38C626440888D474872C8C7E6093EC96F41B0211A66EAE1870A8B6D52EE676`。

目标仍为 `C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\native-source-qa-20260924\qa02-core154-reader-copy-20260929\qa-physical-package`，预算 154 个 `.py` 文件、1,901,633 字节、一个 `aijian_api` 子目录，最长目标路径 233 字符。单次记录只写本 v2 目录的 `run-01`、`launch-01`、`ATTEMPT-USED.json`，异常可能增加 `RED-STOP.json` 或 `LAUNCH-RED-STOP.json`；不会写原 core153/c19/作者树或数据库。

Python AST 检查 154 个源文件和 runner 通过；v2 启动器及静态探针 PowerShell 解析错误各 0。净化探针在独立隐藏 Python 进程中通过：实际环境恰为八键，runner SHA 匹配，profile 探针前后均四个子目录、零文件/链接，目标和 grant 均不存在。此探针没有调用复制 runner 或导入产品。

## 复审和单次授权

MGR01 复审范围后，MGR02 如授权，须给当前 v2 包单次 `GRANT.json`，至少绑定：`status=APPROVED_SINGLE_RUN`、`approval_id=MGR02-CORE154-READER-COPY-20260929-01`、`mgr01_scope_reviewed=true`、`clean_environment_approved=true`，及上表当前 packet、runner、launcher 三个 SHA。旧 draft 的 packet/launcher SHA 不能用于本候选。首次 RED 保留原始记录并停止，不重试；reader 导入/行为门禁另签。
