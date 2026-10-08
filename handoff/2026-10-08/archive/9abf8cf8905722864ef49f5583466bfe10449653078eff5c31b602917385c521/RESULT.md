# QA03 PROJECT01 c19 契约生成结果

2026-09-24，受控 c19 根 C:\Users\Administrator\.codex\worktrees\c19-trim-211c9e8-qa-20260923，HEAD 211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2。MGR02 在 QA02 后端 4/4 和 c19 释放后正式放行本窗口。本 QA 未触 AC05 作者根或 c19 dist/DB/raw。

## 写前锁定

PROJECT01 11 文件对快照 SHA256 AD50F98E8E0E8D279FAABC34D8DCDD819ED7AC1200DD5C562E0A233CE1A17647 均逐文件 SHA/字节匹配；SUB2API01 九文件对快照 SHA256 CBA67BB6C02B83DF28C291CF0D78B5ADC92D826F1899BD52058B4FE3A661D59A 均匹配。main.py 为 D133DDA35BCB35CED48628D06FFBC1E3FC4260775730F72CFDB8B742BF93EFA4；export_openapi.py 为 C0707D4C719C347667113222FF7211AC4EA00132A89D6F4EB19A2159300F3F5E。旧 openapi.json 为 E0D9F54AFA7CAA756B55B8BF39AAA28D68C4DCCDED57AAC6AF4440BE06E1403E、旧 generated.ts 为 B3F9566E2458A245851691D8D8E930AFFF6515C8AEE7A8850A3A932CD01EDDDF。status66，相关进程0。三个真实文件字节备份均与源 SHA 一致；完整路径、mtime/bytes/SHA 见 preflight.json。

## 顺序命令与输出

1. uv run python scripts/export_openapi.py：exit0，stdout/stderr 空；openapi.json 写后 SHA256 B7F41786A815A0AB4975AFEF8C649CFA956B7741D1611E0DCA4ACEEF6E973B9D，431236 bytes；generated.ts 未动。
2. pnpm exec openapi-typescript packages/contracts/openapi.json -o packages/contracts/src/generated.ts：exit0；工具 7.13.0，stderr 空；generated.ts 写后 SHA256 AC08078E1E42FF9E49345ECCCB0202C7F859AD9FE73E5B688D5C2E8A8B509AD3，252529 bytes；openapi.json 未动。

每步 UTC、前后 SHA、原始 stdout/stderr/exit 在 run-01 各自文件，汇总 SHA 见 evidence-hashes.json。

## 差异结论

按写前真实备份比较：OpenAPI 路径 41→41、operation 46→47、schema 214→215。唯一新增 operation 为 PATCH /api/v1/projects/{project_id}，operationId updateProject；新增 UpdateProjectRequest schema；无旧 path、operation、schema 删除或改写。PATCH 公开 200/401/403/404/409/412/422/428；If-Match 缺失由 428 表示，200 返回 ProjectResponse。TS 生成合同对应新增 patch/updateProject/UpdateProjectRequest。SUB2API 和既有 02 operation 等旧合同逐项保持不变。完整相对备份 diff 与相对 HEAD 的 git diff 已保存，语义差异见 semantic-diff.json。

执行前后 PROJECT 与 SUB2API 非输出冻结文件、main.py、脚本 SHA/字节不变；HEAD 和 status66 逐行不变，见 postflight.json。两输出是本 QA 唯一写入 c19 的产品文件。

审阅期间发现复用的语义脚本硬编码旧证据目录，第一次语义运行错误覆盖了旧 SUB2API semantic-diff.json。已用旧备份与本次写前备份重新生成并复核恢复到原 SHA256 29F5ED52F83A1CAD2A01AB083AC1B5E8B56C5D248FB1FFB05FE98557B72CFFE5；修正本次脚本目录后，PROJECT 语义结果 SHA256 7B8743B54C431A4D10491107A19D75D3B3CB563AF1851EBDA5C62AFA25DE0695。生成输出及原始差异未受该证据脚本错误影响。

结论：受控静态生成与差异审阅通过。需 MGR04 固定两输出并由 MGR02 安排下一阶段 PROJECT front/desktop 验证；此处不代表 UI、构建、Electron 或产品最终验收。
