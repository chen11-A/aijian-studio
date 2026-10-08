# SUB2API01 contracts 生成准备（只读）

状态：等待 DEV05 `provider_contracts.py` / `main.py` 路由 AUTHOR_FROZEN、MGR01/MGR02 独占写入窗口和单独正式放行。**未备份、生成、编辑或运行检查命令。**候选根固定为 `C:\Users\Administrator\.codex\worktrees\s2-q1-g1-d00-default-deny-59f-20260923\sp`；本准备不适用于 c19。

## 2026-09-24 只读现状

| 文件 | 当前 SHA-256 | 当前字节 |
| --- | --- | ---: |
| `packages/contracts/openapi.json` | `EDB34B24106D157B0A0D3CD550909676C013E542A030DB57327967D1D9D83E13` | 396629 |
| `packages/contracts/src/generated.ts` | `28EE0F30FA3F694AA91E83A324A6BB381A2DC682E37C380C3ABAF5D7FD3105EC` | 228893 |
| `scripts/export_openapi.py` | `C0707D4C719C347667113222FF7211AC4EA00132A89D6F4EB19A2159300F3F5E` | 4903 |

HEAD 为 `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`，`git status --short` 当前 47 路径。两个生成目标本来就显示 `M`，不得将其当作可覆盖的干净输出。当前 exporter 默认只写 `packages/contracts/openapi.json`；`--source-manifest-review` 是另一分支，不能误用。

## 获准后的单人顺序

1. 回核 DEV05 两文件冻结 SHA、MGR01/MGR02 写入窗口、所有目标/脚本/源 SHA、HEAD/status 和其他作者占用；任何漂移先停，不继承本表作为写入凭证。
2. 在本 QA work 目录保存三个真实源文件的原始字节备份（两个生成目标及 exporter），记录绝对路径、字节、SHA、mtime 和备份 SHA；备份复核一致且无并发变化后才开始。
3. 依次运行 `uv run python scripts/export_openapi.py`、`pnpm exec openapi-typescript packages/contracts/openapi.json -o packages/contracts/src/generated.ts`。每步分开保存原始 stdout/stderr/exit 和该步前后目标 SHA；一步失败即停，绝不执行下一步。
4. 完整审 `git diff -- packages/contracts/openapi.json packages/contracts/src/generated.ts`，同时按 JSON path、operationId、请求/响应状态和组件 schema 做语义清单；明确现有 02 operation schema、旧 Project/Fake 等合同及默认特性开关未被意外删改/打开。再回核全候选 HEAD/status、DEV05 源、exporter 和生成目标 SHA。
5. 有非预期差异或并发冲突即保留输出和备份，报告总控；不自动回滚、清理或覆盖别人的改动。若两步完成且差异受控，交前后哈希与完整 diff 给 MGR01/MGR02 审签。文件写入不等于运行时生效或产品验收。

任何与 DemoApp QA 或 c19 同步窗口重叠的情况先由测试经理排序；不在此准备阶段抢写入位。
