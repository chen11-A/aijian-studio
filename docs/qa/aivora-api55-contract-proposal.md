# API55 合同 v1

状态：总控书面冻结为 v1。沿用本文件原来的请求和响应，不另造协议。消费方 review 见 `docs/qa/aivora-native-contract-needs-20261109.md`，提交 `da003ce3091478e9ffed72ecede67ad3e6bdd0ba`（PR 23，只读，未合入，未改其文件）。

冻结后的生成物在 `packages/contracts/openapi.json` 与 `packages/contracts/src/generated.ts`。界面按这一份生成 schema 实现三个私有 desktop parser/client，不手写第二份 DTO。本分支不改 `apps/desktop` 或 `apps/studio-web`。

检查点 `166dc89d35d3cfab6f220a409b34a0874f38ee08` 已用 bundle 隔离导入，没有整包合并。

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

| 字段          | 约束                                                                  |
| ------------- | --------------------------------------------------------------------- |
| `target_key`  | 原 target key                                                         |
| `slot_index`  | 整数 0、1 或 2                                                        |
| `preparation` | `CLIENT_IMAGES` 或 `STORYFILM_CACHE`                                  |
| `cache`       | `CLIENT_IMAGES` 必须为 `null`；`STORYFILM_CACHE` 必须为下面的私有对象 |

`STORYFILM_CACHE` 只允许 slot 0，且仅当该 target 的原 `first_regenerate` 为 false。slot 1 和 slot 2 即使当时或之后写出完整 bundle，仍是 `CLIENT_IMAGES`，`cache` 为 `null`。已冻结的 `CLIENT_IMAGES` 不因后续新缓存改成 `CACHE`。

## 私有缓存对象

`PreparedPrivateCache`，`schema_version` 常量 1，`additionalProperties: false`：

| 字段              | 含义                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------ |
| `snapshot_sha256` | 规范化快照信封的完整性摘要，不是授权                                                 |
| `input_sha256`    | 原输入桶                                                                             |
| `request`         | 冻结的原 `CreateStoryFilmBody`                                                       |
| `sources`         | 原意图来源行，每行且仅有 `source`、`canonical_path`、`sha256`、`mime`                |
| `runtime_recipe`  | 冻结的实际运行配方，含原 `cap` 与 `actual_video`                                     |
| `parts`           | 恰好 `image`、`video`、`voice`；每项 `{ "sha256", "bytes" }`，`bytes` 为 1 到 80 MiB |

来源 SHA、运行配方、三个产品的 SHA 与字节数必须与冻结时的原请求和实际文件一致。替换可变 `bundle.json` 不改变已选快照。晚缺、损坏、同长度替换或链接替换在消费时停止。

`canonical_path`、快照路径和 descriptor 只给签名后的私有消费者复核。它们不是 renderer 授权事实，也不能当成公共 PREPARED 发行凭证。目录只可作拒绝边界。

## 总控冻结决议

- 私有响应 `kind` 是 `PREPARATIONS`。`cache`、`canonical_path`、`snapshot_sha256`、`runtime_recipe`、`parts` 只给签名后的 main。
- 公共 `PREPARED` 仍是另一个类型，最多带中性标签 `CLIENT_IMAGES` 或 `STORYFILM_CACHE`。上述私有字段不进入 `FilmGenerationExecutionResult`、preload 或 renderer。
- `cache-preparations` 的线上失败统一为 HTTP 409，`detail` 为 `INPUT_UNVERIFIABLE`。store 内部的 `EXECUTION_UNAVAILABLE` 在这条路由上也被收成这个 detail。现有 `generation-preparation-client` 的 `post` 把该 detail 映射成既有 `CREATION_INPUT_UNVERIFIABLE`。不为这条路由再加 cache 专用码。
- `video-arm` 继续返回原来的 `EXECUTION_UNAVAILABLE` 与 `ATTEMPT_ALREADY_RESERVED`。
- `claim_video` 的 `EXECUTION_UNAVAILABLE` 经 `StoryFilmService` 仍变成 `CREATION_EXECUTION_UNAVAILABLE`。这个消费码保留，不与 arm 的裸码合成一个新枚举。
- `UNKNOWN` 留在原失败桶。提高 N、新 execution、新 offer、输出 SHA 或临时路径都不能解锁。缓存读取不结算它。
- `NOT_NEEDED` 没有 execution，零账号、零 API、零 provider，绝不调用 `prepareSlots`。
- 新 main 路径是：注册 → `prepareSlots` 整表冻结并验证 → 才 image/arm。这条新路径失败后不能降级到旧的未冻结路径。
- 服务端对从未调用过 `cache-preparations` 的旧 execution 仍允许原 image/arm。这是兼容，不改旧数据，也不代替新 main 路径的顺序义务。

