# c19 受管媒体长路径静态接线候选

状态：`STATIC_REVIEW_CANDIDATE_NO_C19_SYNC_NO_RUNTIME_QA`。`PACKAGE.json` 固定 13 个文件的 c19 旧 SHA（或缺席）与新 SHA。源码取自 Stage-A 47 项冻结闭包，复制后 13/13 哈希匹配；13/13 AST 解析通过。六个长路径源码的本地导入依赖闭包共 43 个模块，候选文件与当前 c19 基线合看无缺失模块。这些检查不证明导入、迁移或 API 运行。

## 基线与调用

- c19 HEAD 为 `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`。当前 `main.py` SHA `BBC596FDD33BDBD18A2ABEE96524CFDDCDA8A9D11AAFA76FC03FD11232D0900F` 已在认证桌面分支注册 `create_media_asset_router`；`media_asset_routes.py` SHA `931D14F8B3D3069ED89E224C6BF4EBF2EE4CA9CA34DAFC9A6415CD2E1B3B8770` 与作者源相同。这两个文件不在候选复制清单中。
- `POST /api/v1/projects/{project_id}/assets/import` 和版本导入经旧 route 调用新 `MediaAssetStore.import_local`。新 store 在受管 staging 与 blob 的创建、硬链接、stat、打开、哈希和清理处使用 `managed_local_io_path`；资产 ID、ASV SHA 和数据库值保留逻辑身份。
- 资产 GET/list 经旧 route 调用新 store 的受管 blob 可用性检查；content GET 经 `read_verified_preview` 读取受管原字节。`media_asset_selected_reader.py` 提供单版本零写校验，不由此包新增 HTTP 端点。
- `media_asset_probe_store.py`、`media_asset_audio_inspection.py`、`episode_media_assembly_store.py` 随六源保留；当前 c19 未注册视频 probe、人工 rights 或公开 assembly 路由。复制这些 store 不会产生持久 probe、权利批准或装配 artifact。

## 迁移与 Owner

当前 c19 `repository.py` 为 schema26，SHA `BB366B214157007E2CB906EEADDC895E1ED60AE95DC97D86BEE686F137710E69`。候选 repo30 SHA `C21049176963798A3D0DE0748EAFD5FF41F0294C759939A31BDFD694C5C43DD8`，包含 27 权利、28 导出、29 剧本确认、30 媒体探针迁移。此文件归 DEV01；`episode_script_confirmation_schema.py` 和 `product_export_schema.py` 分属其它 Owner 的依赖。MGR04 在获得各 Owner 核对后，才可按 `PACKAGE.json` 的旧字节条件保护同步；MGR02 使用隔离库独立验证 26→30 迁移、create_app/sidecar 握手、旧资产路由和长短路径读回。不得在真实用户库上以静态闭包代替迁移验收。

## 已有证据与未闭合门槛

- QA02 run04 在隔离 schema30 profile 的长路径首关中完成四个 266 字符受管 blob 导入、资产与 selected `VERIFIED`、两 WAV 检查和私有 assembly 可用性；相对路径、UNC、遍历与重解析点输入被拒绝。该结果不包含 c19 接线后的运行。
- QA02 resolver 路径门证实短 DB／fixture 加长 blob 的边界；`prepare_test_selection` 完整业务选择和 MLT 原生执行未运行。
- 视频 probe 需要 schema30 持久表、已批准并锁定身份的 FFmpeg/ffprobe、probe 路由和独立运行。人工 `CLEARED` 需要 rights route、认证 reviewer 和真实逐 ASV 决定；run04 四资产均为 `NO_DECISION`。公开 assembly 需要 route、真实脚本与装配 artifact，并对 selected、rights、probe 的读回单独验收。当前包不声明这些门槛通过。
- `managed_local_io_path` 的祖先 lstat 与后续 I/O 不是原子操作；本地负例不证明并发 junction 替换已防住。

## 回退基线

本包未写 c19。将来若同步，`PACKAGE.json` 记录 11 个新路径的原始缺席状态及 `media_asset_store.py`、`repository.py` 的旧 SHA。回退只能依据当次同步和数据库迁移的独立收据决定；本候选没有执行回退，也不授权删除用户数据或倒迁真实库。
