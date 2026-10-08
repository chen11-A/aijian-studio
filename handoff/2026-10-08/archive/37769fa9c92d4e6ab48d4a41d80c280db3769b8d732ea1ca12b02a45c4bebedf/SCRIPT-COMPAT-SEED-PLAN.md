# EpisodeScript 旧源种子一次执行计划

日期：2026-09-28。此文件是 QA01 的静态送审材料；旧阶段尚未执行。

## 固定输入与隔离位置

- 候选工作树：`C:\Users\Administrator\.codex\worktrees\c19-trim-211c9e8-qa-20260923`。只读取源与虚拟环境，不写入 c19。
- 旧源允许哈希：`episode_script_contracts.py` = `057DC8290593356CD941BF0D2E34DC721BD1BEA4392FA387EDED8CFAE1F0554D`；`episode_script_store.py` = `EE203A8A9B6C0D3D127FD6C88D94DA33854AD9C0516B4D8B214E18B4D66D9A1B`。执行器和 Python 脚本各自核 SHA，不同即停止。
- 外部输出目录（要求执行前不存在）：`C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\qa01-mlt-20260928\script-compat-old-seed-01`。仅在此目录创建新 SQLite、请求与响应、结果、备份、日志。禁止指向用户数据或已有目录。
- 命令：设定上述两个 `QA_EXPECTED_*_SHA256` 环境变量后，在外部工作目录运行 `node capture-script-compat-phase.mjs old <上述输出目录>`。once wrapper 以 c19 `.venv\Scripts\python.exe -B` 启动；30 秒上限；保留 PID、退出码、stdout/stderr 原始字节及哈希。

## 一次旧源种子的 HTTP 固定序列

1. 新库、新 TEST 项目：`POST /api/v1/projects`，`target_duration_seconds=30`、`aspect_ratio=9:16`、`source_language=zh-CN`；预期 201。
2. 在该项目新增 TEST episode：`target_duration_seconds="5"`；预期 201。
3. 同一 episode 写 `schema_version=1.0.0`、一 scene、一 ACTION block（无 `delivery`），独立 Idempotency-Key；预期 201、`replayed=false`。
4. 以 ACTION 版本为父、相应 `expected_revision`，写一 DIALOGUE block，有 `speaker`、`text`，**缺 `delivery`**，独立 Idempotency-Key；预期 201、`replayed=false`。两个版本都用精确版本 GET 回读，核响应 data 等于写入版本。
5. 每步保存方法、路径、请求体、key、状态、响应体，以及原始请求/响应文件和 SHA。保存 project/episode/version IDs、旧 DIALOGUE 请求/key 的 `baseline.json`。无自动重试。

## SQLite 备份与判定

- 旧源仓库使用 WAL；不用直接复制主库。脚本在写入及回读后用 SQLite `Connection.backup` 创建 `old-workspace-preserved.sqlite3`。源库只读连接与备份分别执行项目、episode、两条 `artifact_versions`（包括原 `content_json`、`content_hash`）、两条不可变 `episode_script_write_requests` 的查询；核 version ID、原内容和哈希与 HTTP 基线一致，源/备份查询结果相等。
- 对源与备份分别执行 `PRAGMA integrity_check` 和 `PRAGMA foreign_key_check`，要求 `ok`、无外键错误。保存查询原文 `old-DB-ROWS.json`，记录源/备份字节数和各自 SHA。源与备份的**文件哈希无需相同**，因为 WAL 与备份文件布局可不同。
- 任一步断言或进程失败立即停止，保留已落盘原始失败和进程收据；不得当作通过。旧阶段完成后停止，不在该进程加载正式新源。

## 下一阶段边界

MGR04 单独固定并同步正式合同 `0028DB1D...5426` 与 store `CD58D0B0...A65E` 后，另获 c19 窗口再运行 `new`。新阶段按原库及备份哈希和行内容检验旧态，再测 exact/latest 原字段与哈希、原 key replay、同 key 改 delivery/text/source 字段 409、新 key 缺 delivery 422、显式 `OFF_SCREEN` 新版本及重开精确读取。sidecar 路由只提供固定 trusted actor；actor 变更冲突未纳入本轮 HTTP 门，须另设受控可信 actor 用例才可作通过声明。
