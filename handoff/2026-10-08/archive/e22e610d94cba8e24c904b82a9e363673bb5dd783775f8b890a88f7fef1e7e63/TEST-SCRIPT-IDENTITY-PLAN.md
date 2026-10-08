# MLT 合成 TEST 剧本身份一次创建计划

日期：2026-09-28。待 MGR02 静态审门；此计划及脚本未执行。范围限**新隔离 profile 中的合成 TEST**项目、显式 episode 与一条 EpisodeScript 版本。绝不使用用户库、正式作品、provider 或付费调用。

## 固定输入与隔离目录

- c19 工作树 `C:\Users\Administrator\.codex\worktrees\c19-trim-211c9e8-qa-20260923`，正式 `episode_script_contracts.py` SHA `0028DB1DB4F2EC9C488E8E58F41BA361EF373E3CFD9617DCD4372C4648E25426`、`episode_script_store.py` SHA `CD58D0B0F7CE6B1CEAB32D233544246B67A14722F84E4FBD8ACB54C4C651A65E`、已修复 `media_asset_routes.py` SHA `931D14F8B3D3069ED89E224C6BF4EBF2EE4CA9CA34DAFC9A6415CD2E1B3B8770`。wrapper 与主脚本核 SHA，漂移即在任何 API 调用前停止。
- 唯一规格：`C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\art04-mlt-test-20260928\MLT-唯一合成TEST工程规格.md` SHA `4323DFEF3EEF9337BAF49A5118DE1397B4C2AFBE2E67768E133F87C950DDF16D`。
- 输出目录：`C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\qa01-mlt-20260928\script-identity-01`，运行前须不存在。所有 profile/workspace/appdata/localappdata/home/temp、sidecar 原始 stdout/stderr、HTTP 原始请求/响应、CAPTURE 与 IDENTITY 均只创建在此目录；wrapper 的原始 stdout/stderr 与 PID/exit 收据位于其父 QA 目录，运行前须不存在。
- 执行入口：在外部 QA 目录执行一次 `node capture-test-script-identity-once.mjs`。wrapper 固定调用 `capture-test-script-identity.mjs`，总上限 150 秒；后者使用 c19 `.venv\Scripts\python.exe -m aijian_api.sidecar`，设 `AIJIAN_DATA_DIR=<全新隔离 profile/workspace>` 与 Pythonpath，**不设置 provider 凭据、不启用 fake timeline runtime**。主脚本只调用本地项目/episode/剧本 API；任何失败、超时、POST 响应不确定都保留原件，停止且不自动重试/重提，失败后的 run 不复用。

## 一次写入与独立重启核验

1. 启动真实 sidecar，记录 ready host、port、PID、协议与 token 长度（不写 token），记录进程 stdout/stderr 原始字节。只允许 `127.0.0.1` 本地会话。
2. `POST /api/v1/projects` 一次，创建标记 `SYNTHETIC_TEST_ONLY MLT 20260928` 的 30 秒、9:16、zh-CN TEST 项目；30 秒是项目 API 下限，不是工程时长，预期 201。
3. 对返回的 project ID，`POST /episodes` 一次创建 `MLT 合成 TEST 分集`、目标5秒的**显式** episode；5 秒对应工程时长，预期 201，不把自动默认 episode 当目标。
4. 对该 project/episode，`POST /script/versions` 一次，独立 Idempotency-Key；一 scene、两个 DIALOGUE block，文本分别为 `TEST 提示音一（非语音）`、`TEST 提示音二（非语音）`，speaker 均为 `TEST 提示音（非人声）`，delivery 均显式 `OFF_SCREEN`；预期201、`replayed=false`。固定返回的 project/episode/version、scene/block IDs、内容 hash、head revision 与 key。
5. 当次会话精确 GET 该 script version，要求与创建响应版本一致。正常关闭 sidecar；随后在**同一隔离 profile 的全新 sidecar 进程**分别 GET 项目、显式 episode、精确版本；核 ID、5秒、非默认、两个 block 的文案/speaker/delivery、原内容 hash。不写第二版，不重提 POST。
6. 仅在第二次 GET 全部通过后将 `IDENTITY.json` 标为 `REOPEN_VERIFIED`。保存每步原始响应和有请求体时的原始请求、状态/哈希，两个 sidecar PID/退出码/stdout/stderr；wrapper 保存 Node PID、exit、原始 stdout/stderr 和 CAPTURE/IDENTITY 文件哈希。缺失任一证据即不能称身份通过。

这只固定合成 TEST 身份；提示音文本不能称为语音，且本次没有 SRT、MLT XML、导出 MP4 或声画验收。旧历史剧本在全新进程的 GET-only 复查另走 MGR02 审门，不与本次 POST 混合。
