# AC05 Panel 第二次单次组件 QA：2/7，首 RED 停门

日期：2026-09-28。MGR02 新单次批准 `AC05-PANEL-RUN02-ONE-SHOT-APPROVAL.json` SHA256 `9149B7B330E0059107A78499ECEC7EA44F200A17198E806EEE25F889153D94A3` 已消费。固定 wrapper 仅调用一次；没有 Web typecheck/build、Electron、provider 或重试。

- 原 `RECEIPT.json` SHA256 `8BBAD3FD392D1BD85A97B8F1858C54207796C03C96809AB217B61299C05EC6FD`：state `COMPONENT_RED`，wrapper exit `1`。组件 PID `8588`、exit `1`、未超时、清理状态 `NOT_REQUIRED`。原 `component.stdout.raw` SHA256 `FBF7D7086EB545BDB949E46BA6AEEE07FECC8E10096E0BB2FCD20BA9A5962DC1`；`component.stderr.raw` 为空，SHA256 `E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855`。
- `component.vitest.json` SHA256 `1C9F192E539696406948AE1CA2F9A8111E4B83294D9557F4CD1DEDE8BDA0C1DE`：7 total、2 passed、5 failed、0 pending。两项通过是 source context 与 project 切换时丢弃迟到自动 GET。
- 成功读回场景在外置脚本第 129 行失败：已找到“已只读取得原任务提案引用”和 `PROPOSAL_READY`，但脚本要求“读取来源抽取提案”按钮可用。测试 bridge 没有提供 `readVersionedSourceExtractionProposal`；Panel 源码还要求该能力才能启用按钮。这是该断言与测试模拟能力不匹配，不能据此判定自动回查失败。
- 四个 `REMOTE_UNKNOWN`、`NOT_FOUND`、错 run、错 project scope 场景在第 156 行失败：脚本要求授权按钮继续显示且禁用；Panel 在只读读回不可信时清空 `sub2Read`，从而隐藏整个许可详情与授权按钮。此前各场景已找到“请手动查询原任务，不得再次授权或重试”的锁定提示，setup 中一次许可 POST、前置 GET 加自动 GET 总两次、无许可 GET 和调用顺序检查已通过；失败断言本身未正确表达“按钮不存在也不可再次授权”。仍需在下轮独立核本地 journal 锁与提案禁用状态，不能将局部证据写成 7/7 PASS。
- `before.json` SHA256 `FD2944AE7398AB3A7656A178A725A46B74A69AC9672912B966415FAEBF865D0B`、`after-component.json` SHA256 `651B7E28A245AE214FC88DDA14337FA7E33835A8C07A31BDD00F6C152475E6B9`；wrapper 比较 source/dist 路径、字节、SHA 无漂移。后验 HEAD `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`、status `110`、相关进程 `0`，Panel/adapter/desktop 固定 SHA 未变。

分类：**外置测试预期 RED，Panel 整体仍未验收**。本次原始证据保留；任何新组件调用须先修并冻结外置脚本/计划，再由 MGR02 签新的单次窗口。
