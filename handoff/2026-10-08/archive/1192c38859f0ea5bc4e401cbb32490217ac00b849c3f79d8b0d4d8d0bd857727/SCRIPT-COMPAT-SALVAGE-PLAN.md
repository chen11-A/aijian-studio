# EpisodeScript 旧种子失败现场补证计划

日期：2026-09-28。原旧阶段在 ACTION exact GET 之后因测试断言混淆当前 `head_revision` 与版本写入时的 head 而 exit 1。此计划不改变该结论，也不重发 POST。

## 输入固定与输出

- 唯一输入：`C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\qa01-mlt-20260928\script-compat-old-seed-01`。原 `workspace.sqlite3` SHA `411DCCC6603A8B3CAAF4C8E5A0872CF6F518C7FEFFC341F9CE378DAF6CF4AD18`；`old-HTTP.json` SHA `179F0CCD0FFCBBDAE6E893D435DC1D152684D0BBCA7BE7F4A61107B9CD18E8B9`；`old-invocation.json` SHA `BEB311380388474194A273ED8EEA09E79EB6FDCAC67F5976576E5813F2F8D1E4`；`old-stderr.raw` SHA `BA2022733D7F0F6042D1A00FD02315920F612F21B55816F52DB1A3F11C157AFE`。
- c19 旧合同 SHA `057DC8290593356CD941BF0D2E34DC721BD1BEA4392FA387EDED8CFAE1F0554D`、旧 store SHA `EE203A8A9B6C0D3D127FD6C88D94DA33854AD9C0516B4D8B214E18B4D66D9A1B`。脚本入场核所有输入 SHA。
- 命令：在外部 QA 目录用 `node capture-script-compat-salvage.mjs` 启动一次。固定 wrapper 启动 c19 `.venv\Scripts\python.exe -B salvage-script-compat-old.py <原目录>`，上限 30 秒。先查所有补证输出文件不存在；不得覆盖旧原件。
- 新文件仅追加到上述隔离目录：`baseline.json`、`old-DB-ROWS.json`、`old-workspace-preserved.sqlite3`、`old-runtime-get-copy.sqlite3`、`salvage-HTTP.json`、两条 GET 原响应、`salvage-result.json`、独立 stdout/stderr/invocation。原 exit1、原 HTTP raw、原数据库保持原名和原 SHA。

## 只读补证步骤

1. 从原 HTTP 捕获中核 project、episode、ACTION、DIALOGUE 均 201；两旧版本 ID、原内容、`content_hash`、DIALOGUE 缺 `delivery`，旧 ACTION 精确回读已 200。记录两次写入时 `head_revision=1/2` 与其后 ACTION 精确回读当前 head=2，不更改任何历史响应。
2. 以 `mode=ro` 查询原库项目、episode、两个 `artifact_versions` 的原 `content_json/content_hash`、两个不可变 `episode_script_write_requests`，核两版本 ID/内容/哈希与旧 HTTP 一致。执行 `PRAGMA integrity_check`、`foreign_key_check`。
3. 从原库用 SQLite `Connection.backup` 建两个独立副本，逐行比较原库与保留副本并重核完整性；只在另一运行副本上构建 TestClient，向旧源发 ACTION 与 DIALOGUE 的 exact **GET**。不向原库传入产品 repository，不调用任何 POST。回读比对字段集合和除 `head_revision` 外全部字段与原 201 完全一致，`head_revision` 单独要求为当前值 2，核 ETag 与内容哈希。
4. 结束时再核原库 SHA 等于入场 SHA。保存进程 PID、exit、原始 stdout/stderr、所有 GET 响应原文及 SHA。任一断言失败立即停，保留原失败现场和新失败证据；不自动重试或进入新源阶段。

此补证若通过，只说明原失败库中的旧版 ACTION/DIALOGUE、收据和精确读取被独立证实；原执行 exit1 仍保留。正式二源同步与新阶段需要分别放行。
