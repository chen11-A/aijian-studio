# QA03 SOURCE 项目名称：Web typecheck/build 门 v3

状态：`STATIC_AND_EXTERNAL_SELFCHECK_PASS / NOT_APPROVED / WEB_03_NOT_RUN`。v2 已按单次批准运行并在 typecheck 首 RED 停止：`web-gate-v2/web-02/RECEIPT.json` SHA256 `A5D1345A10A414521E7B7285253E4C08CAAF0A2082074C23746D5840C4068017`，TypeScript PID 18184、exit 1，原始 stdout 为 `TS5083: Cannot read file .../c19-trim-211c9e8-qa-20260923/tsconfig.json`。外置 runner 错将 `tsc -b` 的工作目录设为仓库根目录。typecheck 后 source113、dist82 与前检逐项相同；Vite build 未运行。v2 批准、raw、收据保留，不重试。

v3 仅把 typecheck 和 Vite build 子进程的工作目录固定为 `apps/studio-web`；fingerprint 子进程仍以 c19 根目录为工作目录。`capture-process.mjs` 将工作目录写入步骤收据。外置 `selfcheck-01/SELFTEST.json` 使用同一捕获模块启动两个 dummy Node 子进程，分别核对参数/raw 和切换工作目录，状态 `SELF_CHECK_PASS`；再次核对 component-02 与 web-01 现存 before 清单的 113 项源、82 项 dist 逐项一致，ordinal 聚合索引一致。自检未启动 c19 Web、sidecar、Electron 或 provider。

新模板 `RUN-APPROVAL.template.json` 是 `NOT_APPROVED`，runId `qa03-source-name-web-03`，全新输出目录 `web-03`。签署需固定本 packet、runner、capture、canonical、fingerprint、Node/tsc/Vite、MGR04 快照/同步回执、component-02 收据、c19 HEAD/status、113/82 清单。runner 的 `node tsc -b --pretty false` 通过后才运行 `node vite build`；保存每步 PID、工作目录、原始 stdout/stderr、exit/超时/清理及前后 source/dist 清单。build 会写 c19 Web dist；首 RED 停，不自动重试或回滚。通过仍不代表真实 sidecar 或原生验收。
