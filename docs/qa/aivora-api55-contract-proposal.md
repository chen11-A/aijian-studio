# API55 可审合同提案

状态：提案，未冻结。本文只描述后端已在本任务分支实现、并供总控审查的边界。未改 `packages/contracts`，未发布共享类型，未改 `apps/desktop` 或 `apps/studio-web`。总控书面冻结前，两边都不得把本文直接写成已发布的 OpenAPI 或生成类型。

检查点 `166dc89d35d3cfab6f220a409b34a0874f38ee08` 已用 bundle 隔离导入，没有整包合并。桌面私有 client 只登记，不在本分支移植。

## prepareSlots 请求

签名后的私有调用，不是 renderer 可提交面：

`POST /api/v1/projects/{project_id}/prepared-generation-executions/{execution_id}/cache-preparations`

`execution_id` 为 `^[a-f0-9]{32}$`。请求体 `PrepareCacheSlots`，`additionalProperties: false`：

```json
{ "registration": "<RegisterPreparedExecution>" }
```

`registration` 必须是当初注册该 execution 的同一份原生持有登记，包含原 `key`、targets、stages。不接受 renderer URL、缓存路径、依赖清单或声称的 cacheHit。账号、项目、execution key 与已存 execution 不一致时，在读取提交来源之前拒绝。

既有 raw-body HMAC 账号头继续适用（无 arm 时为 `aivora-video-account-v1`）。账号、项目、版本数量、输入桶和模型上限保持原门，不放宽。

## 响应

`PreparedSlotCacheFacts`：

```json
{
  "kind": "PREPARATIONS",
  "items": [
    {
      "target_key": "<key>",
      "slot_index": 0,
      "preparation": "STORYFILM_CACHE",
      "cache": {}
    }
  ]
}
```

`items` 长度 1 到 768，是该 execution 全部 target/slot 的整表，按存储的 target key 与 slot index 覆盖完整，不能只用序号发明公共准备事实。

每个 `PreparedSlotCacheFact`：

| 字段 | 约束 |
| --- | --- |
| `target_key` | 原 target key |
| `slot_index` | 整数 0、1 或 2 |
| `preparation` | `CLIENT_IMAGES` 或 `STORYFILM_CACHE` |
| `cache` | `CLIENT_IMAGES` 必须为 `null`；`STORYFILM_CACHE` 必须为下面的私有对象 |

`STORYFILM_CACHE` 只允许 slot 0，且仅当该 target 的原 `first_regenerate` 为 false。slot 1 和 slot 2 即使当时或之后写出完整 bundle，仍是 `CLIENT_IMAGES`，`cache` 为 `null`。已冻结的 `CLIENT_IMAGES` 不因后续新缓存改成 `CACHE`。

## 私有缓存对象

`PreparedPrivateCache`，`schema_version` 常量 1，`additionalProperties: false`：

| 字段 | 含义 |
| --- | --- |
| `snapshot_sha256` | 规范化快照信封的完整性摘要，不是授权 |
| `input_sha256` | 原输入桶 |
| `request` | 冻结的原 `CreateStoryFilmBody` |
| `sources` | 原意图来源行，每行且仅有 `source`、`canonical_path`、`sha256`、`mime` |
| `runtime_recipe` | 冻结的实际运行配方，含原 `cap` 与 `actual_video` |
| `parts` | 恰好 `image`、`video`、`voice`；每项 `{ "sha256", "bytes" }`，`bytes` 为 1 到 80 MiB |

来源 SHA、运行配方、三个产品的 SHA 与字节数必须与冻结时的原请求和实际文件一致。替换可变 `bundle.json` 不改变已选快照。晚缺、损坏、同长度替换或链接替换在消费时停止。

`canonical_path`、快照路径和 descriptor 只给签名后的私有消费者复核。它们不是 renderer 授权事实，也不能当成公共 PREPARED 发行凭证。目录只可作拒绝边界。

## 公共槽表与错误

公共发行槽表仍是现有中性登记合同。本提案不改公共 PREPARED issuance，也不把私有 cache 字段并进 renderer 可见 DTO。

`cache-preparations` 的预期失败统一为 HTTP 409，`detail` 为 `INPUT_UNVERIFIABLE`。覆盖登记不符、快照不可核验、来源变化、账号/项目/退役，以及在已有 image/arm/额度之后再冻结。该响应不发起 provider POST，不新增预算尝试。

既有 image/arm 路由保持原错误码，不把它们折叠进缓存成功：

