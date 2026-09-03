# R03-A1：依赖失效报告只读边界

功能基线：`a6c1680a1c34246f707aa185ca80c13a013289ca`。当前整合基线为已接受的 Q0 HEAD `6cbebf8c5deb68fcdf027252de6e7316f36dfddb`，其中包含格式基线 `b2d64ce` 与 Q0 覆盖率提交 `6cbebf8`。本切片只公开 R02 已持久化的单份报告，不重算失效图、不变更账本、不自动重生成、不改变人工 Gate。

## 接口

`GET /api/v1/projects/{project_id}/invalidation-operations/{operation_id}`，OpenAPI operationId 为 `getInvalidationOperation`。

响应使用既有 `{data, request_id}` 包装。`data` 包含 operation/project/change artifact、前后 accepted version、Gate decision、assessment hash、创建时间和有序原因路径。持久化根记录的 `id` 显式映射为 `operation_id`；路径的 `id` 映射为 `path_id`。其他字段直接来自账本，不读取当前 head 来改写历史解释。

每条路径包括受影响 artifact/version、STALE/INVALIDATE 判定、aggregate/effective impact、dependency IDs、relationships、edge impacts、ordinal 和时间。三组原因数组必须非空且等长；路径必须属于响应根 operation/project；ordinal 从零连续。

## 安全和错误

- 复用既有项目作用域 repository reader、ID 格式、UUID request ID 和 ErrorResponse。
- 普通 Web 可以读取；Sidecar 必须先通过现有 token、Host、Origin 和 loopback 校验。此切片不改变认证策略。
- 缺失项目：404 `PROJECT_NOT_FOUND`。
- 未知 operation 或 operation 属于其他项目：相同的 404 `INVALIDATION_OPERATION_NOT_FOUND`，不泄漏其他项目的记录。
- 项目或 operation 路径参数格式错误：既有 422 `VALIDATION_ERROR`。
- 存储数据损坏、哈希不符、归属不符或时间/响应合同无效：500 `INVALIDATION_LEDGER_CORRUPT`，通用消息、空 details、retryable=false，不返回 SQL、路径或内部异常文本。
- 完整报告最多 10,000 条路径；canonical JSON 的 data UTF-8 字节最多 4 MiB。超过任一上限返回 413 `INVALIDATION_REPORT_TOO_LARGE`，不截断为看似完整的报告。此限制是响应上限，不声称限制既有 repository 在校验前的读取内存。
- DTO 禁止未知字段，时间必须带时区；精确 ID、哈希、枚举和原因链都在输出边界校验。

## 原子切片边界

Migration 15、R01 评估逻辑、R02 写入事务、不可变 trigger 和项目删除行为保持不变。缺失 operation 使用专用异常子类，禁止通过匹配异常字符串区分 404/500。

OpenAPI 和 TypeScript 仅从本机权威后端生成。此切片同步生成产物以保持合同检查通过；Web/Electron transport 尚不实现。

项目报告列表需要独立的数据库分页读取边界，不以全量读取后前端切片冒充分页。列表、UI、IPC、真实模型和报告导出均非本切片目标。

## 验收

- 真实 SQLite 经 Gate 生成报告，逐字段查询相等；重复查询、重开仓储结果稳定，账本和不可变图不变。
- 未知/跨项目/格式错误、损坏 hash/array/ownership/timestamp 分别证明失败关闭。
- Sidecar 校验先于报告读取；安全错误不泄漏内部细节。
- 路径/UTF-8 字节限制、DTO 约束及 OpenAPI GET-only 合同测试。
- 独立重跑定向、R01/R02、迁移/恢复及 API 全量，Ruff、Mypy、类型检查和生成合同检查。
- 本切片不改可见界面，因此不产生新的浏览器/Electron视觉通过声明；真实交互验收留给接入切片。

## 2026-08-28 历史候选验收记录：未通过当时总门禁

以下内容保留为当时 `a6c1680` 候选的失败证据，不是当前重放结论。

主控独立验证：专项 27 passed；R01/R02、迁移和提案回归 140 passed；API 全量 843 passed（381.08 秒，两个 413 常量弃用警告）。新增两个模块的行/分支覆盖率均为 100%。Ruff、Mypy（79 个源文件）、新代码格式、Python 编译、合同类型检查、生成幂等和既有 OpenAPI 不变检查通过；现有 43 份证据哈希通过。

当时总覆盖率门禁未通过：行 91.96%（要求 90%），分支 79.41%（要求 83.5%）；`task_ledger.py` 和 `task_ledger_recovery.py` 未达到关键模块 100% 要求。当时尚未重跑基线覆盖率，不能把“代码未改”直接当成“已证明基线同样失败”。旧 `artifact_invalidation_ledger.py` 的全文件格式检查亦失败，基线文件的格式检查也返回失败；相关旧代码未改动。后续 Q0 与本次 2026-09-03 重放结果见下节。

独立审查发现并修复了共享异常处理影响 Gate 写入的问题，改用 GET 专用 corruption 异常；测试夹具的触发器遮蔽和低效边界构造也已修正。复审无其他阻断性发现。

当时最终状态：尚未本地提交/整合，未推送，不上调路线图；按当时用户要求停止，不扩大到旧模块补测。Web/Electron 接入与真实视觉验收未做，当前切片没有界面变更。

## 2026-09-03 重放验收状态

- 当前候选基于 Q0 已接受 HEAD `6cbebf8c5deb68fcdf027252de6e7316f36dfddb` 重放；功能语义仍以 `a6c1680a1c34246f707aa185ca80c13a013289ca` 为基线。
- API 专项 27 passed，包含无效 `project_id` / `operation_id` 的 422；依赖回归 151 passed。
- 全局结果：61 files、931 passed、438.59s；行覆盖率 93.55%，分支覆盖率 `2061/2462 = 83.71%`。`task_ledger`、`task_ledger_recovery`、`invalidation_contracts` 与 `invalidation_routes` 的行/分支覆盖率均为 100%。
- Ruff/Prettier、Mypy（79 个源文件）、TypeScript typecheck、compileall、desktop 140、web 126、build，以及 43 份证据哈希均通过。
- OpenAPI 仅新增 1 个 GET 与 3 个 schema；重复生成已证明幂等，`openapi.json` SHA-256 为 `3CF947BE88BF1D64EF9DC287A6262D131B4AFBD09371111830A503D250E9DFE1`，`generated.ts` SHA-256 为 `920814FF04B3CFE9C4A262424A2B9E851C97364BB0A89DEEB887A77D7AFA29EE`。
- 413 限制的 canonical 计量对象仅为 `data` 的 UTF-8 字节，不包括响应 envelope 或 `request_id`。
- 候选共 8 个文件：本规格、`invalidation_contracts.py`、`invalidation_routes.py`、`artifact_invalidation_ledger.py`、`main.py`、`test_invalidation_api.py`、`openapi.json` 与 `generated.ts`。
- 没有 UI 改动，也没有 Chrome/Electron 视觉验收声明；Web/Electron transport 属于 R03-B，UI 属于 R04。
- 本地原子提交条件已满足，提交状态以 Git 历史为准；本切片未推送、部署、制作影片或通过人工 Gate。通过 Q0 覆盖率与 R03-A1 后端切片不等同于 48 周 Phase 0 或影片验收。

最终状态：R03-A1 后端切片的本地验收证据已满足原子提交条件；不代表已推送、发布或完成 48 周路线图。
