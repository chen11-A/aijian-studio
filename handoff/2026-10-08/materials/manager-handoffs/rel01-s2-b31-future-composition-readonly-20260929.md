# REL01：S2 局部门与 B31 拟议同版组合只读矩阵（2026-09-29）

状态：`STATIC_COMPOSITION_PROPOSAL_NOT_C19_WRITE_NOT_BUILD_NOT_RELEASE`。本记录不修改 c19、主线、W0、QA 目录或作者源；旧 74 件 QA source assembly 是前一版本，**不作为 B31+W1 的 emit、renderer 或发布输入**。

## S2 回执的精确范围

QA03 `C:\Users\Administrator\Documents\Codex\2026-09-23\qa03-s2-source-http\run-01\result.json` SHA `F8BC3737B0F448E0C5F6EAFCC9D4AC86CCB5EAFFE5B863F80C84419F8E8C5C16` 为 `PASS/READBACK_PASS`；`QA-REVIEW-SUMMARY.json` SHA `131A9A2DEDEAB914038095C858DEF0903B110F291586DCA0713D81BECC4C2384`，绑定 PACKAGE `B0A710BBCC5522698763F672F82FF0F9BBF49F8A04B14C41C4F1B9F30D1A9663`、单次批准 `16C3B0D9...`。固定 Python consumer 读取 R2 同版后端/依赖，10 次 HTTP：health 和七个来源读为 200、项目及 42 B/70,095 B 两次来源 POST 为 201。SQLite schema31、quick_check ok，最终项目 1、来源 2、块 492；两份 HTTP 正文、块跨度和 SHA 与只读 SQL 对齐，关服后 DB SHA `B60A870C233CBE208667FC571219F2B5185DBC1463AFAE68D85B4B15E32E107F`。Vault spy get/set/delete 皆 0，provider/task/approval/connection/rotation 表皆 0，进程退出且输入后验零差。

**只接受** `SOURCE_BACKED_HTTP_SOURCE_INGEST_READBACK_ONLY` 的本地源码 HTTP+DB 局部门。该 run 没有调用 source-manifest/G1/production-brief 送审、批准、accepted 选块或重开；没有固定 EXE、Web/Electron、后台 worker、原生 Vault/OS 外发隔离、provider/计费或完整 S2 验收。DEV02 的后续路由/形状静查只支持准备新隔离 DB 门；默认 local-user 可兼 writer/producer，不能声称双人独立审批。

## 当前唯一拟议来源组合

`release-snapshots/20260929-b31-same-version-qa-inputs-1/MANIFEST.json` SHA `B91EE1F989B73E23B4740224643B95F48517F006448DCFD375F91E67C11E35B9` 固定 R2 源 194 项/consumer fingerprint `D7509EED...`、B31 首层选择源 50 项及 c19 六项保护基线；REL01 按固定 Python 视图回读 50/50 和六项 6/6 同 SHA。它是首层身份，不是完整编译/运行闭包或可直接同步清单。50 项相对 c19：**24 同字节、17 异字节、9 缺席**；具体分工如下。c19 当前 HEAD `211c9e8b...`、状态 114 行，R1 main `BDAB4361...`、process `DE5D46DC...`、diagnostic `2B2147A6...`、temp `6EA5A2BA...`。

| owner | 50 件中同字节/异字节/缺席 | 未来只可审的 c19 增量 |
| --- | ---: | --- |
| DEV07 desktop | 6/4/4 | 对 `main.ts`（作者 `A1359F9E...`、c19 `BDAB4361...`）只取 B31 readiness/mutation 两项导入及 top-frame IPC 注册；对 `api-client.ts` `D694B1B1...→BA060B63...`、`preload.ts` `79400646...→77C06E15...`、`provider-connection-contract.ts` 逐 hunk 审 DTO、PATCH/rotation/GET 与 UNKNOWN，不整拷。加 `sub2api-configured-readiness-{contract,ipc}.ts` SHA `F8843BAF...`/`48031847...`、`sub2api-connection-mutation-{contract,ipc}.ts` SHA `85F0D1FC...`/`D77C5087...`。六项同字节维持原状。 |
| DEV04 Web | 5/3/2 | `UtilityPages.tsx`、`api/studio.ts`、`use-provider-settings.ts` 审 metadata CAS/rotation/readback 挂载与 UNKNOWN；加 `Sub2APIConnectionManagement.tsx` SHA `555B4D4B...` 与 `sub2api-provider-journal.ts` SHA `C3A54F75...`。五项同字节不复制。 |
| DEV05 backend | 13/8/2 | `provider_connection_routes.py`、`provider_connections.py`、`provider_contracts.py`、`sub2api_source_extract_{runtime,worker}.py` 等按消费依赖审；加 `sub2api_connection_readiness.py` SHA `B664D3C8...` 与 readiness routes SHA `3B806807...`。`main.py` c19 `BBC596FD...` 只取仓储异常导入、readiness provider/import、脱敏 409/503、sidecar 安全条件内 mount 等五处（详见 DEV05 `MAIN-SIDECAR-MINIMAL-DELTA.md` SHA `452A17BE...`）。c19 `sidecar.py` `788E3942...` 已接 worker 与 availability，**不整件替换**为作者 `03B5EE2E...`。 |
| DEV01 repo31 | 0/2/1 | `repository.py` c19 `BB366B21...` 对候选 `4032F9C2...`、`provider_connection_repository.py` c19 `16004298...` 对候选 `96DAE669...` 应先核 repo30 保护差异和 schema31 迁移；加 `provider_credential_ref_schema.py` SHA `B170FFC0...`。DEV01 候选 `CANDIDATE.json` SHA `18FD5608...` 只是三源静态，不是迁移 PASS。 |

