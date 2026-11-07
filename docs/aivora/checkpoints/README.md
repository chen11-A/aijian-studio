# 未纳入验收的续接检查点

这两份 Git bundle 只保存未完成工作，不参与运行、编译或本批验收。它们保留原提交和分支；基础提交已在验收分支历史内。原工作目录也已提交且干净。

- frontend-auto-source：939b4c9。仅已证明旧首帧来源恢复；原手工 film:still 产物缺证明的兼容通道未完成，禁止直接当成全部来源支持。
- backend-cache55：166dc89。API55 缓存/私有客户端检查点；main/public issuance、连续帧和明确失败后下一版本未接完，最终完整门未验。

恢复前先阅读各检查点 QA 与 manifest.json，运行 `git bundle verify <bundle路径>`。需要续接时用 `git fetch <bundle路径> <manifest里的ref>:refs/heads/handoff/<新分支名>` 导入为新的本地分支，再创建隔离工作目录。不要直接合入验收分支或覆盖现有分支。

manifest.json 记录完整 commit/base/ref、文件大小与SHA256。检查点的定向测试成功不代表完成最终联合验收。
