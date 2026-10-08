# QA02｜五输入进入 ART04 工程前的证据与阻断矩阵

2026-09-28，只读盘点。当前候选：`C:\Users\Administrator\.codex\worktrees\c19-trim-211c9e8-qa-20260923`，HEAD `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`，盘点时 `git status --short` 110 项。未写产品/DB，未运行 MLT 或 Electron。

## 已固定输入

五输入清单 `five-input-manifest.json` SHA256 `EE2166D379C1000D65138C12023209A9D535AEE17D707C04BB907B7823FB04E3`，目录 `C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\qa02-mlt-test-20260928\five-inputs-20260928T035901Z`。QA02 回查 5/5；QA01 独立字节/字幕审计 `QA01-FIVE-INPUT-AUDIT.json` SHA256 `C980A856853A28A0D903B08DC6396877F2A0E21FB4603C9FA0101AC732261C5E`，状态 `FIVE_INPUTS_BYTE_AND_TEXT_AUDIT_PASS_NO_MLT`。这只固定 QA 来源文件，不等于资产库导入、权利批准或运行检验。

| 输入 | 冻结字节与 SHA256 | 进入工程前的最小证据 | 当前阻断 |
| --- | --- | --- | --- |
| `v1-blue.webm` | 2619 B；`75FCA3022F0D4369175E5341505544D8AED1837C1DCE0899F35BF1D7EDB73947` | 同一 TEST project 的选定 `asset_id`/不可变 `asv_`/管理区字节 SHA 与长度；该版本最新人工作出的 `CLEARED` 决策 ID/修订/回读；绑定该版本、25 fps CFR、320×568、75 帧、无音轨的持久化 pinned ffprobe `mpe_`/probe SHA；`VERIFIED` 可用性 | c19 尚无权利决策、持久化 probe 与 TEST 绑定读取链 |
| `v2-red.webm` | 2542 B；`507DB639D74CAEBEAB3DFB9DDAD4EEA328A732D59794BEC7B49C66F51AB78AC4` | 同上，且与蓝源为不同 `asset_id`、`asv_` 和字节；叠化位置由 TEST mapper 的 `[50,75)` 固定 | 同上 |
| `dialogue-test.wav` | 96078 B；`E2C5F4AC222A67C22FC548275BB422A45FAEEAAB0A5EBAAED29CB0F1AFA37641` | 选定 `asv_`/管理区字节与长度；最新人工作出的 `CLEARED` 决策；独立冻结的 PCM S16LE/单声道/48000 Hz/48000 样本 inspection 原始命令、工具身份、输出、SHA 与所选版本绑定；同 TEST 脚本两块身份 | c19 默认 `PENDING_REVIEW`，没有音频 inspection 持久化入口；现有 `probe_local_media` 要求一条视频流，不能把它的 video probe 回执冒充 WAV inspection |
| `bgm-test.wav` | 480078 B；`590CC4A39EC6DE15C24C3EDEBB8F5754F3088BAD398932C7C194960453BBD7C4` | 同上，但为 240000 样本；与提示音为不同版本/字节；固定增益均为 0 millidB | 同上 |
| `subtitle-test.srt` | 130 B；`3561D5DF3229D71CE53F427C65A850DCF8C23BDFE0D7D9F03C8BC7D50DC81CDC` | QA fixture 清单中的准确路径/字节/SHA；与 TEST script version `ver_dcac90c5b9aa48b4be25a9cd097207c3`、content hash、两块 ID、1–2 秒/3–4 秒文字及时序一致；adapter 独立校验原件和清单 | 它是字幕旁路输入，不是 `media_asset_versions` 的 image/video/audio AssetVersion；不伪造 `asv_` 或权利决定。仍待 adapter 及可信解析入口 |

四项媒体的选定资产 ID、版本 ID、权利决策 ID、视频 probe ID、音频 inspection SHA 当前均**未给出**；不得用清单 SHA 代填。SRT 来源权利仍需按 QA 技术测试使用范围确认，但当前 AssetVersion/rights API 不覆盖字幕文件。

## 现行接口与缺口

