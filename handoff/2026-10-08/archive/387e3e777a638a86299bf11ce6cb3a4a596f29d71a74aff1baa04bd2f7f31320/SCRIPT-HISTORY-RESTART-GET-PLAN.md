# EpisodeScript 旧历史与新 OFF_SCREEN 跨进程 GET-only 门

日期：2026-09-28。供 MGR02 静态审门，尚未运行。此门只验证旧 ACTION、旧缺 delivery 的 DIALOGUE、及正式新 `OFF_SCREEN` DIALOGUE 在**全新 Python/FastAPI 进程**下按精确版本和最新版本读取；不再发 POST，不改变产品源码或用户库。

## 输入与隔离副本

- 唯一状态源为已在线备份的完整新态 `C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\qa01-mlt-20260928\script-compat-old-seed-01\new-state-preserved.sqlite3`，SHA `5893D5F3B6EFEE66C80B9C25043CBDFF2239B5EEA906C7C852DD0A5D42FBB819`。它是主库+WAL已提交逻辑态的独立 SQLite 文件；脚本用 `mode=ro` 先核项目/episode内 3 个剧本版本、3 条写入收据、`integrity_check=ok`、FK 空，不用原 WAL 库。
- 原旧基线 `baseline.json` SHA `8E2D100B024F7D4C58EA2945AD59F44687D374DB4326E7F50E14BB093AB15348`、旧行 `old-DB-ROWS.json` SHA `7F908FB868EF87AEF2E2A142C470CD55FEE508D80EEED07D41524EBC6B01C0C5`、新阶段 `new-HTTP.json` SHA `1DBE35E231F76B25D7D9B969714825E573F0CC246ED7BF37FDB605A4C636EB4D`、`new-result.json` SHA `175517CF3E56971CA947ECA8F2D0311C8D77F3C5AD2563C37BD257AD86E892AD`。脚本逐一核指纹后从原201响应提取三个版本 ID、原 content/hash。
- c19 正式合同 SHA `0028DB1DB4F2EC9C488E8E58F41BA361EF373E3CFD9617DCD4372C4648E25426`、store SHA `CD58D0B0F7CE6B1CEAB32D233544246B67A14722F84E4FBD8ACB54C4C651A65E`、sidecar route SHA `931D14F8B3D3069ED89E224C6BF4EBF2EE4CA9CA34DAFC9A6415CD2E1B3B8770`，入场核 SHA。
- 新证据目录 `...\qa01-mlt-20260928\script-history-restart-01` 必须不存在。脚本只将上列独立备份**复制**到该目录的 `workspace.sqlite3`，并将复制品交给真实 `create_app`/`StudioRepository`/`TestClient`；保留源备份只读，末尾再次核源 SHA。TestClient 为全新 Python 进程和隔离 DB 副本，非 Electron/sidecar 宿主 UI。

## GET 与判定

1. 对三个版本分别 `GET /api/v1/projects/{project}/episodes/{episode}/script/versions/{version}`；再 GET 最新剧本。四次均须 HTTP 200，原始响应逐步保存并记录 SHA/ETag。没有写请求分支。
2. 与旧201/新201中相应版本相比，字段集合、JSON 类型、数组顺序和值严格一致；对象键顺序忽略，缺键与显式 null 不合并。`head_revision` 单独要求当前值3；不可变 version ID、版本号、原 content 和原 `content_hash` 均保持。三个 exact GET 的 ETag 各等于对应内容 hash；latest GET 的 ETag 为 `"revision-3"`。最新读取等于新 `OFF_SCREEN` 版本（当前head3）。
3. 源独立备份 3 版/3 收据、内容 JSON/hash 与原201版本一一吻合，完整性与外键无误；源备份运行后 SHA 不变。成功输出 `RESULT.json`，wrapper 留 Python PID/exit/stdout/stderr 原字节与 SHA。任一步失败保留当前 raw，停止且不重跑。

入口为 `node verify-script-history-restart-once.mjs`。新目录及 wrapper 输出必须事前不存在。原旧阶段 exit1、新阶段主库 WAL 状态、TEST 身份首 runner exit1 均不因本门改写。此门只可称局部 API/SQLite 跨进程读回，不能称 provider、MLT、原生 Electron 或正式作品验收。
