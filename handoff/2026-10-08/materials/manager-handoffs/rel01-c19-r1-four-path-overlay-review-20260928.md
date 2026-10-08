# REL01：c19 R1 四路径外置包只读复核（2026-09-28）

结论：**可申请 MGR02 精确四路径独占同步窗口，随后进入 c19 实际基线的隔离 QA；静态复核不等于 TypeScript、Electron 或 EXE 验收。** 同步前须重验下面的旧值和外置包 SHA，偏离即停止该路径。c19 未由 REL01 写入。

## 基线与文件归属

- c19 `HEAD=211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`，本次观察 111 条已有工作树状态。唯一 c19 写者为 MGR04，且须等 MGR02 开精确窗口；DEV07 只写作者树外置包，REL01 只读。
- `apps/desktop/src/main.ts`：c19 `E1BAAA599BB340BA4F2DEAD8755485B2E55406894E23F29D225EC0690823ABF0` → 外置 `main.after.ts` `BDAB4361B5D0671735253C8A57258FC48005165F07969DCD9D56C3BDC5636DAC`；`main.patch` `C5724F808F9BBAD4DF0E5A86F0EEC4436D82E23516CD43CE0DD972EACF552BF2`。本机对 c19 执行 `git apply --check` exit 0，未应用补丁。作者整文件 `main.ts` SHA `299099E3EA795874FEDB68CC68961A9BA70D0E2FE5126F53A444D1D22A61AFE1` 不可作为替换源。
- `apps/desktop/src/sidecar-process.ts`：c19 `1AC560A1AA5EB8F33E6D9A43CE7369B7028A215EF99405A9E05FE0EF7971FE00` → 外置 `DE5D46DCE9CEB276F67A968F0B271B37498814CECECAF7AD7712FB6DBE22710F`；新增 `sidecar-startup-diagnostic.ts` `2B2147A6480824B6FBBC0489CB7A74780D04FE994C6C2F285E76308533FDABA6` 和 `sidecar-extraction-temp.ts` `6EA5A2BA8ACD40F46CEE5F8A6F035C824A5A3479D93DD1565FF0C550511F7821`，c19 两者原本 ABSENT。
- `sidecar-protocol.ts` c19 SHA `EA24A205A7BBC7964FDB78F9B39016B3E4C1246816D855426B628ABFAF2839C7`，与作者相同；本包无需改它。外置作者包 `work/dev07-c19-r1-overlay-20260928/HANDOFF.md` SHA `DDCDD420638E39D7FC451AC38B6CCAE0BE9D826C6BB26120FF945C08D6C73BFF`。

## 增量依赖与行为审查

main 补丁只新增 TEMP helper 导入、`SidecarStartupError` 导入、打包侧子进程 TEMP/TMP 及关闭回调，并把启动异常记录为 `WORKSPACE_BUSY` 或 `STARTUP_UNKNOWN` 后退出。逐段比对保留了 c19 的 `packagedResourceRoot`、sidecar/config/media lock 资源检查、`packagedRendererIndex` 在 spawn 前的检查、原有 renderer/IPC 注册。`sidecar-process.ts` 新增诊断模块依赖，既有协议文件同字节；helper 仅依赖 Node fs/path。进程关闭回调只尝试删除自身空 wrapper，保留有 `_MEI` 或其他内容的目录；同步调用 `spawn` 抛错时也尝试清理。子进程实际继承的环境、关闭事件和清理结果仍须 QA 读回。

QA03 作者侧 237 文件完整 TS 闭包的八个报错合同中，`episode-script-confirmation-contract.ts`、`episode-script-contract.ts`、`source-proposal-acceptance-contract.ts`、`sub2api-configured-readiness-contract.ts` 可由作者 main 的四条新增 IPC 导入及其 `api-client.ts` 导入触达；另四个 `episode-media-assembly-contract.ts`、`media-asset-probe-contract.ts`、`media-rights-decision-contract.ts`、`sub2api-connection-mutation-contract.ts` 是作者侧独立 IPC/完整 tsconfig 的输入。c19 main 无四条新增 IPC 导入，以上八个合同在 c19 全部 ABSENT；c19 `apps/desktop/tsconfig.json` 包含实际存在的 `src/**/*.ts`。因此不应为 R1 把作者整份 main 或八合同复制进 c19。作者侧全 tsconfig RED 不能直接归因于这四路径的 c19 增量；c19 实际四路径完整 typecheck 仍必须重新执行。

R2 `release-snapshots/20260928-r2-lock-only-sidecar-build-input-1/INPUTS.json` SHA `F5859CCA86D9A96332C22CB83EA7E6EDF09C5ACAED454166AD9E0BEF652FAA3C` 仅 194 项中的 `workspace_owner_lock.py` 从 `94F621...` 换到 `103ED055...`；其中 main `F6C664...`、sidecar-process `8A665F...` 为旧 NOOP 源，既非 c19 R1 overlay 也非新 EXE 验收。R1 与 R2 须分别版本化、分别 QA。

## 后续验收门

MGR04 仅在 MGR02 窗口及写前 SHA/状态核验通过后同步四路径，回读四新 SHA，并复核其他 111 状态文件未变。QA03 在**同步后的真实 c19**跑完整桌面 typecheck/build 及依赖/输出字节检查；打包 Electron 以普通用户验证长继承 TEMP、子进程 TEMP/TMP/PID/_MEI、正常关闭和双实例 Busy73；非法或不可写 LOCALAPPDATA/USERPROFILE 在 spawn 前返回 STARTUP_UNKNOWN，父进程环境不变。R2 新锁须用新 EXE 在长 userData 与同工作区双实例下另验。静态通过不授权发布或声称原生运行通过。
