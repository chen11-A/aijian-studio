# REL01：Sub2API 本机模式同版增补（2026-09-29）

状态：`READ_ONLY_SOURCE_CANDIDATES_NO_SAME_VERSION_BUILD_NO_C19_WRITE`。本增补独立于旧 B31 清单 `B91EE1F989B73E23B4740224643B95F48517F006448DCFD375F91E67C11E35B9`、旧 74 件 QA 组装及 W1-r2 的 TypeScript 双步结果；这些旧回执不证明本机模式。REL01 只读作者树和隔离交接包，未写 c19、作者源、QA 输入或产品。

## 四层来源与精确边界

| 层 | 固定候选 | 只可主张 |
| --- | --- | --- |
| DEV07 desktop | `work/dev07-sub2api-local-mode-20260929/MANIFEST.json` SHA `57A125A71DE2AC0769A00639C352CDACBB7C8D3C1FDC08A4E41698C28B2611A8`；`QA-HANDOFF.md` SHA `72886CEA0B4A7AA03FEF201632A2FC32E6DFC063DF10E190BBCBA1B28BA6E50C` | 三个作者源：`provider-connection-contract.ts` `75E341279A7E787EE196940FB637D3534C7B66093D32B5E2A613AC7C37353DBF`、`sub2api-connection-mutation-contract.ts` `17392F8629550F1A6C495E68901721C528C05D6CCB538D49273959DC661151F7`、`api-client.ts` `7B4475800364301EDE5EA09AD9CAFD1A5E518F1BB54E5BF9D74AD7AF96D0AF3C`；静态源码候选，无 TS/build/运行回执。 |
| DEV05 backend | `work/dev05-b31-local-gates-20260929/MANIFEST.json` SHA `5967DCB674DE47F111D0630CBFC87E05E2D79A92FA259BAFAF76DC29439665C2` | 11 个源码候选、AST parse；manifest 明示 `SOURCE_ONLY_INTEGRATION_HOLD`，无迁移、HTTP、Vault、provider 或 EXE 验收。作者树 `provider_connection_repository.py` 当前仍是无 `origin_mode` 的旧仓储，不是 DEV01 隔离候选。 |
| DEV01 DB | `C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\dev01-origin-mode33-candidate-20260929\CANDIDATE.json` SHA `2BB2F303B1D3B83D6AE3DF0832EE42A28A91C6AFBCAC47225CBDDA2BCB7C45F5`；`QA-HANDOFF.md` SHA `946A34E73DD3DE5EF67D4EA82A71CC2F31A8E251BA7CC627F8549AB12A2A8178` | 五源隔离候选，迁移 31→32→33 仅 provisional。32 的服务 CAS、回执、bridge/UI 消费者闭包及独立 QA 未完成，33 不可据此执行或称迁移 PASS。 |
| DEV04 Web UI | `C:\Users\Administrator\Documents\AIVORA\work\dev04-sub2api-local-ui-20260929\HANDOFF.md` SHA `FD6FD57997871D7224C2AE0DCCF79C1905213AAAF03E10AF685F176447A2BEE9`；跨层核对 SHA `52ADC7C6E78D9E9234862EBEBE22F1731B22739A9076FD6EADE6F2484587FB63` | 四个 UI 作者源可选显式本机模式并严格格式检查，但本机按钮只显示“核对本机地址 · 不保存”；不发送 POST/PATCH，也不把选择当成已持久化。 |

DEV07 三个补丁仅叠在旧 B31 作者源上。创建/编辑请求省略 `origin_mode` 时按旧公网 `PUBLIC_HTTPS`；显式 `LOCAL_LOOPBACK_HTTP` 只放行 `http://127.0.0.1:<1..65535>` 或 `http://[::1]:<1..65535>` 的规范十进制端口。创建成功回执核 mode、URL 和 revision 1；编辑成功回执核 mode、URL 与下一 revision；列表/单项 validator 要求 Sub2API mode 非空、其他 provider mode 为 null。补丁未改 `main.ts`、`preload.ts`、sidecar 启动或出站网络。旧 sidecar 不回 mode，会被新 desktop 响应校验拒绝；不能单独合入旧后端并称公网兼容。

字段名和两种枚举在 DEV01/05/07/04 候选间一致，但共享 `@aijian/contracts` 的 `openapi.json`/`generated.ts`、Web `studio.ts` 当前未含 `origin_mode`；DEV04 管理页读回仍默认公网。DEV05 后端服务源码虽已有 mode 传播、审批绑定和本机传输分支，其仓储依赖 DEV01 迁移 33 与独立复核。MGR04 应在新同版物理快照中固定所有实际消费者 SHA，审 DEV01 32 前置与 33 回滚/FK、generated 类型、Web create/CAS/list/readback、desktop 列表与 UNKNOWN、DEV05 单次 POST 与 redirect/代理/重试负例，再申请 c19 精确写窗。旧 c19 B31 hunk map 对上述 DEV07 三源的旧 SHA 已失效，须重审逐 hunk；c19 `main.ts` R1 resource/TEMP/startup guards 必须保留。

本机 `8080` 当前有 `0.0.0.0:8080 -> 192.168.254.115:80` Windows portproxy，不能作为本机 Sub2API 试验端口或密钥目标。实际 Sub2API 服务身份、监听端口、独立隔离运行与真实 provider/资费结果仍为 UNKNOWN。此处只读未运行 TypeScript、构建、迁移、服务、Electron、Vault 或 provider；静态候选不能提升为产品验收。
