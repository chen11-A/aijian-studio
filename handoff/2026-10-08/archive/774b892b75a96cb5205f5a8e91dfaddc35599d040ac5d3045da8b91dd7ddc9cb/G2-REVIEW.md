# B31 G2 prep-05 隔离种子静态复审包

状态：**QA-only 静态候选；无 GRANT、ATTEMPT、launch-01、run-01，不得启动。** MGR01 须重新范围审，MGR02 须对本包独立单签。旧 prep-03 授权已消耗，RED 与旧 G1 sidecars 原样保留。

## 阻断边界

- prep-03 子进程于 `PREFLIGHT` 停在 `G1_SEED_SIDECAR`，`completed_cases=[]`；这属于种子环境预检 RED，13 个回滚故障点均未执行。旧 POSTRUN-REVIEW SHA256 `CB4737A28D00F4EB140B8FE9D8B54D75EF61BDD0FCC7C3BD4A8D7BADE849E14F`。
- 原 G1 主 DB SHA256 `21FECEFCF8DECE3509A1DA8D70FE22F9521E00CEC20164F31FBF282608FD4D24`；复制前以独占只读句柄同时锁住 DB、WAL、SHM，确认 WAL 0 字节、主 DB 哈希匹配，再从主 DB 字节复制。原目录及旁文件未清理，未以 SQLite 打开原 DB。
- 隔离主 DB 路径 `C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\qa01-mlt-20260928\b31-g2-rollback-prep-05\seed-v30\workspace.sqlite3`，SHA256 `21FECEFCF8DECE3509A1DA8D70FE22F9521E00CEC20164F31FBF282608FD4D24`。复制回执 `18269A887A0861D4DF4041024C69622F7FCFBE20C4094D67F04C615FF257F255`；仅在副本上使用 `mode=ro&immutable=1`，schema 30、integrity ok、外键违规 0，副本检查前后均无 WAL/SHM；只读回执 `0E797BAFE59A657BB798401E5DD299FD70709B5F487B6F32DBD61C3CCAE5727A`。实际迁移仍只在 `run-01` 的逐 case 可写副本进行。

## 冻结对象

- PACKET.json `D706829FF6C2B942DB44C607EDC69A0E7A3D289081EEA96C1C2FA1BF5FF02CB9`
- g2_once.py 固定 Python 消费者 `DF0C057B33CF901FACA8EBF1CA52132999F187B7018FDAD208398115A9AE7579`
- launch_g2_once.ps1 `104677816F5D01529015A0D20EA608DFA5E8BC869ED4CC8CB822BD05F6C6E6ED`
- LAUNCH-PACKET.json `68BFE5E067CB846149EF6223191D89485797EE46064381C4FA7ECBD7C132F58A`
- SEED-EVIDENCE.json（G1 原种子的派生副本证据）`33652CD00568208E0B042C0BA2CBAE6C7C7CFC75AC46ACA4E1F6007097A1AA26`
- STATIC-NEGATIVE-CHECKS.json `5C22B193D74FD53DA9038D798E9BAC017DC5F4CF0677251A46D8F673EDA24925`
- STATIC-REVIEW.json `3D5CC3A8BF8FF94D6909B8ED8C31FE6BCFDE240123E8A67ED6C017FA9B03BFEF`

## 核验和签发边界

- 固定 Python 回哈希：25 项静态 pin 检查通过，153 个产品文件和 157 个依赖文件零差；runner AST 与固定 pwsh parser 通过。13 个 statement/hook 与故障 case 保持原计划。
- runner 相对 prep-03 只增隔离种子来源、复制/immutable 回执及新 grant 绑定检查；`snapshot(seed_db)` 仍以 `immutable=1` 只读，`shutil.copyfile` 将种子复制到 `run-01` 下的各可写 case。
- 新 GRANT 除 packet/runner/launcher/launch-packet、G1 receipt、同一 pwsh 绑定外，还须明确 `g1_seed_db_sha256`、`seed_copy_receipt_sha256`、`isolated_seed_immutable_read_sha256`。MGR01/MGR02 不得复用 prep-03 的范围审或授权。
- 本包没有运行 G2；隔离副本通过静态预检不等于 13 步回滚验收。
