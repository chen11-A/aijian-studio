# REL01：D/repo30 与长路径闭包的静态组合审查（2026-09-28）

当前状态：**c19 仅两文件长路径切片已同步、未 QA 验收；D/长路径合包未同步，D 写窗关闭。写后 153 路径提议因旧 workspace lock 命中 EXE RED 而暂挂。** 下列 Resolver54 与 153 索引是版本限定的冻结候选；作者树后续变化不使其静态证据失效，也不自动升级 repo31，见末尾更正。本记录供 MGR04/QA 审来源，不能作为取件指令。总控已明确 c19 唯一实际同步写者为 MGR04；REL01 只维护队列、差异、owner 与回退清单，QA01 只读审查及独立测试。

## 冻结输入与现场

| 输入 | 已回读的清单 SHA256 | 静态核对 |
| --- | --- | --- |
| `release-snapshots/20260928-d-repo30-qa-closure-152-1/FILES.json` | `F3775529D3D431D5D914F80FB74552CD23B96402142808970963D75C296160E9` | 152/152 源文件存在且各自哈希相符；125 个 `c19_base`、27 个 `staged27`。 |
| `release-snapshots/20260928-stage-a-longpath-unified-closure-3/FILES.json` | `13AF7D305E10126184CB39E9662084C9D3DED6C3670BF6E45C5E03D99F80D4A0` | 47/47 源文件哈希相符。 |
| `release-snapshots/20260928-mlt-resolver-final-import-closure-54-1/FILES.json` | `FB7B477C6BC5EEAF6DCA4D1A970275062ED658C0EFF6F3998AE1D73D9A537B72` | 54/54 源文件哈希相符；Stage-A 47 项均在此包且逐项同 SHA。 |

c19 `HEAD=211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`。与 D 152 项逐一比较：126 项现有字节相同，26 项不同或缺席；27 个 `staged27` 中 `media_asset_routes.py=931D14F8B3D3069ED89E224C6BF4EBF2EE4CA9CA34DAFC9A6415CD2E1B3B8770` 已与 c19 相同。此计数只是本次读取时点，任何写窗前必须重新核旧 SHA、status、进程及目标占用。

## 四个共享文件

下列路径前缀均为 `services/api/src/aijian_api/`。c19 当前四项均**缺席**；表内 SHA 为源文件完整 SHA256，`—` 表示该闭包未包含。

| 文件 / 唯一作者 | D/repo30 | Stage-A 47 | Resolver 54 最终候选 |
| --- | --- | --- | --- |
| `episode_media_assembly_store.py` / DEV06 | `5C87BF2220FA4EC0C1A4FB77F2FCD8972B1A816977A6E65095AD0D2D1A25CB3D` | `72F72CFA08349396D3853C92CCE63A3A66C77CF531544124563B15E44838AF89` | `72F72CFA08349396D3853C92CCE63A3A66C77CF531544124563B15E44838AF89` |
| `media_asset_selected_reader.py` / DEV06 | `9A3268DA438BEB6E1085F4BECDC5DDF289AA9CB1BC906D875D2FBD4E84E96B68` | `88A2CB4A2C891D717FBACC3D3BB14B195F8B0419431E0AB6A5B05FEBFD34A303` | `88A2CB4A2C891D717FBACC3D3BB14B195F8B0419431E0AB6A5B05FEBFD34A303` |
| `media_asset_probe_store.py` / DEV06 | `0676F19120C20A272543CD94C3AB06DFDDA45FC559814852B3CEF52CDF00ADDD` | `38CD2EEC6E1BE39620773EFD9D3917A1E93951A86C9CC473E7BB304B9A50CCFA` | `38CD2EEC6E1BE39620773EFD9D3917A1E93951A86C9CC473E7BB304B9A50CCFA` |
| `product_export_output_verify.py` / DEV08 | `769B6EB6DCD7C7235523E7F3832B48E41840E16859CB2A2393BD4228B0B88F8A` | — | `55F0CB3B073758AAA0150DDA06E069AA333C7275874A7AC77B16617762326688` |

