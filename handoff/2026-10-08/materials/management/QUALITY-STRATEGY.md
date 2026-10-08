# AIVORA / Aijian Studio 测试保留与最小验证策略（一期）

状态：独立 QA 只读审查；本文件不代表产品实现、测试通过或发布接受。

> 纠正记录：初版审查错误地只看了本规划工作树，并写成“当前没有业务测试”。该结论已撤回。真正审查对象是产品 P：`C:\Users\Administrator\Documents\sp\.cache\aivora-worktrees\only-ui-product-20260910`；本文件仍只在当前工作树输出。

## 1. 审查边界与事实

审查对象是产品 P 中的 `apps/studio-web/src`、`apps/desktop/src`、`services/api/tests` 和 `scripts/e2e`，范围聚焦一期“创建项目 → 故事输入 → 保存并重开”。本轮没有运行产品测试、原生测试、构建或部署，也没有删除、改名、降级或修改任何产品测试。

产品 P 的现状盘点（排除 `node_modules` 和 Python `__pycache__`）：

- `apps/studio-web/src`：46 个 `*.test.*` 文件；覆盖页面交互、工作区/adapters、来源导入/manifest、Story 页面、模型和 fake timeline 等。
- `apps/desktop/src`：18 个 `*.test.*` 文件；覆盖 API/contract、IPC/preload、sidecar、安全、用户数据以及 fake/recovery 故障合同。
- `services/api/tests`：78 个 Python 测试文件；覆盖项目/episode、source/story bible、artifact、task/workflow、迁移/恢复、Fake Provider、故障注入、权限/sidecar、ProductionBrief 和远程执行证据等。
- `scripts/e2e`：24 个文件（含 runner、seed、harness、fixture/config）；其中有 Electron provider smoke、episode workspace recovery、source-manifest/invalidation contract、headless recovery、媒体播放和 C3 native readiness。

因此，本次真正的保留审查是“从现有测试集中识别最小业务回归、平台安全/数据/迁移、开发 Fake 合同和机器绑定 runner”，不是从零创建测试目录。现有 `scripts/e2e` runner 可能写入 `.aijian-dev` 证据目录或依赖本机 Electron/Python/PowerShell 路径；这改变归类和运行门槛，不自动证明其可删除。

### 当前测试组与最小保留映射

- 创建/故事输入/保存重开：优先保留 `apps/studio-web/src/aivora/adapters/{projectWorkspace,sourceImport,sourceManifest,storyWorkspace,workspaceSelection}.test.*`、`workspace-flow.test.tsx`、`StoryPages.test.tsx`，并与 `services/api/tests/test_projects_api.py`、`test_ingestion.py`、`test_source_manifest*.py`、`test_story_bible*.py`、`test_repository.py` / `test_episode*.py` 组成跨层最小链。不能只保留 UI 快照或只保留 API 单测。
- 桌面安全与数据边界：保留 `apps/desktop/src/contract-boundaries.test.ts`、`sidecar-process.test.ts`、`sidecar-protocol.test.ts`、`e2e-user-data.test.ts`、`source-manifest-review-ipc.test.ts` 及 API 侧 `test_sidecar*.py`、`test_credential_vault.py`、`test_repository.py`。这些属于平台安全/数据合同，不因浏览器流程重叠而删除。
- Fake/故障/恢复合同：保留 `apps/desktop/src/e2e-*-response-fault.test.ts`、`fake-*-contract.test.ts`、studio 的 `fake-timeline-run-*.test.ts` / `*-operation-journal.test.*`，以及 API 的 `test_fake_*.py`、`test_fault_injection.py`、`test_task_ledger_recovery.py`、`test_task_completion_lease_expiry.py`。`REMOTE_UNKNOWN`、重复回调和租约边界必须有独立断言。
- 迁移与数据安全：保留 `services/api/tests/test_migrations.py`、`test_invalidation_migration_process_recovery.py`、相关 repository/task snapshot 测试和迁移 fixture；历史失败应进入失败证据而不是从集合中移除。
- 原生/运行器：保留 `scripts/e2e/electron-episode-workspace-recovery.mjs`、`electron-source-manifest-contract.mjs`、`electron-invalidation-contract.mjs`、`electron-headless-operation-recovery.mjs`、`electron-c3-native-readiness.mjs` 的语义；其中 C3 readiness、Electron 可执行路径、`.venv`、PowerShell、窗口尺寸和本机证据目录属于机器绑定运行器，必须单列本地工具/原生门禁，不能计入普通 API/浏览器覆盖率。

历史 AIVORA 证据必须单独保留：已知原生 run3 仍为 `FAILED`；历史 C3 API 全量曾为 `1338 passed, 3 failed`，修复后的定向结果不能替代全量复验。上述结果不属于本工作树当前测试集合，也不构成一期接受。

## 2. 保留、归档与拒绝标准

### 保留（进入仓库测试资产）

- 业务回归：创建项目、输入故事来源、持久化、重开后可解释恢复，以及版本/哈希/来源链不漂移。
- 平台安全、数据与迁移：IPC/Origin/令牌隔离、密钥不回传、路径与归档安全、迁移快照、N/N-1/N-2 只读拒绝、崩溃恢复。
- 开发 Fake 合同：Fake Provider、确定性 fixture、故障注入、幂等键、`REMOTE_UNKNOWN` 不自动重提、回调/取消/租约等状态合同。
- 必须可复现的 fixture manifest、SHA-256、版本与环境元数据；敏感原文、真实凭据、Cookie、签名 URL 和无授权媒体不得进入仓库。

