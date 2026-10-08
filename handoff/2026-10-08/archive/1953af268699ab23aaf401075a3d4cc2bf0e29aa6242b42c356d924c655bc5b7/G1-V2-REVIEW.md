# G1 v2 静态复审包

状态：仅静态准备。没有 GRANT-02.json、run-02、launch-02；未导入产品、未迁移数据库、未调用 provider、未重跑历史 fault。

## 冻结字节

- PACKET-02.json SHA256 `85BD6B5258526455C326F981767E4B68178FC3CD4A4E8C8A970F8750D6F21A50`
- g1_v2_once.py SHA256 `5F1D7F05536CCD1E9D5E0CAF8E32CF30F5B5317FDE12A784699CF3C6A07D120B`
- launch_g1_v2_once.ps1 SHA256 `BB568BD27BBAE5DBF1B6DB16E6203E7FB8F1CD52C6AC09EA095DD32EE18B1C95`
- CALIBRATION-02.json SHA256 `7A00A33E4DBA741D11E68FBBAE8677B2788A91092E1003DA0B995F784B4EF5FA`
- STATIC-REVIEW-02.json SHA256 `DBEDBD8D12E734626CA28A8E5DEACAED644938888A6503E06FAED297C7757862`

v1 的 PACKET.json、g1_once.py、launch_g1_once.ps1 哈希保持为 `04DFEA76...`、`203D1F45...`、`1CCA52FB...`，只保留为历史静态候选。

## 三项复审修复

1. 按历史 `verify-repo30-isolated-migrations.py` 的 SQLite 逻辑摘要算法，使用 BLOB 十六进制值、`json.dumps(..., sort_keys=True, default=str)`、projects/episodes 身份摘要。原始 v26 采用 `mode=ro&immutable=1` 只读校准，50 张表和完整状态与历史 RESULT 的 `original-v26.state` 一致；运行器将先复核冻结校准证据和源库，再创建运行数据库。升级后将对比历史 `upgraded-v26.state` 的全部 58 张表、逐表数量与哈希、身份摘要，并复开比对。
2. MIGRATE 后、复开后、最终回读均要求 `sys.path == import_sys_path`。映射当前进程已加载的产品模块和五个依赖根模块，逐一核对 `__file__` 位于固定 QA 包或 QA 依赖目录及固定字节数/SHA；要求五个依赖根均有已加载模块。
3. 启动器记录进程退出后的 profile-02 文件、链接、目录计数，要求仍为 0/0/4；偏离即 RED。独立预检确认启动前为 0/0/4，写入授权范围为 run-02、launch-02。

## 独立静态检查

固定 Python 3.12.13 `-I -B` 校验 v2 Python AST、153 个 QA 产品文件、157 个 QA 依赖文件、24 个历史 closure 模块、源 v26 库、历史结果、先前导入回执、解释器及校准证据哈希；PowerShell 解析器 0 错。profile-02 为四个子目录、零文件、零链接。完整明细在 STATIC-REVIEW-02.json。静态检查不构成 G1 迁移通过。

## 待复审授权

MGR01 确认 `mgr01_scope_reviewed=true` 且 MGR02 给出单次 `APPROVED_SINGLE_RUN` GRANT-02.json 后，才可使用已冻结启动器运行一次。授权须绑定 packet/runner/launcher、校准、先前导入回执、历史结果、源 v26 SHA，以及 `run-02`/`launch-02` 和无 provider、历史复用、允许写入、净化环境边界。执行后遇 RED 停止，不重试。