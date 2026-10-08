# QA03 SOURCE 改名：一次性运行封套补件

状态：`STATIC_ONLY / NO_VITEST / NO_SIDECAR`。本补件引用原 `PACKET.json` SHA256 `DAC411C832B2A94C33A9908B5A8422C4927665BD3C314B9538AA74B038290526`，不更改原包。当前没有 DEV03 StoryPages 冻结快照，也没有受保护 c19 同源同步回执；两个模板均为 `NOT_APPROVED` 且缺必要字段，所以不能启动任何测试进程。

## 组件一次性封套

- `run-component-once.ps1` SHA256 `3BFB7ACFDCB0E5A6425B6750C53A08104C00814AA0661DC67C3EE28E8A3C858B`；`RUN-APPROVAL.template.json` SHA256 `B2C7B79DDCF4C780A20B6B096F47FAE32E23A21C3A1E5A5DD1B9C0B9221ACE58`。
- MGR02 后续独立生成确切 `APPROVED_SINGLE_RUN` 封套并给其 SHA；绑定唯一 runId、新输出目录、StoryPages 冻结快照 SHA、MGR04 c19 同步回执 SHA、c19 HEAD/status SHA、runner/test/config/fingerprint SHA。模板本身被拒绝。输出目录必须不存在且位于本外置 QA 目录下；创建后同封套不能重复运行。
- wrapper 在 Vitest 前回算四个产品源的作者/c19 SHA：StoryPages `3E59A3D1…`、model `4B6CCD35…`、studio `5598B535…`、projectManagement `7B549DCD…`；还核对源与 dist 运行前指纹、关联进程为零。任一不符在首个 RED 停止，不调用 Vitest。
- 唯一测试命令为本地 Node 调 c19 已安装 Vitest，固定 `project-name-source.test.mjs`，600 秒超时；保存 PID、exit、timeout、cleanup、原始 stdout/stderr、Vitest JSON 及 SHA。严格要求 5/5、源与 dist 前后指纹一致，随后回读 HEAD/status/四源 SHA。不会执行 typecheck/build、Electron 或 provider。组件 PASS 只证明 mock 桥及组件重挂载。
- 运行记录写全新 run 子目录 `RECEIPT.json`；失败保留原始输出、首个 RED 和 postflight，不覆盖旧证据。`fingerprint.mjs` 复用已验 AC05 外置脚本 SHA `CA29296D62768C363578F4263F3201878F944917DF376245D8BBCBE41622C0FD`，仅读 c19 并把清单写入本轮外置目录。

## 独立真实 sidecar 新进程门

- `run-sidecar-reopen-once.mjs` SHA256 `02CDE89B3B5E9960B96ED24CE683FAA92E0B9CF182F276A49ABF433A7258360B`，`SIDECAR-APPROVAL.template.json` SHA256 `A930AA1E61F6B6E9447ECC1B4DE8655E4AFE4C6CA2C4CFB6C4A913A251191914`，是**另一封套**。只在组件结果被核收后，由 MGR02 固定新批准 SHA、独立 runId、全新外置隔离 profile、Python 二进制 SHA、API 六源 SHA、c19 HEAD/status/源指纹与组件收据 SHA。模板同样不可运行。
- 脚本只对本机 `127.0.0.1` sidecar 发送一次 `POST /projects`、一次 revision `If-Match` `PATCH /projects/{id}`、一次确认 GET；正常关闭第一个 sidecar 后用**相同隔离库、全新 PID**启动第二个 sidecar，GET 列表和精确项目。比较同 `project_id/name/revision`、唯一列表记录、PATCH 总数为一。记录两次 PID/退出、请求响应原始字节及 SHA、隔离 DB 的正常关闭后哈希、运行前后源指纹。不会调用 provider 或正式导出。
- sidecar 启动管道的原始 stdout 含本次进程 token，原始文件只留在隔离 QA 目录；收据只记录 token 长度，不转发 token 文本。任何 HTTP、身份、超时、关闭、重开或哈希失败均为 RED；不能自动重试 POST/PATCH。真实进程门也不替代 Electron 可见交互或全产品 AC01–AC10。

静态核验：PowerShell runner 解析错误 0，两个 JS 文件 `node --check` exit0，两个审批模板 JSON 可解析且均为 `NOT_APPROVED`。没有运行产品测试或服务。
