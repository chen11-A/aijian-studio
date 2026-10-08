# QA01 来源清单时序 RED 证据

日期：2026-09-24，Asia/Shanghai。新复现，非原 QA 旧日志。

## 工作区与输入
- QA 工作区：C:/Users/Administrator/.codex/worktrees/c19-trim-211c9e8-qa-20260923
- HEAD：211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2；detached。
- git status：仅 M apps/studio-web/src/aivora/model.test.tsx。
- 测试差异：+62/-0；red-test-diff.patch SHA256=52C788064F179514E21101C964A5AC85F91225AAFC6949414307A1C4503CD41E。
- model.test.tsx SHA256=807ABAEBAD12C4E1DE3539427A44ABCB599CAB27F03F2ECAF8CAB36AEA664FB8。
- 产品 model.tsx SHA256=7012FE94085322821114A6C5234C16DEBA2389FD72E4E1A6786B61836AB7AD60；本轮未修改。
- Windows PowerShell；Node v24.15.0；pnpm 11.9.0；Vitest v4.1.10。使用现有锁定依赖，未重装。

## 定向命令
工作目录为上述 QA 工作区：
pnpm --filter @aijian/studio-web exec vitest run src/aivora/model.test.tsx -t 'retains the reviewed manifest when navigation expires the post-submit source refresh' --reporter=verbose

## 结果
- EXIT_CODE=1；1 failed，38 skipped（39）。
- model.test.tsx:1078：review_version_id 期望 ver_22222222222222222222222222222222，实际 null。
- red-vitest-raw.txt 保存本次完整测试输出与退出码；SHA256=26527D9A192990619547B00862F4E4E1F6DD1E2CFEFFEF4ABDBA08AF22BA5B36。
- 归类：产品前端状态同步缺陷。readRealStoryWorkspace 从权威 manifest 推导并设置 review stage，却未同步 sourceManifest；导航使较早的 post-submit refresh 失效后，清单身份仍留在 draft。测试运行与依赖正常启动。此结论仅针对定向回归，未运行 H87 UI、全工程门或最终用户验收。

## 原 QA 旧证据
已在总控 work 的文本/日志及现有 QA 工作区中定向查找，未找到原 QA 的旧 RED 日志。因此本文件引用的是本次独立新复现，不能替代或冒称旧日志。

## 后继门槛
待 MGR01 签审及 MGR04/REL01 将限定的一行产品差异同步到此 QA 工作区，并交付基线、精确差异与哈希；随后在同一测试/环境运行 GREEN。
