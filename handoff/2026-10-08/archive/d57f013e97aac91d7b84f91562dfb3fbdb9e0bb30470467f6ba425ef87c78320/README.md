# QA03 SOURCE 项目名称：双新进程 sidecar 持久化门

状态：`FROZEN_DEPENDENT_ON_WEB_GATE_NOT_APPROVED_NOT_RUN`。此门使用独立新 profile `sidecar-01/profile` 与 SQLite，真实 Python sidecar 两次启动。首进程 `POST create → 单次 CAS PATCH → GET → 正常关闭`；第二个不同 PID 以同一隔离数据库执行 `list/get` 并核对相同 project_id、新名称与 revision，再正常关闭。保存两个 PID、退出、原始 HTTP 请求/响应、stdout/stderr、SQLite 哈希与单 PATCH 计数。无 provider 请求、无 UNKNOWN 自动重发。

前置 component-02 收据固定为 SHA256 `A731DFE6E90B46BCD631CC097720CC12DE99A1E9F6D7A5420674CC84A78A9582`，状态 `TARGETED_LOCAL_COMPONENT_PASS`；另须由 MGR02 核收 Web 门后填入新的 Web 收据 SHA、构建后的 c19 status/source 指纹并另签一次性封套。当前模板 `RUN-APPROVAL.template.json` 的这些字段为 null，故不能运行。当前只静态冻结 runner、Python 可执行文件、六个直接相关 Python 边界文件与输出目录；c19 HEAD `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2` 固定其余跟踪文件，构建后新 status/source 指纹补齐未跟踪和变更文件。

本门通过只证明隔离本地 sidecar 的新进程持久读回，不代表 Electron 原生交互、打包安装或最终验收。首 RED 保留原始记录，不自动重试。runner 由 v2 的未运行 sidecar 脚本重封为 v3，增加 component-02 与 Web 前置收据门、固定 runId、packet SHA；旧 v2 文件和批准不复用。
