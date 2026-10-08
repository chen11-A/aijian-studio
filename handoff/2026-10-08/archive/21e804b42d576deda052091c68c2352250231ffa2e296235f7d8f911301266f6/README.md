# EpisodeScript 旧稿兼容候选（DEV02 静态交付）

日期：2026-09-28。源工作树：`C:/Users/Administrator/.codex/worktrees/s2-q1-g1-d00-default-deny-59f-20260923/sp`。本包只记录 DEV02 所有权内的代码增量；没有在 c19、用户数据库、正式作品或媒体上执行操作，也没有运行 import、测试、构建或 UI。

## 旧件、新件与 diff

路径均在源树 `services/api/src/aijian_api/` 下。`backup/` 中为修改前逐字副本。

| 文件 | 修改前 SHA256 | 当前 SHA256 | diff SHA256 |
| --- | --- | --- | --- |
| `episode_script_contracts.py` | `6F1C0308092089F23B64075B48F45FC848A0A2EA5694A9289A118EA5EED8A57B` | `0028DB1DB4F2EC9C488E8E58F41BA361EF373E3CFD9617DCD4372C4648E25426` | `9A1158CA7188B42AC4BBBF54FA6F0E32CF114C195B5A25C548976D1F0E4DDB76` |
| `episode_script_store.py` | `4BB69C7113570B1AC0AAB54B642ADDCD54F00E2D000E32C6796C914578F0CDBA` | `CD58D0B0F7CE6B1CEAB32D233544246B67A14722F84E4FBD8ACB54C4C651A65E` | `C260E030F2614B936961044B689EB2F16ACE10BA330AD8FE6C3496FB3C3F7FB0` |
| `episode_script_confirmation_store.py` | `B2451FE47F387EC87F6E8A77ACBEE3118E290313BDB3C7B6F20FD8A2C02208AD` | `99C528F3E2AE6E9FE5CFA472EF07B80A6B7D7E19118B9F1D68F424D99E9B52B5` | `16EAC21FDB2F4D42A5AF8FD796D5050E884F14EFE75F611363498787256FC2FD` |

`EpisodeScriptBlockV1.delivery` 在读取历史稿时允许缺失，值保持未知 `None`。新版本写入在幂等收据检查后拒绝缺 delivery 的 DIALOGUE。旧版本读取按数据库原始内容校验原 `content_hash` 和字节上限，响应由同一原始内容序列化，不经默认字段补全；`stored_content` 是不输出的内部字段，构造及序列化都复核其哈希。确认收据拒绝 delivery 未知的 DIALOGUE。没有修改旧版本、头、哈希、审批或历史请求收据。

旧请求的 replay 仅在相同 project/episode/idempotency key 已存在收据时计算 pre-delivery 格式的请求哈希；只有调用方没有提交 delivery 或三个新来源字段时才参与匹配。新字段、文本、actor 或其他输入改变时仍须 409。没有旧收据的新 DIALOGUE 请求即使未提交 delivery 也必须拒绝。

## c19 最小脚本消费闭包（只读核查，尚未批准同步）

对于**剧本版本保存、旧稿 exact/latest 读取、旧 operation 回放和新 delivery**，需要消费本包作者源中的 `episode_script_contracts.py` 新 SHA `0028DB1D…5426` **和** `episode_script_store.py` 新 SHA `CD58D0B0…A65E` 两件。它们必须成对：完整合同增加可选上游来源字段，旧 store 只验证 ProductionBrief，单独换合同会放宽来源声明；新 store 补齐 StoryBible 项目作用域与真实 SourceExtraction proposal acceptance 绑定检查。

其余脚本保存链沿用下列 c19 现有文件；这里列的是**当前基线，不是要覆盖它们的作者树版本**：

| c19 文件（`services/api/src/aijian_api/` 下） | 当前 SHA256 | 已核代码依赖 |
| --- | --- | --- |
| `artifacts.py` | `397AB81E1F5D2120D67C67E0E0AC92FD69CB77169FF936EEF6AE29ACE8DFDA74` | 已有 `canonical_content_bytes/hash`；新合同的原文响应校验和新 store 哈希复用 |
| `episode_contracts.py` | `03A3615B73C08545F2FC21580FE775BDE448ECA6799EB850204FF2659E5E1009` | 已有项目/分集 ID 合同 |
| `domain.py` | `235CF98F1E597F48B28DACBD6C781ADF938E37A9D5192451B71CB8497BDA8508` | 已有 `ArtifactDependencyDraft`、`ArtifactVersionRecord` |
| `episode_script_routes.py` | `27FBCECDF973F318F4AF747ACBE9061E757252402C2DC9D9C687E8E7934838A8` | 已调用同名 `EpisodeScriptStore` 的 write/latest/exact；不变，保留 route 热修 `931D14` |
| `episode_script_schema.py` | `5D3F5D27777673EB301DD6EDD284E56CDCB767143D01C1D0F9922E8626E8F63A` | migration 24 已建剧集作用域和 `episode_script_write_requests`；JSON 增字段无需新表 |
| `repository.py` | `BB366B214157007E2CB906EEADDC895E1ED60AE95DC97D86BEE686F137710E69` | 已注册 migration 24/25；已有 `get_episode`、`get_latest_artifact`、`get_artifact_version`、`_get_artifact_version_in_connection(..., episode_id=...)`、`create_artifact_version(..., dependencies, record_validator, episode_id, _transaction_connection, _manage_transaction)`；新 store 未用作者树 repo31 新符号 |
| `main.py` | `BBC596FDD33BDBD18A2ABEE96524CFDDCDA8A9D11AAFA76FC03FD11232D0900F` | 已注册 script public GET 与仅 sidecar write；不变 |
| `sidecar.py` | `788E3942BC061D8AC48CDD950D6663DB7C72BDBA86C372FF677260C63C764E1C` | 沿用 c19 认证边界；不变 |

