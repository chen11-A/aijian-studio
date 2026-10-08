# SUB2API01 contracts 生成结果

时间：2026-09-24，QA03。作者根：C:\Users\Administrator\.codex\worktrees\s2-q1-g1-d00-default-deny-59f-20260923\sp。

## 写前核对与备份

- HEAD 211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2；本次运行前后 git status --short 均 51 路径且逐行一致。早期 PREP 记录 47 路径，正式运行时已为 51；本次执行窗口内无新增状态路径。
- 已回核 DEV05 四源、DEV02 两源、DEV01 两源、exporter 和两项旧生成输出 SHA，均与冻结/交接值一致；未发现运行中的生成器。详见调用输出及 backup-manifest.json。
- 三项真实源字节备份：backup-0-openapi.json、backup-1-generated.ts、backup-2-export_openapi.py。备份 SHA 分别等于源文件旧 SHA：EDB34B24...E13、28EE0F30...EC、C0707D4C...F5E。完整路径、大小、UTC mtime 与 SHA 在 backup-manifest.json。

## 顺序命令

1. uv run python scripts/export_openapi.py：exit 0；stdout/stderr 都为空。openapi.json 从 EDB34B24106D157B0A0D3CD550909676C013E542A030DB57327967D1D9D83E13 到 E0D9F54AFA7CAA756B55B8BF39AAA28D68C4DCCDED57AAC6AF4440BE06E1403E，generated.ts 不变。
2. pnpm exec openapi-typescript packages/contracts/openapi.json -o packages/contracts/src/generated.ts：exit 0；stdout 为工具版本与生成成功，stderr 空。generated.ts 从 28EE0F30FA3F694AA91E83A324A6BB381A2DC682E37C380C3ABAF5D7FD3105EC 到 B3F9566E2458A245851691D8D8E930AFFF6515C8AEE7A8850A3A932CD01EDDDF，openapi.json 不变。

每步原始输出、退出码、时间和前后 SHA 分别见 export.*、typescript.*。没有执行 provider、Electron、运行时或网络请求。

## 生成差异审阅

对生成前真实备份和生成后文件逐项比较，详见 semantic-diff.json、两个 before-after.diff 及相对 HEAD 的完整 git-diff-generated.txt：

- OpenAPI 路径 37→41，operation 42→46，schema 199→214；无旧路径、旧 operation、旧 schema 删除；全部既有路径和 operation 内容不变。
- 新增远程 source extract queue POST、operation GET、source extraction current/version GET 四个 operation；新 operation 的状态码和 operationId 已列入 semantic-diff.json。四项来自冻结 main.py 的现有路由，不是此次编辑。
- 既有 schema 只有 CreateProviderConnectionRequest、ProviderConnectionData 变化：provider_kind 枚举追加 SUB2API。旧值、其他属性、required、default 未变。generated.ts 对应两处联合类型亦追加 SUB2API。
- 旧 FakeTimelineRunOperation、Project、ProviderConnection 等合同保留；原有 02 operation 内容未改。main.py、exporter 及冻结源 SHA 在执行后仍与写前一致。当前 sidecar 下 remote_source_extract_enabled=True 仍是源内的 queue-only 开关，本次未修改该开关或添加远程 worker。

结论：生成与静态契约差异审阅通过；仅是作者根文件更新。MGR04 需按其快照流程复核并决定同步；本 QA 未同步 c19，也不将生成视为运行时或产品验收。
