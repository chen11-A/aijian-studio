# EpisodeScript 正式兼容二源新阶段一次执行计划

日期：2026-09-28。本计划只供 MGR02 静态回读，**尚未批准执行**。需先取得 MGR04 将正式 `episode_script_contracts.py` 与 `episode_script_store.py` 成对同步 c19 的回执，再单独获新阶段窗口。

## 输入、隔离与失败停止

- 测试数据库仍为旧种子隔离目录 `C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\qa01-mlt-20260928\script-compat-old-seed-01\workspace.sqlite3`，入场 SHA `411DCCC6603A8B3CAAF4C8E5A0872CF6F518C7FEFFC341F9CE378DAF6CF4AD18`。原旧阶段 exit1、HTTP/raw/DB 不覆写；SQLite online 备份 SHA `9D34163EC02A2FEA2C60E3010F0F9D02312FD9DC3C82524C0B20A56B93FBB29C` 永不写入。
- 补证基线 `baseline.json` SHA `8E2D100B024F7D4C58EA2945AD59F44687D374DB4326E7F50E14BB093AB15348`，`old-DB-ROWS.json` SHA `7F908FB868EF87AEF2E2A142C470CD55FEE508D80EEED07D41524EBC6B01C0C5`，`salvage-result.json` SHA `691E2EA1D7149DA07EE96BDF2AB1579D54D8C05CFB3D444655A9D4209328388F`。
- 入场代码仅允许 c19 正式合同 SHA `0028DB1DB4F2EC9C488E8E58F41BA361EF373E3CFD9617DCD4372C4648E25426` 与 store SHA `CD58D0B0F7CE6B1CEAB32D233544246B67A14722F84E4FBD8ACB54C4C651A65E`。wrapper 与 Python 各自核所有输入 SHA。其余 c19 共享依赖由 MGR04 同步回执核定。
- 命令在上述外部 QA 目录执行 `node capture-script-compat-new.mjs` 一次；wrapper 用 c19 `.venv\Scripts\python.exe -B` 单独进程，30 秒限时。新 HTTP 请求/响应原始字节、逐步 JSON、PID、exit、stdout/stderr、结果均仅追加于隔离目录；任何断言失败立即停，不重试，不重发成功 POST。

## 有序检查

1. 写前只读查原库与保留备份：项目1、episode1、旧版本2、旧收据2；原 `content_json/content_hash`、版本 ID 与补证行逐字一致，`integrity_check=ok`、外键空。
2. 正式新源对旧 ACTION/DIALOGUE 精确 GET、旧最新 GET 均 200。版本响应字段集合、除 `head_revision` 外所有版本字段（特别原 content、hash、ID、版本号、作者、时间）等于旧 201；当前 head 单独为 2，旧内容不补 `delivery`，ETag 等于原 hash。
3. 旧 DIALOGUE **相同 key/actor/请求**重放返回 201、`replayed=true`、原版本；同 key 分别改变 delivery、文本、已新增 `story_bible_version_id` 来源字段，均为 409 `SCRIPT_CONFLICT`。sidecar 固定可信 actor，此门不声明 actor 变更冲突已测。
4. 以新 key 提交旧 DIALOGUE 缺 delivery，预期 422 `SCRIPT_INPUT_REJECTED`；此前旧两版本/收据逐行不变且收据总数仍 2。
5. 以新 key 写显式 `OFF_SCREEN` DIALOGUE、以旧 DIALOGUE 为父、期望修订2；预期 201、版本号/当前 head=3。重新创建 repository/TestClient 后精确 GET 新版本，核所有不可变字段、当前head3与 ETag。结束时旧两版本/收据行仍等于旧基线、备份哈希不变、收据总数3。

此门是隔离 TestClient API/SQLite 兼容证据，不代表 Electron、MLT 运行、生成媒体或正式作品验收。失败保留原始请求、响应和进程日志，停止后由 MGR02 重新审门。
