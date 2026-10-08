# QA01 作者 8 合同 TypeScript 独立门

状态：`PREPARED_NOT_APPROVED_NOT_RUN`。此门使用 DEV07 作者树当前版本；QA01 与 QA02 的 c19 R1 门、QA03 的 R2 EXE 门输出目录分开。MGR02 精确单签前不运行 typecheck/emit。作者树和 c19 只读，不启动 Electron、sidecar、EXE 或产品服务，不访问网络。

## 固定输入

- MGR04 的 8 文件修复快照 `SNAPSHOT.json` SHA-256 `31B6CD963F074240CCF57A8869BF09EAEA99F898576BBBBC2FC6B24FD869A8FD`；作者树 `C:\Users\Administrator\.codex\worktrees\s2-q1-g1-d00-default-deny-59f-20260923\sp` 的 8/8 当前文件哈希与快照新源一致。`apps/desktop/src/sidecar-process.ts` 当前 SHA-256 `DE5D46DCE9CEB276F67A968F0B271B37498814CECECAF7AD7712FB6DBE22710F`。
- 旧 QA03 full TypeScript 首 RED receipt SHA-256 `A2FC945967A380D9C9EC16348A5AE28C061C626C1FCD70FAC445D4C305830696`、原始 stdout 2873 字节 SHA `04EC9A2B322AFA2C195E689E1C892ABC19F312560939858300EDCF04997A57FF`、stderr 0 字节 SHA `E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855` 均保留原路径且纳入新闭包额外依赖哈希。
- Node `C:\Program Files\nodejs\node.exe` v24.15.0，SHA `3331E1FFE19874215472217C5E94F5A0C6D8E18C4AC7111D3937AA0AD5E9B4A5`；TypeScript 5.9.3 固定于作者 `node_modules`。`CLOSURE.json` SHA `43ECC4EB8C9EC72DC2B37A63BD9C02427D365E7B115B018AA5D6242BBC65E450`。

## 当前程序闭包与输出位置

`snapshot-closure.cjs` 通过当前 TypeScript API 解析作者完整 tsconfig 和 QA release tsconfig，分别 `createProgram(...).getSourceFiles()`，对每个源记录绝对路径、真实路径、字节数及 SHA；额外记录两配置、快照、旧 RED、Node/TypeScript/tsc、包清单与锁文件依赖。这里只建 Program 并枚举，不取诊断、不 emit。新闭包实际得到完整配置 **80 入口/320 源**、release **2 入口/237 源**、额外依赖 15 件；这是当前源码重新计算的数值，冻结脚本没有套用旧 237 断言。快照标为 `RELEASE_ENTRY` 的 4 合同只在 release 闭包中出现，其余 4 合同仅在 full 闭包，8/8 均在 full 闭包；sidecar-process 在两个闭包。

QA `tsconfig.release.qa.json` 继承**作者** `apps/desktop/tsconfig.json`，仅以作者 `main.ts` 与 `preload.ts` 为入口，`rootDir` 指作者 `src`，`outDir` 固定为本包 `run-01/dist`，关闭 incremental/declaration/sourceMap。作者树自带的旧 release 配置继承 c19，不作为本门输入。QA 配置与闭包的静态 `check` 已通过，`run-01`、`MGR02-APPROVAL.json` 均不存在。

## 单次运行与首 RED

`RUN-PACKET.json` SHA-256 `5B62BF99C53027B66C3A67AEDA97579C457170DD3BA6CE267E34CA4FE7F040A1`，`run-once.cjs` SHA `948779E702F8229185762D370CDA62E53AEFE377BDC79833CD56F8D69E3CF2CD`。`APPROVAL-REQUEST.json` 只是审签请求；MGR02 如认可，另建同目录 `MGR02-APPROVAL.json`，绑定 packet/runner/closure/output 和单次计数。运行器在建目录前核批准与冻结文件；建 `run-01` 后顺序执行：实际 Program 闭包 `check`、作者 full tsconfig `--noEmit`、QA release tsconfig `--noEmit`、QA release emit 到 `run-01/dist`、末次闭包 `check`。每相保留原始 stdout/stderr、PID、退出状态、错误/超时、源前后 SHA 与 `RECEIPT.json`。首 RED 停，不跑后续相、不重试、不把部分结果记 PASS。

审签后的唯一命令：`& 'C:\Program Files\nodejs\node.exe' 'C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\qa01-mlt-20260928\desktop-eight-contract-ts-gate-01\run-once.cjs'`。

成功状态仅 `PASS_AUTHOR_FULL_TS_AND_RELEASE_EMIT_ONLY`：证明作者当前 TypeScript 全配置与 QA release 入口的本地类型/emit 门，不代表 c19 R1、fake child、Electron/EXE、provider、安装或产品验收。