四个最终候选的共同新增直接依赖是 `managed_local_paths.py=78FCCE4F28FF720F6610AB72EEC2C5C5AB179E7BEB758B980610303B7CA9D7AC`，c19 与 D 均缺席。Resolver `IMPORTS.json=CDC3FBD9822ACE3A0F4B607753C7D695DECBDB8B65357C9081D61E2659F89F92` 的 AST 边还显示：assembly 依赖 `media_asset_probe_store`、`media_asset_store`、`repository` 等；selected reader 依赖 `media_probe`；probe store 依赖 `media_toolchain`、`repository`；output verifier 依赖 `media_probe`、`media_toolchain`、`product_export_contracts`。该图只证明 Resolver 自身静态局部模块闭包零缺，不证明它与 D 接线后的导入或行为相容。

## 完整交叉范围与候选选择

D 152 与 Resolver 54 共有 46 项：39 项同 SHA、7 项不同；另有 Resolver 独有 8 项。四项差异见上表，另外三项如下：

| 文件 | D / 当前 c19 | Resolver 54 | 静态判断 |
| --- | --- | --- | --- |
| `__init__.py` | `333A85461A874678AC3C4FA0ABF4AE0F415BAAB2015384C85976E7EE42690D2A` | `E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855` | Resolver 是空包占位；保留 c19 的包版本字节。 |
| `provider_contracts.py` | `045985B9E227DFEDBE26601669BD6410EF8C6D81F7A99E1E6A961861DC4D4762` | `8C69AAFA39B13253FA46CC43622AD2EAD2A7CFF6596CAFC76A23EFD8CB1BB284` | 新版含 provider mutation 合同，超出长路径取件；首包保留 c19，另行审。 |
| `media_asset_store.py` | `E2B2002D157DEBA5F2E03F5340AD83BE9B09BE4F5D77E1ACF614D3617A60AF8D` | `2954042D87754211526891A5CC3506DD55DCA78CBB349FC44D19D54FDDC105B8` | 长路径实现直接使用 helper，若采用最终四文件需同批升级。 |

**待签的组合方向**：以 D 152 为基底，保留 D/c19 `__init__.py`、`provider_contracts.py`、D 的 `main.py=81C1F2...`、`sidecar.py=8B0596...`、schema30 `repository.py=C2104917...` 与未变媒体路由；取 Resolver 54 的四个最终共享文件、`media_asset_store.py=295404...`、helper `78FCCE...` 及其实际缺失的局部依赖。此方向仅为静态选择，必须由 DEV05/06/08 与 QA01 对整份候选逐文件确认、生成唯一合包 `FILES.json` 与哈希，不能把两闭包直接覆盖到 c19。

D 旧四文件先同步、随即被长路径文件覆盖，没有已经证明的独立产品验收价值；目前不申请这样的两阶段写窗。若以后拆段，须每段有完整依赖、明确验收和可回退的独立结果。D 外置隔离的 repo30/HTTP/Busy73 QA 与长路径隔离路径门均不可移作新合包验收。

## 写窗前置与回退

1. QA01 完成源→c19 的 26 项旧/新 SHA、owner、共享冲突清单；DEV05/06/08 确认最终来源及调用相容性；MGR04 冻结唯一合包及非目标文件保护清单。
2. 新合包先做跨包 AST/import、schema26→30 隔离迁移与重开、sidecar 握手、鉴权/旧 UNKNOWN 同键回放、Busy73/Job 关闭和锁释放等独立 QA；实际范围由 MGR02 排。正式新 claim 仍受空 allowlist、缺 assembly/rights/probe 路由、桌端资源根和执行镜像身份等门约束。
3. MGR02 明确释放 c19 独占短窗前不写。窗口释放后仅由 MGR04 在写前记录 c19 `HEAD`、完整 status、每个目标旧 SHA 或 `ABSENT`、相关进程和非目标文件，完成备份、复制和逐项回读；REL01 与 QA01 不同时写。回退点为该 c19 原字节与缺席状态，**新增 D consumer、共享依赖和 schema 迁移须按同一依赖包处理**；数据库回退仅在隔离测试库，不触碰用户库。两份来源快照保留，但不能互当产品回退包。

