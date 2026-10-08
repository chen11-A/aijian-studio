# G1 v2B 复审交接

此文件更新 G1-V2-REVIEW.md 中的启动器哈希与静态检查证据。旧文件和旧静态报告原样保留，反映发现读取视图问题之前的候选状态。**当前未执行 G1。**

| 项目 | 当前固定 SHA256 |
| --- | --- |
| PACKET-02.json | `85BD6B5258526455C326F981767E4B68178FC3CD4A4E8C8A970F8750D6F21A50` |
| g1_v2_once.py，固定 Python 消费者视图 | `5F1D7F05536CCD1E9D5E0CAF8E32CF30F5B5317FDE12A784699CF3C6A07D120B` |
| launch_g1_v2_once.ps1 | `E819612A5DA0F445D2186BC402AC76854CA7A93B5A89BD86D043A507E31FE2C5` |
| CALIBRATION-02.json | `7A00A33E4DBA741D11E68FBBAE8677B2788A91092E1003DA0B995F784B4EF5FA` |
| STATIC-REVIEW-02B.json | `AEB92492E94FAADA744451520AF1DFC1EC5A3C3CC675B26BB12C418EAB444BA2` |

校准：固定 Python `-I -B` 使用只读 immutable SQLite 打开原始 v26 库，按历史脚本算法重算，50/50 张表、全状态、projects/episodes 身份摘要一致。运行器在创建运行库前复核该证据和源库；升级后需与历史 `upgraded-v26.state` 的完整 58 张表逐表摘要及身份摘要一致，复开状态一致。另验证 MIGRATE/复开后的 `sys.path` 与五个已加载依赖根的每个模块路径、字节和哈希。启动器退出后检查 profile-02 仍为 4 个子目录、0 文件、0 链接。

独立静态检查：Python AST 通过；PowerShell 解析错误 0；153 个产品文件、157 个依赖文件、24 个历史闭包模块的全量哈希检查沿用 `STATIC-REVIEW-02.json`，其证据 SHA `DBEDBD8D12E734626CA28A8E5DEACAED644938888A6503E06FAED297C7757862`。此次只修改启动器，复测固定 Python 的 runner SHA 与包一致；原 PowerShell 原始视图 SHA 是 `B40CD5D6C8C6A15FB21FF78CCD8D4E3CB21CB68A5E3842B2D6B0F98BCB0D35CB`，原启动器会预检误停。现启动器先核对固定 Python 自身哈希，再用该 Python `-I -B` 读取 runner 哈希。profile-02 当前为 4/0/0；GRANT-02.json、run-02、launch-02 均不存在。

请 MGR01 复审范围；MGR02 仅在通过复审后，为以上**当前**三个可执行字节及校准证据签发单次 grant。未授权前不得调用启动器；出现 RED 不重试。旧 v1 候选字节保持原样。