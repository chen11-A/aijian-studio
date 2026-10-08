# DEV05 — B31 CAS / 密钥轮换 / 恢复下一门（2026-09-29）

## 固定输入与当前门状态

B31 `MANIFEST.json` SHA-256 `B91EE1F989B73E23B4740224643B95F48517F006448DCFD375F91E67C11E35B9`；R2 `SOURCE-COMPOSITE.json` SHA-256 `3A3DA222E44622DA5803AE80D9867FF69296BD394E7AC2132921F3C9C30FAE7B`。先前源哈希 R2 194/194、B31 50/50 匹配。`test-20260924.md` 1082–1086 是 S2 source-backed HTTP PASS；1090–1092 的 G4 claim / G5 lock 仍是 OPEN/NOT_RUN，不能据 S2 或 G1 migration、G2 rollback PASS 宣称 worker claim、跨实例锁或 native/provider 验收。

静态代码：`provider_connections.py` SHA-256 `81CF871D80B7013DE46DEAA140664FB9B954F736E0F8A2FEE702ED36F056A946`；`provider_connection_repository.py` SHA-256 `96DAE6694953485C2A5FDD997E19D811B00A713E00EFD5559BF7B1FD1123F053`；`provider_contracts.py` SHA-256 `8C69AAFA39B13253FA46CC43622AD2EAD2A7CFF6596CAFC76A23EFD8CB1BB284`；`provider_connection_routes.py` SHA-256 `8591532DFF70DDB78C7BFF2FFCD1162A1801393F01F3B1C0E90040098EE40C2C`；`credential_vault.py` SHA-256 `84E7D0E7F0F6DF3FE8D645BB1E981148CC1A4DD030320416CB4E6571466F6C4E`。

## 代码行为与未验点

- metadata edit 先按 revision 读，再用 `UPDATE ... WHERE connection_id AND provider_kind='SUB2API' AND revision` CAS，成功 revision+1；还缺隔离 DB 的并发冲突和失败无部分写行为证据。
- rotate 校验独立 `operation_id`，先持久化 `PREPARED` 和新 `candidate_credential_ref`，Vault set/readback，再以旧 credential_ref 和 revision 做 CAS。成功 `APPLIED`，CAS 冲突写 `CONFLICT` 后抛错，Vault/DB 不确定写为 `UNKNOWN` 并要求按 operation GET/readback；不应无脑重试同一个密钥写入或 provider POST。
- 旧 Vault slot 为已读取旧 revision 的派发保留；冲突/UNKNOWN 的 candidate slot 可能成为待清理对象，不能在存在不确定派发时盲删。删除连接只清当前 slot，历史 slot 清理需单独策略。API readback 只返回操作身份/状态/修订号，不返回密钥或 Vault ref。
- 上述均是静态结论；没有运行过 B31 CAS/rotation fault injection、真实 OS Vault、EXE 或真实 provider。

## 推荐的下一门：隔离本机行为 QA

使用固定源和独立 schema31 SQLite DB、独立假 Vault/调用计数器与唯一 `pcn_`、`pcop_`，记录加载模块 `__file__`、源 SHA、DB 路径、迁移版本、Vault 操作计数、每次操作前后行状态、响应状态及 DB postflight。不得使用 S2 DB、已有操作 ID、真实凭据或外部 provider。测试序列：

1. 创建 SUB2API 后仅 metadata edit 的并发 CAS，一次成功、一次 revision conflict；模型/origin/credential_ref 不发生半写，冲突方不能覆盖。
2. 轮换成功：`PREPARED -> APPLIED`、revision +1、新 Vault slot 可读，旧 slot 仍在；同 operation 重放只能 GET 状态而不能再次 Vault.set。
3. 轮换竞争：准备后另一编辑/轮换改变 revision，apply 写 `CONFLICT`，旧 active ref 保持；候选 slot 被记录待清理，不因失败误删 active slot。
4. 在 Vault.set 失败、set 成功但 readback 失败、CAS 结果不确定、进程于 PREPARED 后重启等断点分别验证 `UNKNOWN`/持久化 readback；不得把 UNKNOWN 自动重试为新写入。
5. 重启服务/新进程从同一隔离 DB 读 `APPLIED`、`CONFLICT`、`UNKNOWN` 与连接 revision；检查 API 响应和日志不含 key/credential_ref。

这些测试只接触 fake Vault 时只能证明状态机与 DB 持久化；真实 Windows Vault 的保存/读取/清理要另用独立测试凭据和可验证清理验收。若把 gate 扩为 worker claim / provider one-call，须先由 QA01 完成 G4；若扩为跨实例锁/原生 profile，须先完成 G5。未通过 G4/G5 前不能把 CAS 局部通过外推为整体 AI 联调通过。

状态：静态审查完成；隔离本机行为 QA、G4、G5 尚未运行。
