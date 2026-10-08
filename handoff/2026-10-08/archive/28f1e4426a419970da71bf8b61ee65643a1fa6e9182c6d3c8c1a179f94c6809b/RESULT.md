# QA03 SUB2API 表单三文件补丁定向验证

2026-09-24；候选 c19：C:\Users\Administrator\.codex\worktrees\c19-trim-211c9e8-qa-20260923，HEAD 211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2。MGR04 保护同步三文件、MGR02 独立复核后正式放行。本次未改产品源、未启动 Electron/Provider、未发起网络请求。

## 输入锁定

- provider-settings-model.ts SHA256 D3E5170B14D69CCF8E2DA1B65DCA0303D930C173917B70ECA7897E10B1F8921E
- use-provider-connection-form.ts SHA256 334F02F179E766CD4E179B99163362397E875503D5E4B5C09982B937056B12CC
- ProviderConnectionForm.tsx SHA256 5E2460F7AEA45F6775565737F6E15EC0A286D09B6D50DB95772358FDA9A91F87
- 外置测试 sub2api-form-contract.test.mjs SHA256 0987FE1E4CA1DAD1812A96E32153ABF5B8BA29DA932C4E1894DC252BF2E24D75；配置 SHA256 A99388E2BC769962CB43F8F8EAF1A97EC7B420D5F3B9A454CEF059E7D6FFD04D。纯 HTTPS origin 示例不带 /v1；只测 UI payload，不证明实际域名可达或后端 is_global 授权。

## 顺序结果

1. 外置真实 ProviderConnectionForm jsdom 交互 4/4，exit0：SUB2API 显式 origin/key/TEXT、切换清除 IMAGE 且不可非TEXT提交、OLLAMA 与 OPENAI 回归。
2. pnpm --filter @aijian/studio-web typecheck，exit0。
3. pnpm --filter @aijian/desktop typecheck，exit0。
4. pnpm --filter @aijian/studio-web build，exit0，Vite 110 modules，产物成功；有非阻断 500kB chunk warning。
5. pnpm --filter @aijian/desktop build，exit0。

各步独立 stdout/stderr、起止 UTC、exit JSON 及 SHA 列于 run-01/evidence-hashes.json。旧 web TS2741 exit1 原始记录仍在 qa03-demoapp-20260924/build-01，未覆盖；旧 DemoApp 修订组件 6/6 证据复用，未重复运行。

## 前后指纹

run-01/before.json 与每步 after-*.json 精确列出 63 源文件和 75 dist 文件（路径、字节、SHA、UTC mtime）。整个窗口 63 源路径/字节/SHA 无变化，HEAD 与 git status 60 路径逐行不变。测试及两项 typecheck 前后 dist 75/75 无变化。

web build 后 dist 仍 75：旧 renderer index-D_wu2Mk2.js 移除，新 index-B8mbtJYp.js SHA256 6F3951A0934DD23460CD2DA38C026FD171093DE78D00C899CD54706E587A2A50；index.html SHA256 88CC496989B4E035EFB051A48B6817413A96FB94214F1465CBF6D0E709C736B6 并指向新 JS。desktop build 后 dist 仍 75，provider-connection-contract.js 更新为 SHA256 9FF2D2C4058F9EC8E04A634C9D783A08FDAEA75B1C791886BA381CFD5A036DE5；desktop/dist/main.js SHA256 7F02C2944F1CACA5582F329FA07A8C5BB0F350B655A3B05F14EBEEC4F152C164 不变。构建结束相关 c19 进程为 0。

结论：表单组件、两项 TS typecheck、同源 web→desktop 构建在此限定候选通过。仍无原生 Electron 同页、真实 Sub2API 授权调用、账单权益或安装验收；不能扩称产品整体接受。
