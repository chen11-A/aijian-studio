# 公开媒体链路 DEV06 路由源码候选

状态：`STATIC_REVIEW_CANDIDATE_NO_C19_SYNC_NO_RUNTIME_QA`。`PACKAGE.json` 记录 6 个 DEV06 源文件在 c19 的原始缺席状态及候选 SHA。它们与 A runtime42 评审快照逐字一致；该快照本身标为评审候选，尚未冻结或 QA。本包只做源码交接，不改 c19。

## 调用接线

- `create_media_asset_rights_router(get_repository, trusted_review_actor)`：逐 ASV 人工权利决定写入、最新决定、历史和 operation receipt。只在已认证的桌面 sidecar 分支注册；批准值必须来自真实 reviewer 与真实版本。
- `create_media_asset_probe_router(get_repository, toolchain_provider, trusted_review_actor)`：POST 对选中视频运行 pinned probe 并持久化证据，GET 读回。需 schema30 与 DEV05 的 `runtime_resources.py`、已锁定 FFmpeg/ffprobe 身份及 provider。当前 c19 缺 `runtime_resources.py`。
- `create_episode_media_assembly_public_router(get_repository)`：公开 GET 装配读回；`create_episode_media_assembly_write_router(get_repository, trusted_review_actor)`：认证桌面写入装配版本。依赖首包的 assembly store/contract 和 repo30。由 DEV05 只在正确认证分支接入写路由。
- 当前 c19 `main.py` 仅注册旧资产 route931D；本包不修改 `main.py`/`sidecar.py`，也不会自行开放 HTTP 端点。

## 真实资料到 resolver 的边界

- 先完成 c19 13 件长路径候选与 DEV01 的 26→30 迁移、DEV05 的运行时接线，再在隔离 profile 导入真实 ASV、逐 ASV 人工权利决定、视频持久 probe、音频原字节 inspection、公开装配读写。QA02 run04 的四项权利均是 `NO_DECISION`，没有视频 probe。
- `episode_media_assembly_store._collect_checks` 当前直接查 rights head/decision 并校验媒体 SHA；它未调用权利链 authoritative reader。`_result` 对任意 audio check 固定给 `BLOCKED_MEDIA_PROBE`，即使 WAV inspection 已通过，公开装配也不能由此得到 `DRAFT_VIDEO_PREVIEW`。它对 `PENDING_REVIEW` 只报告状态，阻断条件是 `RESTRICTED`。公开装配的权利和音频状态语义须由产品 owner 明确并独立验收。
- `mlt_test_selection_resolver.prepare_test_selection` 是另一个固定 QA02 TEST 入口：按实际 selector 复读 selected、最新链校验的 `CLEARED`、两条视频持久 probe、两条 WAV 原字节 inspection 及 fixture/script，再形成 MLT 计划。公开 assembly artifact 不是该函数的输入。不要把 Stage-A run04 或本源码包称作 public assembly→resolver/MLT 成功。

## 复核与同步

MGR04 对受保护 c19 写入前，应核 `PACKAGE.json` 的旧 SHA/缺席与当前头，和首包、DEV01 repo30、DEV05 provider/main 接线形成唯一版本组合；MGR02 在隔离 profile 独立验 schema迁移、认证边界、route 可达、真实 ASV→rights→probe→assembly 读回。该包未运行产品导入、构建、数据库迁移、FFmpeg 或 MLT。