- c19 的 `media_asset_schema.py` 有 `media_assets`、不可变 `media_asset_versions` 和 `(project_id, episode_id, asset_id, role)` 主键的 `media_asset_episode_references`；外键钉住确切 version。`media_asset_routes.py` 支持 octet-stream 导入、GET/list、episode reference；`media_asset_store.py` 以真实字节计算 SHA 并放入管理区，但导入时 `rights_status='PENDING_REVIEW'`，WebM/WAV 技术信息仅 `PENDING_MEDIA_PROBE`。episode reference 可留版本关联，但不能单独证明 TEST 执行的最终选定、权利或探测。
- c19 的 `media_probe.py` 与 `config/media-toolchain-lock.json` 提供 pinned ffprobe 的本地视频探测基础。锁定 profile 为 Windows Gyan 8.1.2，`DISTRIBUTION_STATUS=DEVELOPMENT_ONLY`；既有 QA 媒体解码不等于针对管理区 AssetVersion 的持久化 probe。该 probe 数据结构强制一条视频流，故 WAV 使用独立音频 inspection。
- 盘点时 c19 **没有** `media_asset_rights_*`、`media_asset_probe_store.py`/routes、`episode_media_execution_plan.py`、`media_execution_plan_contracts.py`、`mlt_execution_adapter.py`、`mlt_execution_worker.py`。作者 s2 工作树有这些源文件，四个执行源的 SHA 分别为 mapper `6E7DFC0DAF5534947269C0824658E381293D0D4742145F2DBD7DB5E686C756F1`、contracts `3499EFFC8983BC3EF2EF666B55C33116779458FA1EA8748302AC811F8B3A45B2`、adapter `318E7DC93678851D6415BCCED39DAE782DDFEF56D24F8C681528C0E9051269AD`、worker `1B262570AEF12D7DDBD08CE593A330E73A7498058A2E3EE751EE8FC30C9CB20C`。这不是 c19 已集成或构建通过的证据。
- s2 mapper 的 `build_art04_synthetic_execution_plan` 从 `FrozenEngineeringTestBindingsV1` 直接表示蓝 `[0,75)`、红 `[50,125)` 与 `[50,75)` `CROSS_DISSOLVE`。正式 C assembly 的业务重叠升级不列为此 TEST 前置。mapper 只比对传入的 TEST 身份和回执，不读取原始清单、管理区、权利或工具锁；adapter 的 `resolve_selected` 是回调注入。全树只见 mapper/adapter 定义而未见实际调用入口，因此需要同源可信读取和执行入口，不能由 QA 填回调伪造放行。
- s2 已有版本绑定的人工作出权利决策表/API 与只针对视频的 `probe-evidence` 表/API。它们及 DB 迁移/路由注册须由产品所有者同源集成和验证，不能把作者工作树路径直接当候选能力。`FrozenTestAudioInspectionV1` 目前是 QA 回执 DTO；并无已核实的数据库写入/读取链。

## 后续外置 QA 执行顺序（新门开启后）

1. **固定同源候选**：由版本/产品所有者给出 c19 新 HEAD、状态、所需模块及依赖/迁移/路由清单、源码与构建 SHA、唯一写窗；QA 只读核所有 import 可解析、工具锁和候选不漂移。首个缺模块/契约错误即停，保留 raw。
2. **固定管理区四版本**：在新隔离 TEST profile/DB 中，经现有 authenticated import API 各导入四媒体一次；每次保留请求身份、响应 201、GET/readback、管理区实字节 SHA/长度、`asset_id`/`asv_`、project/episode 关系、数据库完整性与重开回读。此为另一次经批准的写库 QA；本轮未执行。SRT 保持清单文件，不走不支持的媒体导入。
3. **权利与技术证据**：对每个 `asv_` 获取真实人工作出的、可回读的最新 `CLEARED` 决策及 exact ID/revision；没有决定就保持 `PENDING_REVIEW` 并阻断。对两个视频分别调用候选已注册的 pinned probe API、读回 `mpe_`/probe SHA/工具身份和 75 帧 CFR/无音轨。两个 WAV 用经审核的外置只读 inspection 命令取 PCM/声道/采样率/样本数，冻结 raw 和 SHA，并绑定 version ID 与原字节 SHA；不将本轮普通 ffprobe/解码结果充当这一回执。
4. **构造可信 TEST 绑定并做纯映射**：服务侧重新读取管理区、最新权利、probe/inspection、TEST script exact version 与 QA 五输入清单；组成四个不同的 `ExecutionMediaRefV1`。用真实数据喂 `build_art04_synthetic_execution_plan` 并核输出总 125 帧、双视频重叠/叠化、两条音轨与两条字幕；对 SHA/rights/probe/版本/字幕任一不一致做拒绝检查，保存 raw 与 exit。此步仍不运行 MLT。
5. **独立审 adapter/worker 与工具门**：确认可信 `resolve_selected` 回调只从管理区取得本地原件且返回同一 exact 版本/权利/inspection，fixture 五原件与字幕另验路径/SHA；静态/定向检查 adapter XML、worker 依赖和 `ProductExportSpec`/输出验证链。MLT runtime 的具体来源、版本、哈希、许可与运行批准另行固定。没有批准就停在 `PLAN_READY_NO_MLT`，不下载或启动 melt。
6. **未来有运行授权时**：仅按新单次运行计划执行，保存命令、环境、PID、stdout/stderr、退出码、产物 SHA；再用独立工具核 125 帧/5 秒、蓝红叠化、双音轨存在与听感、两条烧录字幕和可播放 MP4。`DIALOGUE_SPEECH_NOT_TESTED` 始终保留，不把提示音说成对白语音或口型证明。

每一步明确承接前一步的真实 ID 与 SHA；失败、超时或结果未知时停止并保留原始证据，不自动重试、重提交或人工补写成功回执。当前终态仍为 `FIVE_INPUTS_FROZEN_NO_MLT`，后续各门未通过。