本记录只给出静态兼容方向，最终组合的 import、数据库、HTTP、原生媒体、安装及正式导出均未验收。

## QA01 交叉核对与后续候选（补充）

QA01 独立的 `C:/Users/Administrator/Documents/Codex/2026-09-23/aivora-git-c-users-administrator-documents/work/qa01-mlt-20260928/D-REPO30-C19-FILE-DIFF.json` SHA `5D86A454495FD5D69F09B0E5AB32C22AC70958E46614BD843D7B4400FCD07B0F`，在 27 个 staged 项中列 23 ADD、3 REPLACE、1 NOOP；排除 NOOP 后，26 项 old/new 与 REL01 `rel01-d-repo30-c19-diff-observation-20260928.json` SHA `D214B1CBEA95D19FE8232E097FB055CF776B197501D02E8BEFE5B83A1AAB7A48` 逐项一致。QA01 清单内的“QA01 proposed writer”是已撤回的历史提议，以本记录开头的 MGR04 唯一写者裁定为准。QA01 四共享审查 `D-REPO30-LONGPATH-FOUR-SHARED-CONFLICT.md` 最新 SHA `CC16B2D398896A629B02F83781C50BE45361BD134292FAB5F6B286B517AF39A8`，已纳入 DEV06 13 件、公开 routes 六源和 DEV08 安全双文件；最终组合仍未冻结。旧 `3B0BFD70...` 是先前报告版本。

仅按静态 import 边，D 152 保留 147、替换上述四共享及 `media_asset_store.py` 五项、增加 helper 一项，形成 **153 唯一路径的核心候选**；DEV06 回核五份新文件新增的直接本地导入只有 helper。该集合不含 `media_asset_audio_inspection.py`、`media_execution_plan_contracts.py`、`media_asset_rights_reader.py`，故不能复现 Stage-A run04；若要复现该首关至少是 156 路径，仍要重新封包、审依赖与 QA。153 也不含 Resolver 的 MLT 选片/执行模块，不是 MLT 全链或正式产品闭包。

DEV08 另冻结 D 安全集成两文件 `work/dev08-d-safe-integration-20260928/CANDIDATE.json` SHA `5BA8B27DBA16F2A93F37267E205F2A88905DE48E304797752E1E532C6C027710`：`product_export_claim.py` 从 D `F1C068AF981A555166312B9EB47ABE5A36D476949A61A342C6DB5C2180019DBE` 到 `7AD9D77CA9F5E041F9AEFA053A8696CCE9AADE257A3B7A6E388D2928F9159BC5`；`product_export_runtime.py` 从 D `294B0A911193B36A2D62D8427D982E210966A6569341DA0D12A5C6057385249E` 到 `1A543BEAE9FF4CD42AC70F5C4704EE857D2E23EC11BBDD6C251AE197F9ECF1D3`。它们配对保持旧同键回放优先、空 allowlist 新键零工具发现的拒绝门，但未纳入 D152 外置 QA 或上述 153 候选。最终组合须由 DEV05/08 与 QA01 决定是否同包，以及增量依赖、旧 UNKNOWN replay、409、Job/取消和关停门；不能直接沿用 D152 的通过结论。

REL01 为审阅来源选择写了 `rel01-d-longpath-core-static-proposal-20260928.json` SHA `44CF64CF4128077EEDE5200BEF506E0F42A305E83EE1B4F696DC361840F1613D`，153 唯一路径、125 项与当前 c19 同 SHA、28 项不同；每项有源快照、候选 SHA、旧 c19 SHA/缺席。源文件哈希逐项回读。此 JSON 是**提议索引**，没有复制成合包，也未包含 DEV08 安全集成双文件、Stage-A run04 的额外三项或 MLT 消费者，不是 MGR04/QA01 签署的最终 manifest。