## 公共槽表与错误

公共发行槽表仍是现有中性登记合同。本冻结不改公共 PREPARED issuance 的字段。

`cache-preparations` 的预期失败统一为 HTTP 409，`detail` 为 `INPUT_UNVERIFIABLE`。覆盖登记不符、快照不可核验、来源变化、账号/项目/退役，以及在已有 image/arm/额度之后再冻结。该响应不发起 provider POST，不新增预算尝试。

既有 image/arm 路由保持原错误码，不把它们折叠进缓存成功：

| 码                                                                                          | 何时保留                                                            |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `INPUT_UNVERIFIABLE`                                                                        | 缓存槽借用原请求、来源或 regenerate 事实不符                        |
| `EXECUTION_UNAVAILABLE`                                                                     | 错账号、错 body、退役，或对已冻结缓存槽申请新的 transport admission |
| `ATTEMPT_ALREADY_RESERVED`                                                                  | 同输入桶已有 PENDING/UNKNOWN；提高 N 或新 execution 不能解开        |
| `UNCONFIGURED` / `INPUT_FAILURE_LIMIT` / `VIDEO_UNCONFIGURED` / `VIDEO_INPUT_FAILURE_LIMIT` | 原额度门                                                            |

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

| 文件                                                    | 检查点相对 `d658377` | 接入点                                                                                                                 |
| ------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `apps/desktop/src/generation-cache-preparation.ts`      | 新增 258 行          | `parseGenerationSlotPreparations`；类型 `GenerationCacheSource`、`GenerationPrivateCache`、`GenerationSlotPreparation` |
| `apps/desktop/src/generation-cache-preparation.test.ts` | 新增 184 行          | 私有 parser 定向测试                                                                                                   |
| `apps/desktop/src/generation-preparation-client.ts`     | 修改，+19 行         | `generationPreparationClient.prepareSlots` 把原登记 POST 到 `cache-preparations`，再交给 parser                        |

冻结后由本分支发布的生成合同：

- `packages/contracts/openapi.json`
- `packages/contracts/src/generated.ts`

服务端私有解析在 `PreparedPrivateCache` 与 `validate_cache_snapshot`。它校验冻结请求、来源和产品摘要，不把路径变成授权。

## 消费者剩余接线义务

服务端已经可以由签名 TestClient 调用 `cache-preparations`，`StoryFilmService` 会读取冻结表，缓存槽的 `claim_video` 在新的 transport admission 之前拒绝。这些不是 main 已经接上的证明。

界面代理尚未完成、且仍由界面代理拥有的文件：

- `apps/desktop/src/generation-cache-preparation.ts`：按生成 schema 实现 `parseGenerationSlotPreparations`。检查点里的 258 行只作对照，不整文件覆盖。
- `apps/desktop/src/generation-cache-preparation.test.ts`
- `apps/desktop/src/generation-preparation-client.ts`：增加 `prepareSlots`，POST 原登记到 `cache-preparations`，再交给上面的 parser。现有 `post` 对 `INPUT_UNVERIFIABLE` 的 `CREATION_INPUT_UNVERIFIABLE` 映射保持不变。

新 main 顺序：

1. 显式 fixed-input 回执，或同账号/项目 READABLE shot-frame。未知自动输出在注册前拒绝。
2. 注册原 execution。
3. `prepareSlots` 冻结整表并验证。失败停在 `CREATION_INPUT_UNVERIFIABLE`，不能改走未调用 `prepareSlots` 的旧路径。
4. 之后才 image、arm 和额度。

`NOT_NEEDED` 停在第 1 步之前。PR 23 的 fixed-input / shot-frame 只覆盖第 1 步的一部分；offer 接线与 toolchain 验证仍未完成，不能写成已验收。第 3 步还没有接到 main factory。公共 `PREPARED` 目前仍固定为 `CLIENT_IMAGES`，把真实 `STORYFILM_CACHE` 标签交到公共面是冻结后的接线，不是本提交。

本地连续帧和明确 FAILED 后的下一版本不在本轮。

## 当前头核对与下一片接线（不在本轮接）

核对头 `33269cef109493c621088865f5103b4455e3da0d`，分支 `cursor/aivora-api55-cache-boundary-93a6`，PR 22 未合入。这一节只整理已有证据和冻结合同，不接 main，不等待总控 diff 结论之外的实现。

