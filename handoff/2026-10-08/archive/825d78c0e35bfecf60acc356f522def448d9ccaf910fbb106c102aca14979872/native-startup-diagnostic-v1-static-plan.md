# QA02 原生启动诊断：静态准备

状态：`PREPARED_NOT_RUN`。首诊运行器 `native-startup-diagnostic-once-v1.draft.mjs` 在外置 QA 目录；未生成新 runId、未启动 Electron、未改 c19 产品文件。另有未接入首诊的 preload 草稿，不能把它算作本轮输入或执行结果。

## 现有失败与目的

- v7 runId `qa02-source-preview-20260928T020208Z-qa02a` 的 `result.json` SHA256 `83F099E9406AC4613297BDB3EC1C95C65258FB038C7A8D483D889009D5BA0538`；首窗前退出，项目数 0、G1 未触发、无布局样本。保留其 profile、结果、事件、调用和释放收据，绝不以旧 runId 重跑。
- 静态源码显示 `startApplication().catch(() => app.quit())` 没有输出原始异常，sidecar 启动失败将异常归一为 `Sidecar failed to start`，stdout/stderr 未持久化。因此旧 v7 的直接根因仍为 `UNKNOWN`。下一次仅诊断启动链路，不承担来源预览、G1、MLT 或导出验收。

## 新 runId 审门前输入

1. DEV07 静态确诊，或其最小日志改动及构建回执；QA01 对 sidecar 握手捕获边界复核。两者原文、SHA、候选产品 HEAD/status、完整候选文件清单、主程序 dist 与 Python/sidecar 哈希固定。
2. MGR02 指定新 `qa02-startup-diag-YYYYMMDDTHHMMSSZ-...`、独立 `.aijian-dev/<runId>` profile、外置 `evidence/<runId>` 路径；两者均须不存在。c19 独占窗口由 MGR02 释放给 QA02。
3. 从固定候选生成 `QA02_NATIVE_STARTUP_DIAGNOSTIC_ONLY_PLAN`，包含 `mode=PURE_SPAWN`、`root/profile/evidenceDir/electronExe`、可执行文件/主程序/sidecar/Python 的 SHA、HEAD、完整 git status 与输入文件 SHA/字节数、v7 结果路径及上述 SHA、`preloadSha256=null`、`maxLaunches=1`、`actions=NO_UI_NO_G1_NO_PROVIDER_NO_EXPORT`。计划哈希固定后，MGR02 的单次 approval 必须绑定同一 runId、计划/runner SHA、`mode=PURE_SPAWN` 和 `maxLaunches=1`。当前没有这些最终文件，不创建假定批准。

## 一次诊断行为

- 运行器先核上述 SHA/字节数、路径和 HEAD/status；证据目录在启动前用 Windows ACL 限制为执行账户及 SYSTEM，ACL 原文单独留存。preflight 不通过即不创建 profile、不启动 Electron。
- 首诊只用外部 `child_process.spawn`，不设置 preload 或注入 Electron 主进程。固定与 v7 相同的 c19 `electron.exe`、`apps/desktop`、root cwd、`--inspect=0`/`--remote-debugging-port=0`、隔离 profile 和环境变量删减；Playwright 在 Windows 用 `shell=true`，此纯 spawn 用 `shell=false`，此传输差异明记而非声称完全同条件。父进程从 `spawn` 即记录 PID、开始时间、原始 main stdout/stderr、`error/exit/close` 与退出码/信号。每流上限 16 MiB，截断须显式失败，不能称完整原始输出。
- 父进程只用 Windows 可见窗口句柄判断首窗，观察到后延时 2 秒发送正常关闭请求；45 秒未退出则停止这一个诊断进程并记 `STARTUP_TIMEOUT`。不触发 UI、G1、provider、媒体导入或导出。启动成功也仅为 `FIRST_WINDOW_OBSERVED`，不构成 v7 同条件恢复、布局或功能 PASS。
- 原始日志可含 sidecar 会话 token，只存受限本地证据。对管理线程只传结果状态、文件路径、字节数及 SHA256 和人工脱敏摘录；不得把 raw stdout/stderr 粘到消息或普通工具输出。保存失败、ACL 失败或截断均需停下，原始失败不覆盖。

## 解释与后续

纯外部捕获无法直接见 sidecar stdout/stderr 或产品 `.catch` 已吞掉的 Promise 拒绝原因。QA01 已在隔离试验中报告固定 c19 sidecar 于 `media_asset_routes.py:203` 的 FastAPI 返回注解注册失败、握手前 exit 1；这是独立局部证据，不能回填成 v7 原始 stderr 或直接根因。DEV06 定向修复、MGR04 同步与 QA01 复验前，本首诊暂停，不对同一已知故障重复启动。若后续仍首窗前退出而无异常文本，结论继续 `UNKNOWN`，由 DEV07 最小日志改动或另一个独立批准的 `INSTRUMENTED_DIAGNOSTIC` run 定位；后一种会改变 `NODE_OPTIONS` 和模块求值时序，不能当 v7 同条件复现。诊断结果和原生预览 v7 RED/UNKNOWN 分开归档。只有诊断链路和产品候选明确，才另申请新的来源预览 G1 runId。