TEST 剧本不填上游来源，`_require_source_acceptance` 直接返回。若同一候选用于真实来源绑定，c19 代码已注册 workflow migrations 12/16（`workflow_schema.py` SHA `46B8C6361E719B7B8C93D4E21FB1A0ABEC699ADBEA55C04B38946BF3DE69095B`），但必须独立确认实际数据库已迁移且存在对应项目、类型、确切版本的不可变 acceptance 收据；静态注册不等于运行态证明。

`episode_script_confirmation_store.py` 新 SHA `99C528F3…52B5` **不在上述脚本保存闭包内**。它是单独的人工确认增量，须连同 `episode_script_confirmation_contracts.py`、`episode_script_confirmation_routes.py`、schema migration 29 和相应 main 注册单独审查；不能为 TEST 剧本保存强拉迁移 29、作者 repo31、作者 main 或备份 CLI。DEV06 的 TEST execution plan 也是后续媒体执行门，另按其 owner 快照集成。

## 作者现场观察快照（非 c19 最小依赖）

以下 SHA 是本次静态回读的**作者源树观察**。其中 repo/main/sidecar 和 confirmation 路由等不是上节 c19 脚本保存闭包的覆盖要求。实际整合时先确认快照未漂移，保留各 owner 的新增代码，不用此包覆盖共享文件。

| 文件 | SHA256 | 关系 |
| --- | --- | --- |
| `episode_script_routes.py` | `27FBCECDF973F318F4AF747ACBE9061E757252402C2DC9D9C687E8E7934838A8` | 原路由不变；public latest/exact GET 与 sidecar 写 |
| `episode_script_schema.py` | `5D3F5D27777673EB301DD6EDD284E56CDCB767143D01C1D0F9922E8626E8F63A` | 原迁移 24 不变；无需为兼容增加数据库迁移 |
| `episode_script_confirmation_contracts.py` | `4659589C6F80A48896735F7B3587C5CB98280C3A478C8F69843FAB1CB0BA10CF` | 确认合同不变 |
| `episode_script_confirmation_schema.py` | `498B350F96D12DEFFE18A05CCECDD3143A2DB0EBEDCA4E1BB8F3FEB942F3AB3E` | 现有迁移 29；确认 readiness 改动依赖此表已受控注册 |
| `episode_script_confirmation_routes.py` | `978E122F98562A47D908CE490E91BA1416A5D94F9E0909B0668D9FAA6C7227FF` | 原确认路由不变 |
| `repository.py` | `4032F9C2E319AABE02FEC9BADC53B5F81E5BD4A592C6EFFA7622EFF07AFD7DD9` | 共享 owner 文件不变；实际迁移/旧库仍待 QA |
| `main.py` | `F9AAF53218C4F997606F4E2BFB67E402DB4411D0BA14B07CF0D2A77F4988F4B9` | 共享 owner 路由注册不变 |
| `sidecar.py` | `B2C72AF00E5B7DF8FF50F0E99F2A362390A659C5962184148013A1446FB10A0C` | 本修复不改认证边界 |
| `episode_media_assembly_store.py` | `5C87BF2220FA4EC0C1A4FB77F2FCD8972B1A816977A6E65095AD0D2D1A25CB3D` | DIALOGUE 段已有 delivery 必填及同版本比对；未知不能通过 |
| `episode_media_execution_plan.py` | `6E7DFC0DAF5534947269C0824658E381293D0D4742145F2DBD7DB5E686C756F1` | DEV06 独立修复：旧稿原 JSON/hash、未知 delivery 显式 `TEST_SCRIPT_DELIVERY_UNKNOWN` |

此候选不依赖 c19 研究用 `QA_ONLY_NEW_EMPTY_DB` 补丁。该研究目录的 README 已标注**取消执行授权**；它不能解锁 TEST 或替代正式兼容修复。

## 独立 QA 门（未执行）

1. 用旧合同的原格式分别保存 ACTION 和 DIALOGUE 历史版本，保留原始内容、version ID、content_hash、head 与旧 operation/key 收据；再用新候选在同一隔离数据库 GET exact/latest，逐字比较原内容结构与哈希。特别核缺省、显式 `null` 和空字段，确认没有补出 delivery 或新来源键。
2. 对旧 operation 用相同 key、actor、请求内容回放，应返回原版本且 `replayed=true`；同 key 改文本、显式增加 delivery/source 字段或改 actor 应为 409。无旧收据且 DIALOGUE 缺 delivery 应拒绝。
3. 新 DIALOGUE 明确 `ON_SCREEN`/`OFF_SCREEN` 写入后正常关闭重开，按 exact GET 核内容、version、hash 和 block ID；旧未知 delivery 的确认及需 delivery 的制作映射应明确待补齐，不能自行假定 `OFF_SCREEN`。
4. 按代码 owner/迁移顺序整合后再测 c19、桌面、MLT、安装与正式验收。静态文件写入不是这些运行结果。
