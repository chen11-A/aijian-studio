# B31 G1 迁移门静态复审包 02

状态：**静态就绪，条件性等待 G0 PASS，未运行、未获授权**。旧 prep-01 原样保留；本目录是独立修订包，供 MGR01 复审，随后 MGR02 对 G1 另签一次性 GRANT.json，写明 approval_id 并绑定 G0 实际 PASS 回执 SHA。当前无 G0 回执、G1 grant、ATTEMPT-USED、run-01、launch-01 和 DB。

## 冻结输入

- PACKET.json SHA-256：15E432BB60E4BA50B2F751304FDF4D4A5E858FF650BBA9683ECFC8778B0852E2；D152 基线 152 件、B31 QA 目标 153 件、隔离依赖 157 件逐件固定哈希。
- 固定解释器 consumer seed_v30_once.py SHA-256：AAE4649B081982283F27551830577C38F6104034FF2A96A97FEB0A717D421F11；g1_once.py SHA-256：F7CF26F3F1108D2E94362E52CF0A75084B5D9DE4876A1F0A5156AF8CD0124374。
- launch_g1_once.ps1 SHA-256：FC0FD1A95B5D9C48B53696054051340D5CB3BBFBDB8FD0FDDA5E712A982316E8；LAUNCH-PACKET.json SHA-256：C526D3EF19AEC93B87EE45447D4293A9CBC102EA28975A99748FCE7DC77C5D2F。
- PROFILE-PREPARED.json SHA-256：0FFDCA47A3F7D68C3256779D4C4F10D1192A8E97F2552AF6D0EBA737FC0F115C；HASH-PROBE-STATIC.json SHA-256：6CC3D5A35D5A1CB1E927E0D8CEC47867F3FF5E630C2D9C2C372A20801641A30E；STATIC-NEGATIVE-CHECKS.json SHA-256：A54683D0B55181A99C1D6F414B64F04738E3DD241B3F2FCB7383CC82DADAE2C2。
- SEED-SPEC.json 为无密钥合成数据：6 类旧 provider 连接、旧 connection ID Vault slot 标识、一条带 workflow/task 关联的 SUB2API 引用；不调用真 Vault/provider。

## 单次边界与迁移范围

launcher 仅在固定 GRANT.json 存在后立即独占落盘 ATTEMPT-USED.json；之后的 G0 回执、授权、packet、工具、profile、双哈希探针等检查及种子、迁移子进程处于同一 try/catch 内。预检/种子首 RED 即停止，保留 ATTEMPT-RED.json、原始 .bin 输出、EXIT/RED；同目录同授权不可重进。两个 Python runner 均要求 attempt 标记、PREPARED.json，以及 grant 对 launcher/launch packet 的哈希绑定。

各子进程的超时 Kill(true)、回收和双流收尾均有界；未退出或 stdout/stderr 不完整即 RED。种子只建独立 schema30 库；迁移另用全新空库 1→31 与复制的 v30 库 30→31，不复用 core153 样本。预期回读 schema31、user_version、旧 9 列/引用/FK/trigger、credential_ref=connection_id、空 rotation 表、完整性及重开状态。成功回执只可声明 PASS_B31_G1_EMPTY_AND_V30_MIGRATION_ONLY。

## 静态核验及边界

两个 runner AST 与 launcher PowerShell 解析通过；152/153/157 逐件哈希通过；纯数据/静态负例核了旧 attempt 拒绝、错误哈希、无无界 Wait、种子 RED 阻断迁移及原始流留存。G0/G1 均未运行，不能声明迁移 PASS。G2 13 步故障回滚、CAS/rotation、DEV05 consumer closure 与后续门仍需独立验证。