### 归档/本地工具（不计入业务覆盖率）

- 绑定某台机器、外部 upstream 提交、开发者路径或本地依赖的 runner/探针；保留原始脚本和结果，但归到本地工具目录或证据归档，并标注不可作为跨环境回归门禁。
- 与当前输入/版本无关、仅重复同一历史结果的报告；保留唯一原始报告、哈希和来源，重复副本只建立索引，不复制为新测试。
- 历史失败和停止边界：原始失败必须保留，归档不能改写为通过。

### 不接受为删除理由

- 测试失败、覆盖率不达标、原生 runner 不稳定或某次定向通过。
- “与另一个测试相似”但没有比较输入、断言、边界和独立故障模型的证据。
- 机器绑定或历史证据的存在本身；这些只能改变归类，不能证明测试冗余。

## 3. 一期最小有意义测试集

以下是一期功能的最小集合；对每项给出应从现有测试中保留/组合的语义，不把同名或相邻测试直接判为重复。

| ID | 层级 | 最小断言 | 运行时机 | 可复用证据 |
| --- | --- | --- | --- | --- |
| P1 | 领域/契约 | 项目 ID、名称、语言、画幅、目标时长、schema/migration version 和默认状态符合契约；非法必填值被拒绝 | 每次相关代码变更 | 仅当契约、fixture、解释器和依赖未变时复用 |
| P2 | 持久化集成 | 创建项目写入唯一记录；故事输入写入原始哈希、规范化哈希、章节/段落和可追溯 SourceSpan；重复提交不覆盖旧版本 | 改动存储、摄取、来源映射、迁移后定向运行 | fixture 哈希和数据库版本未变时可复用；schema 变更即失效 |
| P3 | 重开回归 | 保存后关闭/重启，再打开同一项目；项目、故事输入、版本、来源映射和状态可解释恢复；不出现静默丢失或伪造成功 | 改动生命周期、数据库、恢复、保存或读取路径后运行 | 仅同一 build、数据库迁移、fixture 和恢复语义下复用 |
| P4 | 迁移/数据安全 | N→N+1 快照迁移可验证；旧版本不能安全写入时只读拒绝；快照/哈希错误阻断而不继续写 | 每次迁移/manifest/归档变更；RC 前矩阵运行 | 只读旧版本和快照字节未变时复用，任何迁移脚本变更即失效 |
| P5 | Fake 合同 | Fake Provider 只产生确定性结果；提交前崩溃、重复回调、租约丢失和远端未知均保留可解释状态；`REMOTE_UNKNOWN` 不自动重提 | 工作流/任务状态/重试/费用变更后定向运行 | Fake 版本、状态机和故障种子不变时复用 |
| P6 | 安全边界 | Renderer 不能取得本地端口/令牌/供应商密钥；路径、Zip Slip、恶意输入和日志泄密被拒绝/脱敏 | IPC、preload、导入、诊断包、日志或依赖变更后运行 | 不复用跨安全边界变更；保留带特征假密钥 fixture |
| P7 | 浏览器 E2E | 通过用户可见入口创建项目、输入故事、保存、刷新/重开，看到同一版本和来源摘要；错误态可见且不假报成功 | UI/IPC/API 契约变更后；PR smoke | 只能在同一浏览器矩阵、build、fixture 和可见入口下复用 |
| P8 | 原生 E2E | 干净 Windows 标准用户、中文用户名/长路径、关闭/异常退出后重开，验证安装、窗口、sidecar/IPC 和数据恢复 | 原生壳、安装、sidecar、生命周期变更后；RC/发布候选 | 需保留机器、OS、安装包哈希、日志和截图；不能用浏览器 E2E 代替 |

## 4. 运行分层与接受门槛

顺序应是“改动相关的定向测试 → 依赖边界集成 → 必要的原生/浏览器 E2E → 全量”。定向通过只说明局部结果；任何全量失败、原生失败或未运行都要原样保留并阻断相应接受结论。

- 定向：P1/P2/P5/P6/P7 中受影响项；开发反馈和 PR 快速门禁。
- 集成：P2/P3/P4/P5，覆盖真实 SQLite/迁移/恢复边界；变更持久化或工作流时必跑。
- 浏览器 E2E：P7，覆盖用户入口到重开；不能代替原生安全、安装和生命周期。
- 原生：P8；只在有明确授权、固定环境和可保存证据时运行。当前原生 run3 仍是 FAILED，不能接受。
- 全量：合并前/RC 或显式授权时运行全部仓库测试、迁移矩阵和必需 E2E；全量失败后，不得用定向通过、coverage、静态检查或删除测试求绿。

接受需要同时具备：结果为 PASS、输入/fixture/build 哈希可核对、失败为零或有正式可接受豁免、覆盖率门槛未降低、原生/全量要求已实际运行。未变证据只能复用同一输入、同一实现/构建、同一工具链和同一环境假设；任一条件改变，证据回到未验证。

## 5. 当前交付状态

- 已完成：纠正审查路径；只读盘点产品 P 的四个测试区域；识别业务回归、安全/数据/迁移、Fake 合同与机器绑定 runner 的分层；建立一期最小测试集合和证据复用规则。
- 未完成：本轮未执行产品测试、浏览器 E2E、原生 E2E、构建、部署或全量复验；没有形成任何新的 PASS 或接受结论。
- 独立结论：本文件与 `test-retention.json` 是质量策略/保留清单，不是产品交付或验收。准确 staged 候选清单到达后，再进行独立泄密/路径/哈希检查；在此之前不扩大上传范围。
