# 界面/原生消费需求与 API55 合同 review（2026-11-09）

状态：消费方书面意见，未把提案写成已发布协议。未改 `packages/contracts`，未改 `services/api`，未移植下面三个桌面私有文件。后端 PR [#22](https://github.com/chen11-A/aijian-studio/pull/22) head `095a0c50e58cbbb46c28aef438d9aa33610f219c` 只读对照，没有合并。

## 本片精确文件

本分支已经改动、且只属于界面/原生：

- `apps/desktop/src/film-generation-fixed-input.ts`
- `apps/desktop/src/film-generation-fixed-input-ipc.ts`
- `apps/desktop/src/film-generation-fixed-input.test.ts`
- `apps/desktop/src/film-generation-execution.ts`
- `apps/desktop/src/film-generation-execution.test.ts`
- `apps/desktop/src/film-generation-execution-preload.test.ts`
- `apps/desktop/src/film-library-ipc.ts`
- `apps/desktop/src/main.ts`
- `apps/desktop/src/preload.ts`
- `apps/studio-web/src/api/studio.ts`（仅本地桥类型，不是共享合同）
- `apps/studio-web/src/aivora/pro/actions/fixed-input-actions.ts`
- `apps/studio-web/src/aivora/pro/FixedInputImportButton.tsx`
- `apps/studio-web/src/aivora/pro/FixedInputImportButton.test.tsx`
- `apps/studio-web/src/aivora/pro/ProWorkspace.tsx`（只挂载导入按钮）

本片没有改、总控确认前继续不移植：

| 文件                                                    | 归属                                                            | 本分支状态                |
| ------------------------------------------------------- | --------------------------------------------------------------- | ------------------------- |
| `apps/desktop/src/generation-cache-preparation.ts`      | 界面/原生，后端已同意交出                                       | 不存在，未从检查点移植    |
| `apps/desktop/src/generation-cache-preparation.test.ts` | 同上                                                            | 不存在，未移植            |
| `apps/desktop/src/generation-preparation-client.ts`     | 同上；现有 `post`/`lineages`/`register`/`armVideo` 继续只读使用 | 未改，未加 `prepareSlots` |
| `packages/contracts/**`                                 | 后端生成                                                        | 未改                      |
| `services/api/**`                                       | 后端                                                            | 未改                      |

`generation-preparation-client.ts` 仍是 main 私有签名客户端。renderer 不 import 它。

## main 实际消费的接口

当前 main 工厂只使用已发布的准备客户端：

1. `POST /prepared-generation-executions` 注册。成功体只有 `execution_id`。
2. `POST /prepared-generation-executions/lineages`。只取同账号/项目的 READABLE `output_sha256` 与 `stage`，用来恢复 shot-frame 的原 creator，或拒绝未知自动输出。
3. 既有 `image-dispatch`、`image-observation`、`image-unsent`、`video-arm`、`retire`。

公共返回给 renderer 的仍是现有三种：`PREPARED`、`FAILED`、`NOT_NEEDED`。`PREPARED` 的 `preparation` / `slotPreparations` 在本片仍固定为 `CLIENT_IMAGES`，没有 cache 对象、`canonical_path`、`snapshot_sha256` 或 `runtime_recipe`。

手工 fixed-input 是另一条 main 私有通道，不是 prepareSlots：

- `film:still` 无 execution 参数时，main 对自己刚写的 `series/stills` 文件发一次性 `fio_` offer。offer 不是回执。
- `film:confirm-fixed-input` 只收 `projectId` 与 `offerId`。
- `film:import-fixed-input` 只收 `projectId`。文件来自 main 自己的对话框，再复制到新的 canonical still。
- 多出来的 origin、path、metadata、cacheHit 参数直接 `UNSUPPORTED_SCOPE`，不拿来授权。
- 回执绑定当前 account、project、backend project、series、role=`still`、realpath、sha256、MIME。已知自动输出即使有回执也不能当 fixed input。

`series/stills` 只作为拒绝边界。没有 READABLE shot-frame 事实、也没有上述回执的文件，准备结果是 `FAILED` / `UNSUPPORTED_SCOPE`，不注册 execution。

## 对提案的消费方 review

对照 `docs/qa/aivora-api55-contract-proposal.md`（PR 22 新增）和该 head 上的路由、store、`claim_video`。本意见同意提案的私有/公共分界，不另写一套字段。

### 可以沿用、且与当前 main 兼容的部分

- `cache-preparations` 的成功 `kind` 是 `PREPARATIONS`，不是公共 `PREPARED`。当前工厂的公共对象不会接收这个响应。
- 请求体只有当初那份 `registration`。当前 `buildGenerationRegistration` 已经是 main 持有的登记；fixed-input 没有往登记里加 offer、路径或 cacheHit。
- `CLIENT_IMAGES` 的 `cache` 必须为 `null`；`STORYFILM_CACHE` 只在 slot 0 且 `first_regenerate` 为 false。store 的 `freeze_preparations` 按这个形状拒绝。
- 私有对象里的 `canonical_path`、快照和 descriptor 留在签名后的 main。当前 preload 的 prepare/retire 仍只转发公共 scope。
- 整表在一个事务里写入 `prepared_generation_slot_preparation`。已有非 `UNSENT` stage、slot 或 video arm 时，store 拒绝再冻结，且这次插入本身不占用失败额度。
- `claim_video` 见到 `STORYFILM_CACHE` 行时抛 `EXECUTION_UNAVAILABLE`，发生在新的 transport admission 之前。
- 冻结不改 `story_creation_failure_attempt`。已有 `UNKNOWN` 不会被这次缓存读取结算成成功或失败。
- `NOT_NEEDED` 没有 execution id。当前 pipeline 分支在账号租约和任何准备 API 之前返回。它不能调用 `cache-preparations`。

### 建议总控冻结前写清的缺口

这些不是第二套协议，而是同一提案里消费方还不能安全接线的点。

1. **公共 `PREPARED` 与私有 `PREPARATIONS` 必须继续是两个类型。** 公共槽表最多保留已有的 `CLIENT_IMAGES | STORYFILM_CACHE` 标签。`cache`、`canonical_path`、`snapshot_sha256`、`runtime_recipe`、`parts` 不得进入 `FilmGenerationExecutionResult`、preload 或 renderer。现有工厂甚至还没有把标签改成真实的 `STORYFILM_CACHE`；那是冻结后的 T3，不是本片。
2. **`cache-preparations` 的失败线码要按路由看，不要按 store 内部异常看。** store 在“已经 image/arm 之后再冻结”时抛的是 `EXECUTION_UNAVAILABLE`，路由把它收成 HTTP 409 `INPUT_UNVERIFIABLE`。这和提案的统一失败码一致。现有 `generation-preparation-client` 的 `post` 会把 detail `INPUT_UNVERIFIABLE` 映射成桌面的 `CREATION_INPUT_UNVERIFIABLE`，把 detail `EXECUTION_UNAVAILABLE` 原样抛出。冻结时请写明：这条路由的消费方只准备接收 `INPUT_UNVERIFIABLE`，不要为它再加一个 cache 专用码。
3. **视频链上的缓存槽拒绝会再加一层前缀。** `claim_video` 的 `EXECUTION_UNAVAILABLE` 在 `StoryFilmService._before_creation_submit` 里变成 `StoryFilmError("CREATION_EXECUTION_UNAVAILABLE")`。arm 路由本身仍保留裸的 `EXECUTION_UNAVAILABLE` / `ATTEMPT_ALREADY_RESERVED`。总控需要指定 renderer 最终看到哪一个；界面不会自行把二者合成一个新枚举。
4. **“先冻结再 image/arm/额度”目前是 main 的顺序义务，不是所有 execution 的服务端前置。** `before_image` 并不要求已经存在槽表；没有调用过 `cache-preparations` 的旧 execution 仍能 image/arm。服务端只拒绝“先做过再补冻结”，以及缓存槽上的新 `claim_video`。T3 必须由 main 在第一次 `image-dispatch` 和 `video-arm` 之前调用 `prepareSlots`。漏调用不会被服务端挡住。
5. **`NOT_NEEDED` 明确排除在槽表之外。** 没有 execution，就没有 `cache-preparations`。零账号、零 API、零 provider 的现有路径不能为了补槽表而先注册 execution。
6. **`UNKNOWN` 仍只走原失败桶。** 提高 N、新 execution、新 offer、输出 SHA、临时路径都不能解锁。缓存晚缺应停在提案的 `INPUT_UNVERIFIABLE` / 缓存不可核验，不能改走新的 fixed-input 回执。
7. **桌面 parser 的形状以冻结后的 OpenAPI 为准。** 检查点里的 `parseGenerationSlotPreparations` 与 `prepareSlots` 在总控冻结前不移植。冻结后只实现提案这一个 `PrepareCacheSlots` / `PreparedSlotCacheFacts`，不在 `packages/contracts` 里并行手写第二份 DTO。

## 总控合同 v1（书面冻结，本片不接线）

总控已定，界面按此准备，不在未审的 fixed-input 片上实现：

- `PRIVATE PREPARATIONS` 和 cache 细节只给签名后的 main。公共 `PREPARED` 只带中性标签，不带 cache 对象。
- `cache-preparations` 的 HTTP 409 `INPUT_UNVERIFIABLE` 映射到既有 client 的 `CREATION_INPUT_UNVERIFIABLE`。
- arm 保留既有 `EXECUTION_UNAVAILABLE` / `ATTEMPT_ALREADY_RESERVED`。
- StoryFilm 消费保留 `CREATION_EXECUTION_UNAVAILABLE`。不新造枚举，也不把这些码降格。
- `UNKNOWN` 仍按原输入桶拒绝。
- `NOT_NEEDED` 零账号、零 API，没有 execution，就不调用 `prepareSlots`。
- 新的 main 路径必须在 register 之后完整验证冻结表，然后才允许任何 image/arm。冻结失败不得退回旧的未冻结路径。
- 服务端对旧 execution 的兼容保留，不默认强迫全部迁移。
- `generation-cache-preparation.ts`、其测试和 `generation-preparation-client.ts` 归界面。`packages/contracts` 仍由后端生成。
- 等本片 fixed-input 闭合并审合后，再做真实 main 接线。

目标顺序仍是：fixed-input 或 READABLE shot-frame，注册，`prepareSlots` 冻结整表，然后 image/arm。`NOT_NEEDED` 停在注册之前。本片只完成 fixed-input 与 shot-frame 恢复。