DEV06 另给当前 c19 的 13 件长路径静态候选 `work/dev06-c19-managed-longpath-minimal-20260928-v1/PACKAGE.json` SHA `32F7AE5865E13731870CB5C8EAE4D0FED335094FBE9B8D04F6D7FEAF165DE9D4`：13/13 来自 Stage-A47，同步后理论包含 11 新路径、`media_asset_store.py` 和 schema26→30 `repository.py` 两个替换；AST 与本地 43 模块依赖图零缺。该包仍含 DEV01 repo30、DEV02 confirmation schema、DEV08 product schema 跨 owner 依赖，也没有 D 的 sidecar/正式导出接线。它是可另审的局部候选，**不能单独同步冒称 D 已集成或长路径正式全链已验收**。

DEV06 的公开媒体 routes 六源候选 `work/dev06-public-media-route-candidate-20260928-v1/PACKAGE.json` SHA `AF85A22DD3B8C521067381B93C969739218C79B32DA2E89445321E55096AF6E0` 均在 c19 缺席，AST 可解析；它依赖前述 13 件且仍缺 DEV05 `runtime_resources.py`、`main.py` 鉴权路由接线和受控工具链。来源 A42 快照本身标记 `REVIEW_ONLY_NOT_FROZEN_NOT_SYNCED_NOT_QA`。assembly 对 rights head、音频固定拒绝、PENDING_REVIEW 的草稿预览语义尚需跨 owner 合同审查，不能因六源就称公开 rights/probe/assembly 可用。该候选未纳入 153 提议索引，须另签来源及接口门。

QA01 已另备 Win32 Job 无编码生命周期独立门：`D-WINDOWS-JOB-LIFECYCLE-QA-PACKET.md` SHA `F923C5000B476F9A0CA5E71D8C3DA6EA5D063A63B5D5DFEBEA5E86483768490E`，一次运行器 SHA `2F1ED73CF9136B4DD518A21BDFB6E0DA060D2F0EE8C12CC47A500A3C3DE3712F`，待签请求 SHA `9595A07247E9CA262C31A2C891E184D0BD7294526E1824F6317F705D75E7AD0A`。目前只有 AST 静检，尚无 one-shot approval 或输出，未运行 Job/编码器/产品进程；若 MGR02 后续签该独立门，首个 RED 即停止、不自动重试。它不属于本轮 Web 写窗或 D/长路径合包验收。

### Job 门实际结果（覆盖上段运行前状态）

MGR02 单次批准后，QA01 恰运行一次隔离 Job 原语门。`d-windows-job-lifecycle-01/RESULT.json` SHA `DA680C9DE0EDF3BA085201D3B8839CE534C47A25B9E40C3768E0C0BC8CB26B34`，状态 `PASS_ISOLATED_WIN32_JOB_PRIMITIVE_ONLY`；D152 清单运行前后均为 `F3775529D3D431D5D914F80FB74552CD23B96402142808970963D75C296160E9`。结果记录 Job 活跃进程 4→0、child PID 2292 与 grandchild PID 21872 退出、Job 句柄释放后才释放 owner，且未创建 DB。此证据只随相同 SHA 的 D152 Job 原语文件继承；最终合包的 sidecar 停序、route、claim、长路径及真实编码仍需独立 QA，c19 D 写窗仍关闭。

## 来源版本更正：Resolver54 为旧版冻结候选

DEV06 新一轮静态审与 REL01 作者树只读哈希回核发现，旧 Resolver54 `FILES.json` SHA `FB7B477C6BC5EEAF6DCA4D1A970275062ED658C0EFF6F3998AE1D73D9A537B72` 对当前作者树至少三处不同：`__init__.py` 旧空 `E3B0...`→当前 `333A85461A874678AC3C4FA0ABF4AE0F415BAAB2015384C85976E7EE42690D2A`，`repository.py` 旧 schema30 `C21049176963798A3D0DE0748EAFD5FF41F0294C759939A31BDFD694C5C43DD8`→当前 repo31 `4032F9C2E319AABE02FEC9BADC53B5F81E5BD4A592C6EFFA7622EFF07AFD7DD9`，`episode_media_assembly_store.py` 旧 `72F72CFA08349396D3853C92CCE63A3A66C77CF531544124563B15E44838AF89`→当前 `2E18464BAE6D0DC07383A4A15CDC804999F15F73D12B2974BF727089AADCC610`。repo31 新依赖 `provider_credential_ref_schema.py` 当前 SHA `B170FFC0C157D3C46109A7511BF10D9217B178EF05CFA77FD749C4C19C20932C`，D152/旧 Resolver54/c19 均无。assembly 新文件旨在同事务核 rights 历史链，缺损拒绝；目前是作者活树静态变化，未冻结/未独立 QA。