### 已有 CI

`33269cef` 的检查在本次核对时仍是 `QUEUED` 或 `IN_PROGRESS`，没有终态，不能写成通过。上一头 `4064b34754dea43e554544997574bce09a0a20ee` 的 [run 42735239857](https://github.com/chen11-A/aijian-studio/actions/runs/42735239857) 与 [run 42735232732](https://github.com/chen11-A/aijian-studio/actions/runs/42735232732) 都是 quality（ubuntu-latest、windows-latest）在 Lint 失败，签名是 Prettier 四个文档。`33269cef` 只重排这四个文件。这不是原生测试结论，也不是完整门通过。`babefa9` 的 CI 42420151861 只证明上一批，不借给本头。

### 已有 API55 定向证据

两组缓存测试不相加：新增用例前 `57 passed in 31.24s`；只跑 6 个新用例加已扩展 UNKNOWN，候选 `1227af51`，`7 passed in 20.15s`。完整 Python 门仍是 `143 failed, 5204 passed, 6 skipped, 100 errors in 1960.27s`，退出码 1，覆盖脚本没进。身份门在 `6bb54bb` 与 `1227af5` 上同断言失败，本头已 revert `dd55bbc4`，补丁在 PR 24，未合入，不能写成 Windows 已修。

### 下一片可调用的已生成类型

生成物已在本头，操作名 `prepare_cache_slots_api_v1_projects__project_id__prepared_generation_executions__execution_id__cache_preparations_post`。

| 生成名                   | 角色                                                     |
| ------------------------ | -------------------------------------------------------- |
| `PrepareCacheSlots`      | 请求。唯一字段 `registration: RegisterPreparedExecution` |
| `PreparedSlotCacheFacts` | 200 响应。`kind` 常量 `PREPARATIONS`                     |
| `PreparedSlotCacheFact`  | `target_key`、`slot_index`、`preparation`、`cache`       |
| `PreparedPrivateCache`   | 仅 `STORYFILM_CACHE` 的 slot 0。`schema_version` 常量 1  |
| `PreparedCachePart`      | `parts` 里 `sha256` 与 `bytes`                           |

生成 schema 只列 200 与 422。线上 409 `INPUT_UNVERIFIABLE` 不在生成响应里，接线仍走现有 client 的 `CREATION_INPUT_UNVERIFIABLE`。请求头沿用 `Idempotency-Key`（`story-film:v1:` 加 36 位）和 `X-Aivora-Generation-Account`。服务端实现是 `prepare_cache_slots`，响应模型 `PreparedSlotCacheFacts`。

### 调用顺序与兼容

1. `NOT_NEEDED` 在注册前结束，零 execution，不调用 `prepareSlots`。
2. 注册 `POST .../prepared-generation-executions`，体为 `RegisterPreparedExecution`。
3. `prepareSlots` 把同一份登记 POST 到 `.../{execution_id}/cache-preparations`，整表冻结。失败停在 `CREATION_INPUT_UNVERIFIABLE`，不能改走未冻结路径。
4. 之后才 image-dispatch、video-arm 和额度。arm 仍是 `EXECUTION_UNAVAILABLE` / `ATTEMPT_ALREADY_RESERVED`。缓存槽 `claim_video` 仍变成 `CREATION_EXECUTION_UNAVAILABLE`。

从未调用过 `cache-preparations` 的旧 execution 仍走原 image/arm。这不免除新 main 的顺序。

### 文件归属

| 归属                              | 文件                                                                                                                                               | 本头状态                                          |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 后端，已在本头                    | `prepared_generation_routes.py`、`prepared_generation_cache.py`、`prepared_generation_store.py`、`prepared_generation_sources.py`、`story_film.py` | 可审，未接 main                                   |
| 后端，已生成                      | `packages/contracts/openapi.json`、`packages/contracts/src/generated.ts`                                                                           | 已发布                                            |
| 界面，本头未实现                  | `apps/desktop/src/generation-cache-preparation.ts` 与其测试                                                                                        | 检查点有对照，本头没有这两个文件                  |
| 界面，本头已有但无 `prepareSlots` | `apps/desktop/src/generation-preparation-client.ts`                                                                                                | 现有 `post` 已映射 `CREATION_INPUT_UNVERIFIABLE`  |
| 界面，下一片才接                  | `apps/desktop/src/film-generation-execution.ts`                                                                                                    | 本头不接。公共 `PREPARED` 仍不携带私有 cache 字段 |

等总控 diff 结论后再接线。本轮不改 desktop，不合 PR 22，不合 PR 24。
