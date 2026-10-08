# DEV04 B31 provider 设置静态核查（只读）

2026-09-29 作者树当前源。没有修改 provider 文件，没有运行构建、测试、Electron 或 provider。此表是接口差异，不是运行验收。

| 操作 | 当前代码 | B31 所需合同与归属 |
| --- | --- | --- |
| 列出/创建/删除 | `use-provider-settings.ts`、`ProviderConnectionForm.tsx` 仅接 `list/create/deleteProviderConnection`；卡片显示 `credential_status`。 | 创建与删除异常可能发生在服务端已执行后；不能仅凭 Promise rejection 宣称“未保存/未移除”，也不能直接重试。UI 需保留未知并核对连接 ID/修订。 |
| Sub2API 元数据编辑 | 页面无编辑入口；`studio.ts` 无方法。后端 `PATCH /api/v1/provider-connections/{id}` 已定义。 | DEV07 完成 `api-client`、主进程注册、preload、`studio.ts` 同版本桥；DEV04 页面提交 `expected_revision`、完整 `display_name/base_url/enabled/models`，无密钥。409 重新读列表并保留用户草稿；响应未知只读核对修订与内容。 |
| Sub2API 换钥匙 | 页面无入口；`sub2api-connection-mutation-contract.ts` 与 IPC handler 文件存在，但本次静态搜索未在 main/preload/api-client/studio.ts 找到该 handler 的实际注册和方法实现。后端 POST/GET 端点已定义。 | DEV07 接通 `editSub2APIMetadata`、`rotateSub2APIKey`、`readSub2APIKeyRotation`；DEV04 只提交一次 `expected_revision + pcop_... operation_id + api_key`，在调用前持久保存操作 ID。未知时只用 GET 查原操作，不重复 POST。只在 `APPLIED`、连接 ID 与 `applied_revision` 读回一致后展示完成。 |
| 本地 readiness | desktop `api-client.ts`、preload、main 已有 `readSub2APIConfiguredReadiness` 只读通道；`studio.ts` 与设置页未接。 | DEV07 把只读结果暴露到 Web transport；DEV04 按当前连接 ID、修订和显式 TEXT 模型 ID 显示 `local_preconditions_met/reasons/credential_status/runtime_status`。`provider_observation=NOT_CHECKED` 与 `model_entitlement=UNKNOWN` 必须原样保留，不能显示“供应商可用”。 |

接口身份：连接 ID `pcn_` 加 32 位小写十六进制，换钥匙操作 ID `pcop_` 加 32 位小写十六进制；连接公开回执含 `revision`、`enabled`、`models`、`credential_status`，不含密钥。后端换钥匙读回状态为 `PREPARED/APPLIED/CONFLICT/UNKNOWN`，另含 `expected_revision`、`applied_revision`。DEV05 需确认 R2 sidecar 端点、错误码与 UI 目标包同版本；当前静态代码存在不等于 QA 包已包含。

当前页面的 `useProviderSettings.create` 在任意异常后显示“连接未保存”，这对传输未知不成立；`remove` 异常后的“无法移除连接”也可能与服务端事实不符。待 bridge 合同明确区分确定拒绝与未知后，由 DEV04 调整 UI 文案、锁与读回流程。密钥仅暂存在输入框；页面不回显 Vault 内容，也不把 key 写入本地记录。

QA 交互样本：在隔离 profile 内读取真实 Sub2API 连接 `connection_id + revision`；改一项元数据并验证修订递增，再用旧修订确认 409 且页面不覆盖最新配置；换钥匙只发一次，保留 `operation_id`，分别核 `APPLIED`、`PREPARED/UNKNOWN`、`CONFLICT` 和重开后的原操作查询；逐模型读取 readiness 并对比连接修订，确保 `NOT_CHECKED/UNKNOWN` 不被改写为 provider 成功。记录请求 ID、原始错误码和同版本包 SHA。该样本尚未执行。
