# TEST 剧本身份失败现场的 GET-only 新进程补证

日期：2026-09-28。此计划供 MGR02 静态审门，**未执行**。首轮 `script-identity-01` 的 wrapper exit1，原因是 QA 脚本使用 `JSON.stringify` 比较 JSON 对象字段顺序；原始 HTTP 已显示 project201、显式 episode201、script201、即时 exact GET200、首 sidecar 正常 close0。原失败、raw、profile、数据库保持原样；不重发任何 POST，也不复用原 runner。

## 固定输入与新输出

- 只读原件路径：`C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\qa01-mlt-20260928\script-identity-01`。固定 `CAPTURE.json` SHA `A62A7E389282789F350662CF42569432025D313560CEAD9300F4FDBD59BB5494`；原 project/episode/script 201 响应 SHA 依次 `F158E22A804EDF51A261297BF534D640B7BA60ACD59895A82E6222145F0AEB29`、`A7C70F8F8DA800402DCF3D586D9CF37927EAD88E1892FB02F231E64FB7BFC23C`、`358F35C50B837E467C3F28664502978627B448BEED0D5BD94732243D465844EB`；即时 exact 响应 SHA `8F3D28EC3CA4DE8957CA922CA93173681A900E21E0A050CDE75A1ED82F968B20`；原 wrapper invocation SHA `4E491EB2E14E99668C5EDCF5B9D9E8DA9573DB8AE10DFA1CEA2363DAB07DD335`。
- 原隔离 profile 数据库只读取文件 SHA 入场 `54533ABEEAC1E45DB3D643303967EFDCF9379024405853DF1B240838B80F90CC`。sidecar 正常启动可能触发 SQLite WAL/检查点，脚本记录主库运行前后 SHA，不能仅凭主文件哈希判断逻辑状态。原 profile 是唯一的读取目标，不接用户库。
- c19 当前正式合同/store/sidecar route SHA 分别 `0028DB1DB4F2EC9C488E8E58F41BA361EF373E3CFD9617DCD4372C4648E25426`、`CD58D0B0F7CE6B1CEAB32D233544246B67A14722F84E4FBD8ACB54C4C651A65E`、`931D14F8B3D3069ED89E224C6BF4EBF2EE4CA9CA34DAFC9A6415CD2E1B3B8770`。脚本入场逐一核哈希。
- 全新证据输出目录 `...\qa01-mlt-20260928\script-identity-readback-01`，运行前必须不存在。wrapper 的 stdout/stderr raw 与 PID/exit 另存父 QA 目录，均须不存在。原 run01 中没有文件被写入或覆盖；允许 sidecar 正常读同一隔离 profile。

## GET-only 一次序列

1. 在发请求前核原 wrapper exit1、CAPTURE 四步方法与状态 `POST201/POST201/POST201/GET200`，从原始响应提取 project、显式 episode、script version、scene/两 block、内容 hash。用结构化深比较原 201 版本与即时 GET 版本：对象字段顺序忽略，数组顺序、字段集合、类型和值严格相等，缺键与显式 null 不混同；`head_revision=1` 单独核。仅使用原真实内容结构，不填默认字段后再计算哈希。
2. 用旧隔离 profile 启动**新的真实 sidecar 进程**，保留启动 PID/ready host/port/协议、原始 stdout/stderr；仅允许本地 `127.0.0.1`。依次 GET 原 project、显式 episode、原 exact script version、script latest。各预期200；项目 ID/name、episode ID/project/目标5秒/非默认、版本完整字段与原201逐字段比对，`head_revision=1` 单列，原 `content_hash` 和两 block 文本/speaker/`OFF_SCREEN` 原样。回包 `request_id` 不作为版本字段比较。
3. 正常关闭该 sidecar，记录退出码和输出哈希。只有四次 GET 与关闭全通过，才在**新证据目录**写 `IDENTITY-READBACK.json`，状态 `REOPEN_VERIFIED_WITH_ORIGINAL_EXIT_1`，明确原 runner exit1 与本次 GET-only 补证的区别。
4. 任一失败、响应不确定或启动异常均保留新目录的已得 raw，停止；不重试、不 POST、不让 QA02/ART04 把该身份当作已通过。此项只证合成 TEST 剧本身份，不称语音、MLT 合成或正式作品成果。

入口为 `node readback-test-script-identity-once.mjs`，它固定调用外部 `readback-test-script-identity.mjs`，总上限80秒。脚本不包含 POST 路径。执行前再次核脚本 SHA、原件 SHA、新目录不存在、相关进程0，并由 MGR02 单独签一次窗口。
