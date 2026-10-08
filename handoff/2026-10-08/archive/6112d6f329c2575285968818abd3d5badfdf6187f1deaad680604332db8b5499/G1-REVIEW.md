# B31 G1 迁移门静态交接

状态：**静态包就绪，等待 G0 PASS 和单独授权；未生成 DB、未运行迁移**。MGR01 须先复核 G0 实际 PASS 回执与 G1 范围；MGR02 对 G1 单独签发一次性 GRANT.json，绑定 G0 回执 SHA。当前无 G0 回执、G1 grant、run-01 或 launch-01。

## 固定输入

- D152 schema30 基线 152 件；B31 QA 目标 153 件；隔离依赖 157 件。PACKET.json SHA-256：4A6C5059F4C2C7800DD0E843EA3B1C1519EEDBB3EB69CFC870874A1ECADB6526。
- 合成 v30 种子规格 SEED-SPEC.json SHA-256：EC393423620933943E4D3FA3A28839E861092CDDCB3378F98C63893E2E845837。包含 6 种旧 provider 连接、一条经 workflow/task 关联的 SUB2API 引用，旧 Vault slot 仅以 connection ID 标识，不含密钥字节。
- 固定 CPython 3.12.13 -I -B；seed_v30_once.py consumer SHA-256：FA3D7D4F70E694D27B52DD219C4603F896A91126E5274F3C362953E89BE03A38；g1_once.py consumer SHA-256：73C20A3495C1772611AEAD2253BC19179895BEAC9E82212347D9EA2482A6C939。
- launch_g1_once.ps1 SHA-256：4909D210BF944B152B4AE93B686E9FEA0740523AF121B948A0B5CB95B3D63467；LAUNCH-PACKET.json SHA-256：8B4AC8D313D9AD530AB5D35E54C6BDE8684ADE844724063C367B6191A8D211A4；隐藏、清洁 8 变量双脚本哈希探测 SHA-256：BC41C04F731E2CBEA89E62999910E441BD5F35794324405CBCB4FA4ECB22734F。

## 单次运行边界与预期证据

launcher 先核 grant、G0 PASS 回执 SHA、固定解释器和双 runner 哈希，再按种子→迁移顺序分别启动。种子仅以 D152 建立独立的 schema30 seed-v30/workspace.sqlite3，写 SEED.json、旧模块实际 __file__/SHA 映射；首 RED 即停。迁移 runner 另建空库 empty-1to31/workspace.sqlite3，并从种子复制建立 migrate-v30/workspace.sqlite3，两库不复用 core153 样本。

预期迁移回读：schema31、user_version=31、完整性/外键检查；旧 9 列逐值不变，六条 credential_ref=connection_id，一条旧 SUB2API 引用不变，旧触发器及旧外键目标保留，新 rotation 表为空，重开稳定。runner 记录 153/157 输入前后逐件与实际模块位置、SHA，成功时 run-01/RECEIPT.json 仅声明 PASS_B31_G1_EMPTY_AND_V30_MIGRATION_ONLY。失败保存原始 stderr/RED/退出码，停止且不自动重试。

G1 不调用真 Vault/provider；G2 13 步故障回滚、CAS/rotation、DEV05 consumer closure 与后续 G3–G6 均另门验证，不能继承 G1 PASS。

## 静态验证

152/153/157 件逐件哈希一致；两个 runner 的 AST 可解析，launcher PowerShell parser 0 错；profile 4 目录、0 文件；没有 G0 回执、grant、DB、运行和启动记录。此证据只支持范围审核与待授权状态，不构成 G1 迁移 PASS。