因此前文“四最终文件”“最终兼容方向”和 `rel01-d-longpath-core-static-proposal-20260928.json` 只描述**旧 Resolver54 冻结字节上的版本限定提议**。其源文件与静态证据仍有效，可以作为明确固定的可测试目标；但合包来源、owner 与跨包 QA 尚未签，不能据此申请写窗。新 assembly `2E184...` 的同事务 rights 修正与旧 `72F72...` 应由 DEV06 单列精确差异、合同依赖和 QA 场景，先验证它能否在 repo30 工作；只有出现具体表或符号依赖证据时，才把 repo31、credential schema 及 schema30→31 迁移加入本轮。MGR04 在 owner 签核后冻结选定组合，由 MGR02 排跨包 QA。不得机械追作者 HEAD 或把未冻结活树字节直接拼入 D152/Resolver54，c19 D 写窗继续关闭。

## DEV06 固定 v2 包的双视图阻断（最新状态）

DEV06 已给 repo30 固定的 rights 链 54 文件 v2 `dev06-resolver54-rights-chain-closure-20260928-v2/MANIFEST.json` SHA `AE9379444336873DDF94D5A5DD92A0A7C851671BB1BCCF90D51C70889BD15595`：设计上 53 项沿用旧 Resolver54，assembly store 单项拟从 `72F72...`→`2E18464BAE6D0DC07383A4A15CDC804999F15F73D12B2974BF727089AADCC610`，repo 固定 schema30 `C210...`。这没有机械追作者 repo31，方向符合版本限定边界。

但 QA01 与 MGR04 逐文件独立回读发现该**新包实物存在进程相关双视图**。例新包 `media_asset_selected_reader.py` 清单标 `88A2CB4A2C891D717FBACC3D3BB14B195F8B0419431E0AB6A5B05FEBFD34A303`，PowerShell `Get-FileHash` 原始视图为 `3D04269ADB01BD8129ADBC318A5734A2C34FB876F193595BC43F713F51405447`，文件头含 E-SafeNet/LOCK；REL01 同法回读该原始 SHA，旧 Resolver54 同名源仍为 `88A2...`。QA01 同时证实固定 Python 与 s2 venv Python `-I -B` 的明文读取视图可与新 manifest 54/54 对上；这只能证明指定进程视图，不证明同步/打包或产品消费进程可得到同一字节。DEV06 已撤回“跨进程 54/54 可独立回读 PASS”及新 v2 包取件声明，新 public 7 源包也暂停；旧 D152、旧 Resolver54、DEV06 旧 13 件包的各自固定证据不因此失效。

DEV06 另提供 `dev06-existing-source-map-20260928-v1.json` SHA `5D12E9039F6AD3D629764EFC88C343CC495F12FA123D2C7E2409AE08DEABBE7B` 作为只读现有路径索引，包含旧冻结 Resolver54 53 项与当前作者 assembly 一项；路径中活作者源会变，不是新冻结明文包或 c19 消费授权。解除 v2 取件暂停前，应由 MGR02 固定实际消费解释器的绝对路径、SHA、flags、依赖来源与加载前后逐文件 SHA/长度，并由 MGR04 证明其同步/打包进程可获取相同明文字节，或等外部保护条件变化后重审。当前不以 v2/新7源跑 import/QA，不写 c19 D。


## QA01 rights 链负面门：待独立签署，未运行

