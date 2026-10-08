# Resolver54 + rights 链修正的固定源码闭包

状态：`STATIC_VERSION_PINNED_CANDIDATE_NO_RUNTIME_QA_NO_C19_SYNC`。`MANIFEST.json` 固定 54 个路径及 SHA，54/54 文件复制哈希、AST、内部 import 闭包静态通过。53 个文件逐字取自 Resolver54 冻结快照；仅 `episode_media_assembly_store.py` 使用 DEV06 的同事务权利链修正，`72F72CFA...`→`2E18464B...`。`repository.py` 固定 repo30 `C2104917...`；当前作者树 repo31 `4032F9...` 是另一候选，不属于这个闭包。

## 与 Stage-A47 和 D152 的版本关系

Stage-A47 的 47 条路径中，46 条 SHA 相同，1 条 assembly store 改为 `2E18464B...`；Resolver54 比 Stage-A47 增加 7 条路径，精确名单在 `MANIFEST.json`。D152 与本闭包共享的四个 DEV06 路径目标哈希也在 `d152_four_shared_targets`：asset store `2954042D...`、selected reader `88A2CB4A...`、probe store `38CD2EEC...`、assembly store `2E18464B...`。不能再将旧 `72F72CFA...` 作为合包目标。

此文件集合是 Resolver import 闭包，不是可直接覆盖 D152 的完整运行包。D152 的 `__init__.py` 含版本，应保留而非覆盖为空文件；`provider_contracts.py` 保留 D152 基线，除非其 owner 另给变更；`product_export_output_verify.py` 的最终选择归 DEV08。DEV05 的 `main.py`、`sidecar.py`、`runtime_resources.py` 和公开路由接线在另一交付中。本闭包的 repo30 由 DEV01 与 QA 锁定迁移目标。

## QA 门

MGR02/QA01 须在隔离 profile 对新 store 的无决定、真实 CLEARED、后续 RESTRICTED、损坏 rights 历史链及无 ASV 拒绝作独立验证，并回读 artifact 持久状态；既有 Stage-A run04 的 4 资产长路径通过仍只是局部门，不能推断本修正、public assembly、resolver 正例或 MLT 成功。54 项静态闭包不执行 provider、FFmpeg、产品导入或数据库迁移。
