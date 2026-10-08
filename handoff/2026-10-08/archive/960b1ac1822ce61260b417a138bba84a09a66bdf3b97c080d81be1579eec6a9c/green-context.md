# QA01 来源清单时序 GREEN 证据

日期：2026-09-24，Asia/Shanghai。测试经理明确释放后执行。

## 送测候选
- QA 工作区：C:/Users/Administrator/.codex/worktrees/c19-trim-211c9e8-qa-20260923。
- HEAD：211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2；detached，未形成新提交。
- REL01 同步后仅双文件 dirty：model.test.tsx +62/-0；model.tsx +1/-0，新增 setSourceManifest(manifest);。
- 双文件 git diff --binary 保存为 green-candidate.diff，3210 bytes，SHA256=1BAD75EE4F875139015D7B48630A34DBE582A1A76335848B425D21D50561AF3C；与 MGR02 的释放记录一致。
- apps/studio-web/src/aivora/model.tsx SHA256=0B2F661BFB9F156489667603F070DA04AE3F28633452201236D65249996CE211。
- apps/studio-web/src/aivora/model.test.tsx SHA256=807ABAEBAD12C4E1DE3539427A44ABCB599CAB27F03F2ECAF8CAB36AEA664FB8；与 RED 前相同。
- 使用与 RED 相同的 Windows PowerShell、Node v24.15.0、pnpm 11.9.0 和现有依赖；Vitest v4.1.10。未重新安装。

## 与 RED 相同的定向命令
工作目录为上述 QA 工作区：
pnpm --filter @aijian/studio-web exec vitest run src/aivora/model.test.tsx -t 'retains the reviewed manifest when navigation expires the post-submit source refresh' --reporter=verbose

## 结果及边界
- EXIT_CODE=0；1 passed，38 skipped（39）。
- green-vitest-raw.txt 保存完整测试输出与退出码；SHA256=3D0A9D9C517B562546FD1A436B69E3A12B24D450087D14E26AF0080BD458A8D3。
- 与 red-context.md、red-vitest-raw.txt 的同序列 RED 相比，该定向回归转为 GREEN，支持产品单行状态同步修复有效。
- 这是局部组件测试结论，未运行 H87 原生 UI、全工程门、短文/两万字全文、正常关闭重开或最终用户验收。
