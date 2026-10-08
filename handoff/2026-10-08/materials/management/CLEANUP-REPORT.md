# 仓库与本地整理记录

更新：2026-09-17。

- 12 个旧 SP 岗位任务已从活动列表归档；聊天历史可恢复。应用没有提供永久删除历史的工具。
- 60 个旧工作区已整体移入 `Documents/sp-archive/20260917-reorganization/retired-worktrees`，其中未提交文件和忽略目录随原目录保留。
- 62 个旧本地分支已删除。删除前核对分支 SHA 并验证完整 Git bundle；保留的基础分支及新候选分支见归档目录清单。
- 22 个历史运行、浏览器验收和旧调度缓存目录已整体移入 historical-cache；services/api/0、1 两个误重定向文件按原 SHA 校验后移入归档。
- 5 个过时远端分支在远端引用备份后删除，删除使用精确旧 SHA 保护并发变化；旧演示 UI 草稿 PR #2 已关闭。远端暂保留 main、当前产品基础分支、主仓库在用工具链分支和仍开放的文档 PR #1 分支。
- `012b/sp` 被进程占用，移动未成功，原目录仍保留；没有强杀进程或强制清空。
- 产品 P、集成依赖目录、H87 历史选定源、总控证据目录、主仓库既有改动和所有新岗位目录均保留。
- 新建 `Documents/AIVORA` 统一入口；product/teams/archives 是目录联接，production/management 是整理后的文档副本。

## 应用自动清理的边界

旧任务归档时，应用自动清除了 8 个关联工作区（332d、6414、6d37、8253、829e、838d、a0f9、c177/sp）。这是应用归档动作的附带行为，早于手工整体归档。应用生成的 `refs/codex/snapshots` 及可达历史已纳入本地 Git bundle；无法据此保证这些已清除目录中的全部 ignored 文件得到保留。因此不能声称所有旧目录都完整备份。当前正式产品和总控原始失败证据仍在。

完整历史备份：`C:/Users/Administrator/Documents/sp-archive/20260917-reorganization/all-history-before-cleanup.bundle`。

SHA-256：`ec37b9d4d288b23085f875690338c9ece82f544fbf8496fea49c7cd3c06e64b3`。

8 个应用快照另已导出为 app-snapshots/*.zip 并记录 SHA，便于直接恢复可见文件。远端删除前的完整引用另保存在 verified-remote-heads.bundle，验证和哈希记录同目录。

这些 bundle、归档工作区、原始日志、数据库、凭据和机器相关文件仅在本地保存，不上传公开仓库。远端分支与开放 PR 已单独核对，未把本地删除等同于远端删除。
