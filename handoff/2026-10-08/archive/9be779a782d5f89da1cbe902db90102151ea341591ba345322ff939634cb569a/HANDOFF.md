# DEV04 B31 provider 设置 UI 短窗交接（2026-09-29）

作者树：`C:\Users\Administrator\.codex\worktrees\s2-q1-g1-d00-default-deny-59f-20260923\sp`。已在写前核对并备份三个原文件；本目录保存逐文件 `.before`、`.after`、`.patch`。新文件以 `empty.before` 为差异基准。未写 DEV07 desktop、DEV05 后端、DEV03 model 或 c19。

| 文件 | 写前 SHA-256 | 当前 SHA-256 | 本次变更 |
| --- | --- | --- | --- |
| `apps/studio-web/src/api/studio.ts` | `5598B535490C66107F9B4E35CC1EF6011552DD970A89663895AEF769228B1953` | `0D8F6CF403A15A1CA73ADBBDD4BB671E61F27AF64DB73BB84C45F7B1F3F007A6` | 增加 B31 结果类型及可选 desktop bridge/transport 方法。 |
| `apps/studio-web/src/domain/use-provider-settings.ts` | `D06303F3BE264CB8464A364C682E573D9A97C82E49769D1782AB22B1672A199B` | `661C3F0AEE478FCC60B3037225AECE41115FF734AA9AD82D56D68F3DDB662CB7` | 创建/移除异常改为结果未知；B31 待核写入时阻止删除连接。 |
| `apps/studio-web/src/aivora/UtilityPages.tsx` | `77BB59CCEBC594A7AAFA6D39B887C5D2FEE55E64E69BDC42FD45B9705BE9677D` | `488A5B4CC454EF75A8C87341B1FE909518AA71FF192DE7949B7ECDC0E500F9F6` | Sub2API 连接卡片挂载管理面板并显示操作错误。 |
| `apps/studio-web/src/domain/sub2api-provider-journal.ts` | 新文件 | `C3A54F75D68DA55DA5E5A45B3081B25606C48774BAFEB3041C5DB02767D2BD99` | 每连接持久待核记录；换钥匙只保存操作 ID 与修订，不保存密钥。 |
| `apps/studio-web/src/aivora/Sub2APIConnectionManagement.tsx` | 新文件 | `555B4D4B5DFD2822920611ACF90B3FE131FBE40E1B13A452F476D96FB27C4ADC` | 元数据 CAS、一次换钥匙、同操作只读恢复、连接列表读回、本地 readiness。 |

## 边界与 QA 样本

1. 在隔离 profile 内用**真实** Sub2API 连接记录 `connection_id`、`revision`、模型 ID、凭据状态和包 SHA。编辑名称/HTTPS origin/启用状态/TEXT 模型：发送旧修订的完整 CAS 意图，只在列表读回 `revision + 1` 且完整内容一致后解除锁。用旧修订制造 409，记录原状态与请求 ID；不得覆盖较新修订。
2. 换钥匙前记录 `pcop_...` 操作 ID 与 `expected_revision`，确认持久记录不含明文 key；单次 POST 后按原 ID GET。分别核 `APPLIED`、`PREPARED`、`UNKNOWN`、`CONFLICT`、404/传输未知。仅 `APPLIED` 且列表读回相同 `applied_revision` 与 `CONFIGURED` 时解除锁。切走、切回、同 profile 重开后仍只能查原 ID，不得再发 POST。
3. 对连接的实际 TEXT 模型读取本地 readiness：比对连接 ID、修订、模型 ID、`local_preconditions_met`、reasons、credential/runtime status；界面必须保留 `provider_observation=NOT_CHECKED`、`model_entitlement=UNKNOWN` 的含义。该操作不调用供应商，不证明额度或模型权限。
4. 对 create/remove 注入传输异常，界面应显示“结果未知”，只读刷新列表并要求核对原连接 ID/修订；不把异常写成确定未保存或未移除。当前 create/delete 老合同缺持久操作 ID，跨重开自动消歧仍需后端/desktop 契约，不将列表相似项当作确定归属。

当前作者树静态检查：tracked 文件 `git diff --check` 无空白错误；新文件未发现尾随空白。按指令未执行 TS 编译、测试、构建、可见 UI、provider 或 QA。DEV07 的换钥匙/编辑 desktop handler 文件已存在，但本次核查时主进程注册、preload 与 api-client 实现尚未闭合；Web transport 以可选能力保守禁用相应按钮。readiness desktop 只读通道已见源码，仍需 DEV07 同版本 bridge 和 QA 运行时核验。DEV05/R2 sidecar 路由及凭据库实际状态也未在本次验证。