QA01 已封 `DEV06-RIGHTS-NEGATIVE-QA-PACKET.md` SHA `98743DB214E2D273DCA1199963CEF45D22C4544FDD55FB786693ED9A32C144B6`、待签请求 SHA `A4E19778D9E145EB553B642962CB4BDBBED6FFFCB46A9D49EC1B773188D2F2BC`、一次 runner SHA `D8207DA4EC9FB561842F575EB1859651E3EBE1B793B9DB5EDEBE46EB9A0A186D`，仅 AST 静检；approval 与输出均不存在，未产品 import 或复制 DB。拟用固定 Python `-I -B` 消费视图对 AE937 54 项加载前后哈希/长度及包来源校验，在外置 schema30 隔离 DB 验空链 PENDING/null、恶意孤儿 head 读写 RIGHTS_CHAIN_INVALID 且无 artifact、跨资产/缺 ASV ASSET_VERSION_NOT_FOUND 且无 artifact。它不读媒体 blob、不造人工 rights decision、不测 route/provider/MLT/c19。MGR02 若同意须按请求独立单次签署，首 RED 停且不重跑；Python 明文视图下的负面结果即便通过，仍不能解除 PowerShell/同步进程的 E-SafeNet 双视图取件阻断。合法 CLEARED/RESTRICTED 正链与公开 GET/POST 另待真实授权 seed。


上述 rights 负面门当前唯一待签版本为 runner `D8207DA4...` / packet `98743DB2...` / request `A4E19778...`；先前 runner `77B8D841...` 及相应 packet/request 已过时，不可签。QA01 说明此门不读媒体 blob，只在 media availability 前验证私有读取及恶意孤儿 head、跨资产、缺 ASV 的确定拒绝；合法 CLEARED/RESTRICTED 正链与公开 route 仍 `NOT_RUN`。approval/output 继续缺席。

## 独立两文件长路径切片队列（总控已准准备，尚未同步）

CTL 准备一个独立最小修复切片，唯一 c19 写者仍为 MGR04，须 MGR02 明确独占窗。只取冻结 Stage-A47 明文源：`managed_local_paths.py` c19 旧 `ABSENT`→`78FCCE4F28FF720F6610AB72EEC2C5C5AB179E7BEB758B980610303B7CA9D7AC`；`media_asset_store.py` c19 旧 `E2B2002D157DEBA5F2E03F5340AD83BE9B09BE4F5D77E1ACF614D3617A60AF8D`→`2954042D87754211526891A5CC3506DD55DCA78CBB349FC44D19D54FDDC105B8`。REL01 回读旧/源 SHA 符合。保留 c19 `repository.py` schema26 `BB366B214157007E2CB906EEADDC895E1ED60AE95DC97D86BEE686F137710E69` 与 `media_asset_routes.py` `931D14F8B3D3069ED89E224C6BF4EBF2EE4CA9CA34DAFC9A6415CD2E1B3B8770`，不带 repo30、公开 rights/probe/assembly routes 或 D 接线。该切片只承诺现有资产原件路径的最窄测试范围，运行验收另排；目前未写 c19。

若 MGR04 按保护窗口同步成功，REL01 必须从同步回执重建 D 最终组合的 c19 旧值：helper 与 store 将是目标新 SHA，后续同 SHA 文件记 `NOOP`，不能依据本次写前 `ABSENT` / `E2B200...` 再次覆盖。153 路径提议索引的 `old_c19_sha256` 是**本切片写前时点**，若同步则仅保留历史比较用途；D 其他路径与 repo30 前置仍须单独 QA/放窗。

### 两文件切片写后状态（覆盖上节“尚未同步”）

MGR04 在 MGR02 独占短窗完成仅两源 c19 同步；受保护 `20260928-c19-longpath-two-source-preflight-1/POSTFLIGHT.json` SHA `7E7FBC1ECA0E1FF66E99A35118A6758AF969239484B90D2BF5E42C123A8F2017`，状态 `SYNCED_NOT_QA_ACCEPTED`。REL01 另回读 helper `78FCCE4F28FF720F6610AB72EEC2C5C5AB179E7BEB758B980610303B7CA9D7AC` 与 store `2954042D87754211526891A5CC3506DD55DCA78CBB349FC44D19D54FDDC105B8` 与回执一致；repository 仍 schema26 `BB366B...`、media route 仍 `931D14...`。回执显示 API Python 原137件中仅 store 替换、另增 helper，其他136原件不变；HEAD211c、status110→111、相关进程0。`git diff --check` exit0 仅覆盖 tracked 文件，两目标是 untracked，不能据此证明其文本检查通过。该同步回执不是资产长路径运行 QA。