**c19 主入口保护**：作者 `main.ts` 整件会删掉 `packagedResourceRoot`、plain sidecar/config/media-lock/renderer 检查并改变 `startApplication` 的先行 renderer 预检；整拷会回退已同步 R1 的资源、TEMP、STARTUP_UNKNOWN 守卫。MGR04 是 c19 唯一写者，仅在 MGR02 精确窗口和写前 SHA/状态保护之后应用审过的 B31 hunk。作者 `main.ts` 还含 episode-script/confirmation/source-proposal 三类非 B31 入口，不能借 B31 顺带并入。

**W1 单独增量**：DEV04 作者单文件 `apps/studio-web/src/aivora/adapters/episodeMediaAssembly.ts` 原 `3EA0FF966B45CB0850B25C558296B250B890F04AE0FC19A26AE6CFAA89044253`（8431 B）→新 `66292488A83F6311CC454FD6F41302E6C9E088202032F7898E362DBDC489B04E`（8685 B），c19 ABSENT，**不在旧 B31 50 项或旧 W0 source-02 中**。DEV04 外置 `C:\Users\Administrator\Documents\AIVORA\work\dev04-episode-media-ts-red-20260929\HANDOFF.md` 当前 SHA `AFA38354560D380DB38D62B0783A1B3ABAE08F5DC411B3C1D7349AD18D4F2608`，before/after/patch 均回读；交接文档本身在补全精确字节数与 patch SHA 后更新，源码 SHA 未变。静态 diff 仅把不可信 `media_checks` 数组固定为局部，经原条件组成的 `mediaCheck` 类型守卫逐项转入 typed 数组，随后嵌套匹配和静帧判定读局部；非数组/畸形/稀疏项仍拒绝。它针对旧 W1 TS18046/TS7006，**尚无新 W0/W1 TypeScript PASS**。若将 B31+W1 作为最终拟议组合，须再冻新 51 项身份、完整依赖与新 Web QA，不能把 B91 清单或旧 RED 改写成 GREEN。

## 次序与未就绪产物

1. QA 在新隔离根构造同版 B31 50 + W1 新 6629 的完整 Web/desktop 依赖，固定实际读到的文件/SHA，禁止从作者树或 c19 静默回退。先分别审新 W0 和 W1：Web app/node TypeScript 两步，旧 W1 首 RED 原样保留；新 W1 PASS 后独立 W2 Vite build/renderer 逐项 SHA，W3 设置 mock/CAS/UNKNOWN/readiness。QA02 独立 desktop IPC TS/mock、full typecheck/emit 并确认新 preload channel 对 main handler；旧 74 件 renderer/desktop emit 不继承。
2. QA 独立 repo31/schema31 空/旧库迁移、回滚、旧连接重开，再测 B31 metadata CAS、单次 rotation/原 operation GET、UNKNOWN 不重发、readiness 本地状态与 credential_ref；保留真实 provider/资费 UNKNOWN。S2 只证来源 ingest。后续 manifest/review/brief/accepted 选块需另立 DB+HTTP 同 profile 门。
3. 前两层有受审的同版输出后，MGR02 才审 c19 精确写窗，MGR04 逐 hunk 同步且保 R1；回读目标 SHA/其他状态。再由独立 QA 产出**新** Web renderer、desktop emit、backend/EXE 身份与真实 Electron/installer 门。旧 74 件 `INPUTS.json` SHA `9B256742...` 属 R1+R2 组装，不是本组合发布候选。
4. 用户新选的本机 Sub2API 严格字面 `127.0.0.1`/`[::1]` 加端口是**另一个 local-mode 源候选**；当前 B31 公网 HTTPS origin 规则与上述 QA 仍按旧固定版，不把新模式混进 W1 补丁、S2 PASS 或旧 74 件。
