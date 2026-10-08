# QA03 SOURCE 项目名称：双新进程 sidecar 持久化门 v2

状态：`WEB_03_ACCEPTED / STATIC_SOURCE_SELFCHECK_PASS / NOT_APPROVED / SIDECAR_02_NOT_RUN`。这是一份外置静态封套；未启动 sidecar。v1 sidecar 包也未运行或批准，保留原样。

本包与 Web 门使用相同源清单规范：路径统一 `/`，按路径 ordinal 排序，逐项记录 `path|bytes|sha256`，以 UTF-8+LF 计算聚合索引；构建引起的 `apps/studio-web/dist/` 与 `apps/desktop/dist/` 状态项从源清单排除，dist 在 Web 门单独记录。`source-snapshot.mjs` 为 runner 与外置自检共用的取样逻辑。`selfcheck-01/SELFTEST.json` 已只读核对当前 c19 的 113 项源与 component-02/before.json 逐项一致，索引 `E67F63239F8D3B7C246447B5C75C2CD231FF2058E1078CC58B167B51C923AB66`。这只证明当前静态输入，Web 构建后的输入仍须重新核对。

`RUN-APPROVAL.template.json` 为 `NOT_APPROVED`，新 runId `qa03-source-name-sidecar-02`，输出 `sidecar-02` 下全新隔离 profile/SQLite。component-02 收据 SHA256 `A731DFE6E90B46BCD631CC097720CC12DE99A1E9F6D7A5420674CC84A78A9582` 固定；MGR02 已核收的 Web v3 `web-03/RECEIPT.json` SHA256 `AE3112056913A3331C9C9AB8FAD881300E7C9FD41B03BDC3BB07046974D2DE76` 与构建后 c19 status SHA256 `1C1AAA57EF59C78AA07FD571B1EEAEFF23FCCA64E019B4EF7EF5D7CD4BC11FE3` 已填入。仍须 MGR02 另签 `APPROVED_SINGLE_RUN`，绑定 packet SHA、runner/两个 helper SHA、Python exe SHA、六个项目管理直接边界源 SHA、HEAD/status/source 指纹。HEAD 固定其他跟踪源；status 与 113 项源清单覆盖变更/未跟踪文件。runner 前后分别保存 `source-before.json`、`source-after.json` 逐项清单并要求完全相等。

获批后的流程：第一真实 Python sidecar 进程在隔离 profile 下 create 项目→单次带 If-Match 的 CAS PATCH 改名→GET 确认→正常关闭；第二个不同 PID 用同一 SQLite list/get，核同 project_id、名称和 revision 后正常关闭。保存双进程 PID/退出、原始 HTTP 请求与响应、stdout/stderr、SQLite SHA、PATCH 次数。首 RED 停，不自动重试或重交。通过仅证明本地隔离 sidecar 新进程持久读回，不代表 Electron、打包安装或最终验收。
