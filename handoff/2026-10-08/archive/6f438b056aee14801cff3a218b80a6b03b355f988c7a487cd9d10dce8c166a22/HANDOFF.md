# DEV04 素材与时间线 UI 交接（2026-09-29）

作者树：`C:\Users\Administrator\.codex\worktrees\s2-q1-g1-d00-default-deny-59f-20260923\sp`。本次只修改 DEV04 UI；各文件的 `.before`、`.after` 和 `.patch` 同目录保存。没有运行测试、构建、可见 UI、provider 或 c19 验收。

| 文件 | 修改前 SHA-256 | 修改后 SHA-256 | 本次差异 |
| --- | --- | --- | --- |
| `MediaPages.tsx` | `F90C46C62BE7CF5CC1C8123187D74F3E3157E4D3D88840AED7D0556BEE0A7B06` | `62A192082AF6E63F28191C5F96D5380DB4F6B2DED264120EDD7BF9693365E6D3` | 真实组装入口缺项目或剧集时显示选择入口，避免落到旧时间线。 |
| `EpisodeMediaAssemblyPanel.tsx` | `5838566B533CEC2A2C6484833420F19320CAE8A3DC07625FBD56CFEBC2074BC5` | `6D016745B4956AFD1F920EB657B9BA153EB0D8729EA45BA5FC27B1C2EED07F23` | 保存回执后保留待核对记录，自动只读重新读取；只有读回同一内容和 CAS 父版本才解除写入锁。 |
| `SceneAndAssets.tsx` | `7B9F1842292C101FE5B32E9F0F82A36D6CF5F8AD30FA7A1C7EF22430D9E0C03F` | `AB4A0F67AF169F5A8DB46CA14F523178352678E6EB9C797BD3962323BEF712F0` | 无项目时不展示样例；按项目重新挂载真实素材页；旧项目抽屉不能继续写；未知写入持久锁定，刷新和重开不清锁。 |

`TimelineWorkbench.tsx` 未改，SHA-256 `7086751987EFB2ADE28124A1328F201EBB55526174423E8B9F3CEB1AE6AD6579`。静态差异检查没有空白错误；未执行 TS 编译或 UI 验证。

## QA 可执行样本与记录

1. 使用隔离 Electron profile 在 QA 自有环境创建或选择**真实**项目 P、真实剧集 E。先清空选择，进入素材和组装页：必须提示选择项目或剧集，不能出现内置样例或旧开发时间线。再选 P/E 并进入素材页。
2. 导入一份真实图片 I（建议小于 32 MiB），按本地权威列表记录 `project_id`、`episode_id`、`asset_id`、`asset_version_id`、`sha256`、`byte_size`、`availability`、`rights_status`。记录来自实际回执，不能用静态 fixture ID 替代。点击预览、查看详情、引用到 E，刷新和重开后核对上述身份与引用版本。另用真实 `video/webm` 和 `audio/wav` 或 `audio/mpeg` 原件核对播放器打开、解码错误与 32 MiB 上限；播放仅证明原件可播放。
3. 只有 I 的版本已 `VERIFIED` 且权利非 `RESTRICTED` 时，在 E 的静帧轨加入 I、设置整数帧数并保存。记录 `artifact_id`、`version_id`、`content_hash`、`head_revision`、`parent_version_id`、媒体引用的三个身份字段和 `playback_status`。保存回执出现后必须重新读回；读回完成前不可再保存。切换到另一项目、切回 P 并重开应用，核对同一版本与修订、帧序和素材引用。
4. 对照无素材、缺失或损坏、未校验、受限权利、旧版本、错误项目或剧集、CAS 旧修订 409、格式错误回执和 `REMOTE_UNKNOWN`。错误身份不得显示为可播放；未知保存只能按原项目/剧集只读查询，不重复创建版本。素材写入未知时，刷新、切项目、重开仍应锁定新写入；保留原始回执和本地记录。
5. 开发 Fake 时间线另记 `version_id`、`content_hash`、`revision`、任务 ID 和开发导出 `operation_id`；只核它与当前真实开发时间线身份匹配。它不是集级静帧装配版本，也不是正式导出。`MltPreviewPanel` 当前传入 `identity=null`、`gateway=undefined`，打开原生预览应不可用。

## 仍需接口与验收

- 素材未知写入的安全解锁缺少可持久关联的操作 ID、按原操作查询和权威结果匹配接口；本 UI 保守留锁。DEV06/IPC owner 需定义该合同，不能靠刷新列表推断原写入未发生。
- R2 媒体探测与权利写入、集级装配新路由及正式导出新路由的 bridge/renderer 同版本接入需由相应 owner 核对。静帧播放器、开发 MP4、原件预览、MLT 宿主和正式成片分别验收。
- QA03/c19 的隔离 Electron 实测、真实媒体读回、CAS 冲突和重开验证尚未执行；本交接仅包含源文件与静态核对。
