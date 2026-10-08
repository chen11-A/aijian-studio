# QA_ONLY_NEW_EMPTY_DB — MLT TEST 剧本 delivery 夹具补丁

日期：2026-09-28。此目录只供 c19 的全新隔离 TEST 数据库验证 ART04 合成工程。它不属于产品候选或发行集成；不修改 c19、作者活树、正式作品或用户数据库。

## 文件与冻结身份

| 文件 | 用途 | SHA256 |
| --- | --- | --- |
| `episode_script_contracts.c19-original.py` | 从 c19 原文逐字复制的备份 | `057DC8290593356CD941BF0D2E34DC721BD1BEA4392FA387EDED8CFAE1F0554D` |
| `episode_script_contracts.py` | 仅增加 `delivery` 字段及 DIALOGUE/ACTION 校验的 QA 文件 | `6AA2D75E4E3CDA825846A840EEF1ED66DA3F9E565B73CF39A76DE607E682FE20` |
| `delivery-only.diff` | 上述两文件的逐行差异 | `E1A77496F0EDD4796043FB37279546ADDA90ACB8A08B3AD73583781E006B8083` |

改动只在 `EpisodeScriptBlockV1`：`delivery` 可取 `ON_SCREEN` / `OFF_SCREEN`；DIALOGUE 必填，ACTION 必须为空。`EpisodeScriptContentV1` 的字段与旧 c19 完全相同。它不引入作者完整合同中的 `story_bible_version_id`、`source_extraction_version_id` 或 `source_proposal_acceptance_id`，因此不让旧 store 接受未经验证的来源声明。

## 固定依赖表

以下是制作补丁时 c19 的静态 SHA。由整合负责人装载前重新核验并保存旧件；只替换上述合同文件，其他文件沿用原件，尤其保留现有路由热修 `931D14`。

| c19 路径（`services/api/src/aijian_api/` 下） | SHA256 | 本夹具操作 |
| --- | --- | --- |
| `episode_script_store.py` | `EE203A8A9B6C0D3D127FD6C88D94DA33854AD9C0516B4D8B214E18B4D66D9A1B` | 保留；会将请求模型的 `delivery` 连同文本存入同一个版本并按同一规范内容哈希读回 |
| `episode_script_routes.py` | `27FBCECDF973F318F4AF747ACBE9061E757252402C2DC9D9C687E8E7934838A8` | 保留；已有 sidecar 写与确切版本 GET |
| `episode_script_schema.py` | `5D3F5D27777673EB301DD6EDD284E56CDCB767143D01C1D0F9922E8626E8F63A` | 保留；migration 24 已定义剧集作用域及写收据 |
| `repository.py` | `BB366B214157007E2CB906EEADDC895E1ED60AE95DC97D86BEE686F137710E69` | 保留；已注册 migrations 24/25 和剧集版本读写 |
| `main.py` | `BBC596FDD33BDBD18A2ABEE96524CFDDCDA8A9D11AAFA76FC03FD11232D0900F` | 保留；已有 public 读和 sidecar 写路由 |
| `sidecar.py` | `788E3942BC061D8AC48CDD950D6663DB7C72BDBA86C372FF677260C63C764E1C` | 保留 |

此 TEST 的剧本不填上游版本，故不依赖确认收据 migration 29、`episode_script_confirmation_*`、来源验收回读或主路由新增接线。`episode_script_schema.py` 不规定块内 JSON 字段；新稿由旧 store 的模型序列化、版本写入、规范哈希和确切版本读回完成闭环。

## 装载与验收边界

1. 仅由 MGR02/QA 的受控隔离窗口在**全新、无任何 `episode_script` 历史版本**的 TEST 数据库使用。先核 c19 文件 SHA 和该数据前置，再由环境正常迁移至现有版本；不得手改数据库或复用正式 profile。
2. 装载后 QA 独立核新合同 SHA `6AA2D75E…FE20`、其余依赖 SHA、现有路由热修，并验证包含 `delivery: "OFF_SCREEN"` 的两个精确 TEST 文本由旧合同的 422 进入新版本的 201；再按返回的 `version_id` GET exact，核 `project_id`、`episode_id`、两个 `block_id`、文本、`delivery` 和 `content_hash`。实际保存前不能填写任何持久 ID 或 SRT 哈希。
3. ART04 规格 SHA `4323DFEF3EEF9337BAF49A5118DE1397B4C2AFBE2E67768E133F87C950DDF16D`、四媒体清单 SHA `211DDD8872F1DE47A569849C7A6AE9763D125DF6BAE9F8416534976C5B83FF78`；TEST 提示音仍是非人声，状态保持 `DIALOGUE_SPEECH_NOT_TESTED`。

原有 `schema_version=1.0.0` 的 DIALOGUE 历史版本缺 `delivery`。新模型读取它会缺必填语义或规范哈希不一致；现有合同没有可区分旧稿形状的版本机制。正式产品需要另定兼容读取/版本化策略。本补丁不解决旧稿兼容，不可据此宣称产品修复或发行通过。

DEV02 只制作并静态回读此夹具包；未在 c19 装载、运行接口、迁移数据库、生成 SRT 或执行测试。