REL01 已在写后真实 c19 字节上重算版本限定索引 `rel01-d-longpath-core-static-proposal-post2src-20260928.json` SHA `EFACB23B45D73EBD498F7DDBB32C03A137D08A0DE52C2736D483987FCC03D81F`：153 唯一路径，127 项同 SHA/NOOP、26 项仍待新增或替换；helper/store 两项均为 NOOP。旧 `rel01-d-longpath-core-static-proposal-20260928.json` 的 125/28 与旧 SHA 只属写前历史，不可复用为下一窗口 old-byte 清单。新索引仍是旧 Resolver54 版本限定静态候选，不纳入 DEV08安全双文件或新 rights assembly 修正，也未跨包 QA/签署为 D 合包；c19 D 写窗继续关闭。

## D 合成提议暂挂：旧 workspace lock 命中 EXE RED

MGR04/REL01 对照发现，写后 153 路径静态提议 `EFACB23B...` 仍选 `workspace_owner_lock.py=94F62129EE9253425BBFE932D8822B032B7AF587D6DAB16DD0AE6870ABF410F6`，c19 当前该路径 `ABSENT`。QA03 同一旧 EXE 的短 TEMP 一次门 `RECEIPT.json` SHA `A5B699C08F20AE6C6B53759A1F7CCCB4093A6EBFF06DE63100A7102B932CEA59` 为 `RED_STOPPED`：解包成功后在 `workspace_owner_lock.py:147` 的 `os.open` 对 287 字符锁文件路径报 `FileNotFoundError`，父目录已存在；真实 Win32 根因仍待核。没有 ready/health/backup/worker 原生验收。REL01 保存精确暂挂索引 `rel01-d-longpath-proposal-hold-workspace-lock-20260928.json` SHA `732F9D12C478DE4104CC4ABA2ED17BF25AB095A1621E02CF503FB3DAAB1BD6D0`，把旧提议标为历史草案，不以旧锁源申请 c19 D 合成。

DEV05 是该文件唯一修复 owner；待其新源冻结、旧→新差异/依赖及独立 QA 后，REL01 才从当时真实 c19 字节生成版本钉住的后继提议。EXE 旧194源冻结结果不能冒充修复后的构建证据；c19 D 写窗继续关闭。

### DEV05 R2 lock 修复源已冻结，后继 D 提议仍待 QA

DEV05 唯一作者已冻结 `workspace_owner_lock.py` 旧 `94F62129EE9253425BBFE932D8822B032B7AF587D6DAB16DD0AE6870ABF410F6`→新 `103ED055A19839179977C6792E58619E71ADF724037560106837DCA9B798D427`。REL01 只读回核作者文件、旧完整备份、精确补丁 `00CCAFEDCD01DAEEA9B9722AA13284C2F8D593C2551CBA5B67645BEC5596343E`、`SOURCE.json` SHA `44C7C5A695532696264D40E2E10887BCAFD91441C0C72AE7F76EA8D67CFFA818` 与 `NOTES.md` SHA `D7E189C3F680167A51FD75394CE4C1CB1E2BCBFAA031F68F499B7F928B11440D` 一致。差异仅对长度≥260的 Windows 锁文件 I/O 使用扩展本地路径，锁身份与 fstat/name 比对、Busy73 和释放流程未改，未新增第三方依赖；作者静态 AST 通过，**未 build 或运行 QA**。c19该文件仍 `ABSENT`。

旧 EXE/短 TEMP `RED_STOPPED` 原证据保留。需以新源重新冻结构建、实测长 profile 启动、同 DB 双实例 Busy73、reparse 拒绝及正常关闭释放。QA/MGR02 确认新源后，REL01 才从届时 c19 字节生成后继版本钉住的 D/长路径提议；当前旧 `EFACB23B...` 提议继续 `HISTORICAL_DRAFT_DO_NOT_USE_FOR_C19_D_COMPOSITION`，D 写窗关闭。
