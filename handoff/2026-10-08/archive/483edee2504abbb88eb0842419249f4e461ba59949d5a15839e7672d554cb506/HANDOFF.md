# DEV06 公开媒体源码 v2：静态交接与拒绝用例

状态：`STATIC_SOURCE_CANDIDATE_NO_C19_SYNC_NO_RUNTIME_QA`。`PACKAGE.json` 固定 7 个源文件的 c19 旧状态、v1 路由包 SHA 和本轮最终 SHA；7/7 源码复制后哈希与 AST 解析通过。旧 AF85A22 路由包保留为历史，不再是目标版。相对长路径首包，`episode_media_assembly_store.py` 的目标 SHA 改为 `2E18464BAE6D0DC07383A4A15CDC804999F15F73D12B2974BF727089AADCC610`。

## 代码变化

- `media_asset_probe_routes.py`：POST 在取 FFmpeg/ffprobe 工具链前，先从同一个 store 读取选中 ASV。缺席返回 `ASSET_VERSION_NOT_FOUND` 404，非视频或既有证据冲突返回 409，读库未知返回 503；只有真实视频选中版本通过后才请求工具链并持久 probe。持久写入的重查、原字节校验和不可变冲突仍由 `media_asset_probe_store.py` 执行。
- `episode_media_assembly_store.py`：在当前读写事务里调用 `_validated_history`，核每条人工决定的版本、媒体 SHA、revision、前序链接、证据／请求哈希及 head。空链是 `PENDING_REVIEW`，最新 `RESTRICTED` 写入拒绝；链损坏返回 `RIGHTS_CHAIN_INVALID`，不再信任资产表旧 `rights_status` 字段或仅凭 head 行推断批准。
- `episode_media_assembly_routes.py` 仍维持原 public GET 与认证桌面 POST 接口。POST 使用仓库 artifact 事务持久化；没有真实 authored 版本时 GET 为 404。`media_asset_routes.py` 保持 c19 原 `931D14F8...`，本包不改。

## 给 MGR02 的隔离 QA 用例，尚未执行

1. 无 writer 的 probe POST：403；无真实 ASV：404，确认工具链 provider 未被调用；真实 image ASV：`VIDEO_REQUIRED` 409，provider 未被调用；工具链不可用：503。真实 video ASV 需由 QA 导入原字节，probe POST 后 GET 比对同一持久证据及 SHA。
2. assembly POST 指向不存在 ASV：404，确认 artifact 未增加；真实 ASV 无权利决定：`PENDING_REVIEW`、`rights_decision_id=null`，`export_status=NO_EXPORT_CLAIM`。此状态按现有 draft 合同仍可能显示 `DRAFT_VIDEO_PREVIEW`，绝不能解释为正式权利批准或 TEST CLEARED。
3. 注入隔离库中 revision/head/前序链接/媒体 SHA 任一损坏历史：assembly GET/POST 应给 `RIGHTS_CHAIN_INVALID` 409，POST 不产生 artifact。真实人工最新 `RESTRICTED`：POST 为 `RIGHTS_RESTRICTED` 409；已存版本读回应为 `BLOCKED_RIGHTS`。只有经真实 reviewer 创建的逐 ASV 决定可作正例。
4. 加 audio segment 的公开 assembly 目前仍为 `BLOCKED_MEDIA_PROBE`。`inspect_selected_test_wav` 只定义固定 QA02 TEST 的 48000/240000 样本 WAV；它在 `mlt_test_selection_resolver.prepare_test_selection` 消费，不是公开 assembly 的通用音频证明。音频正式状态须另定合同和真实消费，不能由该两条 TEST 检查推断。

## 接线依赖

本包 + 13 件长路径包 + 当前 c19 的直接本地 import 静态检查只缺 DEV05 的 `runtime_resources.py`。DEV05 须在 `main.py` 正确注册公开 assembly GET、认证桌面 rights/probe/assembly POST，并提供 pinned toolchain provider；`sidecar.py` 认证边界由 DEV05 核。DEV01 须定版 repository schema30 或后续 schema31，并由 MGR02 验隔离迁移。本轮无产品 import、构建、数据库运行、媒体 probe 或 MLT。