| 码 | 何时保留 |
| --- | --- |
| `INPUT_UNVERIFIABLE` | 缓存槽借用原请求、来源或 regenerate 事实不符 |
| `EXECUTION_UNAVAILABLE` | 错账号、错 body、退役，或对已冻结缓存槽申请新的 transport admission |
| `ATTEMPT_ALREADY_RESERVED` | 同输入桶已有 PENDING/UNKNOWN；提高 N 或新 execution 不能解开 |
| `UNCONFIGURED` / `INPUT_FAILURE_LIMIT` / `VIDEO_UNCONFIGURED` / `VIDEO_INPUT_FAILURE_LIMIT` | 原额度门 |

缓存晚缺没有付费回退。`CACHE` 声称不能在核验失败后改走新生成。读取缓存不得把已有 `UNKNOWN` 结算成 `SUCCEEDED` 或 `FAILED`，也不得借提高 N 或新 execution 解锁。后续版本不得借用缓存槽的请求或额度；slot 1/2 使用冻结缓存请求去 arm 时拒绝。

## 持久边界

只新增表 `prepared_generation_slot_preparation` 及其主键。`user_version` 从 54 增到 55。schema 51/53/54 的数据、失败输入身份和原授权门保留。六份旧迁移夹具仍比较原 SQL 与旧行，当前版本号改为 55。

整张槽表在任何 image、arm 或额度占用之前一次事务冻结。`CACHE` 的 slot 0 与 `CLIENT_IMAGES` 的 slot 1/2 分开写入，不能混成一次可借用额度。只有完整 schema-3 缓存包能提供本能力需要的实际运行元数据。schema-2 完整包保留，但不能授予这次缓存能力。顶层本地草稿回退不是 provider 成功。

## 精确文件清单

本分支移植并补了一条 UNKNOWN 不结算测试，均在 `services/api`：

- `services/api/src/aijian_api/prepared_generation_cache.py`
- `services/api/src/aijian_api/prepared_generation_cache_schema.py`
- `services/api/src/aijian_api/prepared_generation_routes.py`
- `services/api/src/aijian_api/prepared_generation_sources.py`
- `services/api/src/aijian_api/prepared_generation_store.py`
- `services/api/src/aijian_api/repository.py`
- `services/api/src/aijian_api/story_creation_cache.py`
- `services/api/src/aijian_api/story_film.py`
- `services/api/tests/prepared_generation_test_schema.py`
- `services/api/tests/test_prepared_generation_cache.py`
- `services/api/tests/test_prepared_generation_cache_guards.py`
- `services/api/tests/test_desktop_subscription_dispatch.py`
- `services/api/tests/test_dispatch_billing.py`
- `services/api/tests/test_media_budget_reservation.py`
- `services/api/tests/test_project_aspect_ratios.py`
- `services/api/tests/test_story_creation_failure_budget.py`
- `services/api/tests/test_video_recovery.py`

检查点里的桌面私有 client，本分支未改，留给界面代理：

| 文件 | 检查点相对 `d658377` | 接入点 |
| --- | --- | --- |
| `apps/desktop/src/generation-cache-preparation.ts` | 新增 258 行 | `parseGenerationSlotPreparations`；类型 `GenerationCacheSource`、`GenerationPrivateCache`、`GenerationSlotPreparation` |
| `apps/desktop/src/generation-cache-preparation.test.ts` | 新增 184 行 | 私有 parser 定向测试 |
| `apps/desktop/src/generation-preparation-client.ts` | 修改，+19 行 | `generationPreparationClient.prepareSlots` 把原登记 POST 到 `cache-preparations`，再交给 parser |

共享合同，本批不发布：

- `packages/contracts/openapi.json`（检查点相对 base 增加约 232 行）
- `packages/contracts/src/generated.ts`（检查点相对 base 增加约 116 行）

服务端私有解析在 `PreparedPrivateCache` 与 `validate_cache_snapshot`。它校验冻结请求、来源和产品摘要，不把路径变成授权。

## 消费者接入点与未接缺口

已在本分支、可由签名 TestClient 调用的消费者：

1. `POST .../cache-preparations` 在 image/arm 前原子冻结整表。
2. `StoryFilmService` 经 `preparation_for_arm` 读取该表。`STORYFILM_CACHE` 只读冻结快照；`CLIENT_IMAGES` 保持新生成，不改读后来的 bundle。
3. 缓存槽的 `claim_video` 直接拒绝，不把缓存请求变成新的 transport admission。

尚未接线，留给合同冻结后的 T3，本批不宣称完成：

- `prepareSlots` 未接入 main execution factory。
- 公共 PREPARED issuance 未改。
- 本地连续帧、明确 FAILED 后的下一版本未扩展。
- 桌面 parser 与 `packages/contracts` 生成类型未发布。

下一依赖：总控冻结本提案的请求、响应、错误码和 private/public 划界。冻结前界面代理不要按未发布的生成类型实现第二套协议；后端不再单方面改共享包。冻结后才把 OpenAPI 与桌面 parser 对到同一形状，并做真实 main/PREPARED 接线证明。
