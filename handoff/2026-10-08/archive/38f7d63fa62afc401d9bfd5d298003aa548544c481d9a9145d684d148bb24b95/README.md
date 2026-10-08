# QA03 SOURCE 项目名称：Web typecheck/build 门 v2

状态：`STATIC_AND_EXTERNAL_SELFCHECK_PASS / NOT_APPROVED / WEB_02_NOT_RUN`。v1 仅批准并运行一次，`web-gate-v1/web-01/RECEIPT.json` SHA256 `F49022CC753BBFA1085C282A82A6BB73CA47935DB2B94CE8A6A760BC6166E560`，before 指纹 PID 10380、exit 0，首 RED 为 JS 默认 `.sort()` 聚合 SHA 与组件封套 PowerShell `Sort-Object` 聚合 SHA 不同；未进入 typecheck/build。v1 raw、批准和输出均保留，不复用。

v2 将聚合索引统一为：路径中的 `\` 改 `/`；按路径 ordinal 顺序排序；逐行 `path|bytes|SHA256`，UTF-8 编码、LF 连接后计算 SHA256。source 排除构建后作为 Git 变更出现的 `apps/studio-web/dist/` 与 `apps/desktop/dist/`；dist 另列完整清单。逐项路径、字节数与 SHA 是权威，比聚合 SHA 更具体。用 component-02 与 web-01 的现存 before.json 做外置自检，113 项 source 和 82 项 dist 逐项相等；新 ordinal SHA 分别为 `E67F63239F8D3B7C246447B5C75C2CD231FF2058E1078CC58B167B51C923AB66`、`33707B7B7DDD1F9A6CF3E55667BCDFD4D6FA64E0276F5C224698DC6DD9A4816D`。这只是排序规范差异，未发现 c19 源漂移。

`selfcheck-01/SELFTEST.json` 记录另一个无产品副作用检查：使用与 runner 相同的 `capture-process.mjs` 启动本机 Node dummy 子进程，回读两个参数、原始 stdout/stderr、PID/exit/超时/清理；状态 `SELF_CHECK_PASS`。没有启动 c19 Web 构建、sidecar、Electron 或 provider。

新批准模板 `RUN-APPROVAL.template.json` 为 `NOT_APPROVED`，runId `qa03-source-name-web-02`、全新输出目录 `web-02`。签署时核固定 packet/runner/capture/canonical/fingerprint/Node/tsc/Vite SHA，以及 StoryPages 快照、保护同步回执、component-02 收据、c19 HEAD/status、113/82 清单。runner 按 `node tsc -b --pretty false` → `node vite build` 执行，每步记录 raw/PID/exit/timeout；typecheck 后 source/dist 必须不变，build 后非 dist 源必须不变，dist 前后完整清单与新增/删除/变更路径入收据。build 可写 c19 Web dist，tsc 可写忽略的 node_modules/.tmp。首 RED 停且不自动重试/回滚。通过仍只是 Web 类型与构建结果，真实 sidecar 和原生验收另门。
