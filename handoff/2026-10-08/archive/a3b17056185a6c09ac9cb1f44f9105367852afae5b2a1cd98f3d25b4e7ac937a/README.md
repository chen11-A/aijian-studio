# QA03 DEV07 打包资源根候选：外置类型/构建/缺资源负例

状态：`EXTERNAL_OVERLAY_SELFCHECK_PASS / NOT_APPROVED / CANDIDATE_NOT_RUN`。此第三独立门只以 MGR04 快照目录 `C:\Users\Administrator\Documents\AIVORA\management\manager-handoffs\release-snapshots\20260928-c19-packaged-resource-root-main-1\main.ts` 为候选输入，SHA256 `E1BAAA599BB340BA4F2DEAD8755485B2E55406894E23F29D225EC0690823ABF0`。SNAPSHOT.json SHA256 `9D11A58DAD05D48BED698D05160A6FF7327C52BBEC630D0C0E03EE92A2D45364`，状态 `STATIC_EXTERNAL_CANDIDATE_NOT_SYNCED_NOT_QA_ACCEPTED`。c19 的 `apps/desktop/src/main.ts` 仍为基线 SHA256 `443624A7007C6664DC232895464AA7DD41F4B38D14FB3315088B1AF9F702401E`；本门不写 c19 main 或 dist。

`RUN-APPROVAL.template.json` 为 `NOT_APPROVED`，独立输出 `resource-01` 尚不存在。获批后 runner 通过 TypeScript CompilerHost 在内存里将唯一 `main.ts` 读入替换成快照字节；先做全 desktop 项目 TypeScript 诊断，再将 JS 发射到本包外置 `resource-01/build`。写文件回调限制在外置输出目录。保存 PID、diagnostics 原文、外置 build 文件 SHA，以及 c19 HEAD/status/main 前后检查。

缺资源负例在 VM 中从快照 `main.ts` 提取 `plainResource`、`packagedResourceRoot`、`packagedSidecarOptions`、`packagedRendererIndex` 函数，使用本包内临时资源树验证正常布局，以及缺 sidecar exe、缺 media lock、缺 renderer index、缺根目录、非打包态时拒绝。此为抽取函数的本地 mock 行为，不是 Electron/Windows 安装包运行、真实 sidecar 打包、媒体执行或最终验收。首 RED 停；无自动重试。Web StoryPages 构建与真实 sidecar 双进程门分别有自己的封套和收据，本包不得替代。

外置 selfcheck-01/SELFTEST.json 用微型 TypeScript fixture 验证与 runner 共用的 overlay-compiler.mjs：基线文件带类型错误，内存候选使 typecheck 诊断为 0，并只向外置 build 发射 sample.js；原基线 SHA 前后不变。该自检未编译 DEV07 候选或写 c19。

