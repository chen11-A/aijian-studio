# REL01 下一串行窗口取件与最终主线保护记录

2026-09-28 09:39 CST 只读核对。此记录由已签原始字节快照和既有 REL01/MGR04 交接组合；执行窗口仍由 MGR04、MGR02 串行协调。作者候选与 c19 HEAD 均为 `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`。未写 c19、主目录或产品文件，未运行测试/构建。

## 放行门与最小取件序列

入口门：QA02 当前 Electron 原生视觉窗口完成正常关闭和后验；QA03 在旧 c19 保留 AC05 CONSUMED 组件 RED/UNKNOWN 原件并释放短窗；MGR02 明确释放后，MGR04 才开启 REL03 限定同步。任一目标旧字节或缺席条件与下表不符，即停对应批次，重新定冲突来源。

| 顺序 | 唯一来源与目标旧基线 | 消费者与 QA 门 |
| --- | --- | --- |
| 1 REL03 32 项 | `release-snapshots/20260928-rel03-integrated-32-1/SNAPSHOT.json` SHA `FF818539604AE69C0739BE3A5E3FAD1F77EC56120FF4F644BC33B1046E655568`；8 desktop、7 Web、17 API；c19 旧 11 文件精确 SHA、21 路径缺席见逐项表。取件仅从快照，旧/新逐项核。 | MGR04 同步；MGR02 安排 QA01 新建库及 22→26 隔离迁移、重开，QA03 前桌端 typecheck/build、业务与 AC05 回归，再排 QA02 原生门。无真实用户库迁移。 |
| 2a model 入口 | `release-snapshots/20260928-project-entry-model-1/SNAPSHOT.json` SHA `25B496043B2D8ED997CEE4294FF522945456C994FD2915E542A316E74B2F2F89`；c19 `apps/studio-web/src/aivora/model.tsx` 旧 `0B2F661BFB9F156489667603F070DA04AE3F28633452201236D65249996CE211` → 新 `4B6CCD357B481D772458EAE68B83B0A4BB7DA3574543109147EA4382FAA52A1B`。 | 消费 REL03 的 P22 adapter/studio；QA03 验正式新建持久化、偏好读取/重开及 AC05 入口回归，QA02 原生确认。`DemoApp.tsx` 非本包。 |
| 2b selected-reader | `release-snapshots/20260928-asset-selected-reader-1/SNAPSHOT.json` SHA `C5F97CE219FF6AA15722511505C9DE449C9C9D6B38BB59DB362891C28505134F`；c19 新路径缺席，快照文件 SHA `9A3268DA438BEB6E1085F4BECDC5DDF289AA9CB1BC906D875D2FBD4E84E96B68`。 | QA01 先在独立外置临时根验证零写、busy DB/WAL、竞态、跨项目与软删；与 REL03 schema26/ASSET01 功能门分开。MGR02 明确新窗口后才考虑 c19 取件。首次旧 SHA 5BED 不是有效取件源。 |
| 3 RIGHTS27 依赖包 | `release-snapshots/20260928-rights27-author-4-1/SNAPSHOT.json` SHA `E7AF795AB95A5F05519201A41D261C6AC6ABF4769008A64C30CCB984886BD8BF`；c19 四路径缺席。`release-snapshots/20260928-schema27-repository-delta-1/SNAPSHOT.json` SHA `2B616C0017045B8AACA37FD224681C5B920C18F0B8CC32219AD4D1F400AEA2BE`；repository 必须从 REL03 schema26 `BB366B214157007E2CB906EEADDC895E1ED60AE95DC97D86BEE686F137710E69` → schema27 `F5809A08198C6D7AC9C3EF8979761803912C59EA9E3B729BF31C8A2F1B241441`，不得从旧 schema23 直接覆盖。 | 仅在 REL03 22→26 隔离迁移/重开和 selected-reader 零写 QA 后，由 MGR02 排独立窗口；QA01 在外置临时根验 26→27 迁移与 RIGHTS27 读写/拒绝，保留原用户库。四文件尚未接路由/前端/P19 claim，不称整品通过。 |

注意：作者工作树的 `repository.py` 现已是 schema27 SHA `F5809A08198C6D7AC9C3EF8979761803912C59EA9E3B729BF31C8A2F1B241441`，与 REL03 schema26 快照不同，这是后续独立 delta，不把作者现文件代替 REL03 阶段原件。P19 额外桌面预检、REL02 安装文件、已同步 CSS、QA 专属测试均不在 REL03 32 项。

## REL03 32 项精确旧基线与冻结来源

09:39 CST 只读回核：REL03 快照字节 32/32 与 SNAPSHOT.json 一致，c19 旧 SHA/缺席条件 32/32 一致；HEAD 未变。下表每行均为仓库相对路径。

| 路径 | c19 旧 SHA / 缺席 | REL03 快照 SHA |
| --- | --- | --- |
| `apps/desktop/src/api-client.ts` | `455CAEE9755317D2C186A1CF5110AB1A308D1FA5ECCDE4C0F57F18019F2597C3` | `D694B1B1C6EF96D55DB941ABF221214634F45065DB07C99207A5C48660E7EA3C` |
| `apps/desktop/src/main.ts` | `EDE168AF7DB9A3F11A6DB428221FE38D596BB5230E10E26F5D9EABB0F8127FA9` | `443624A7007C6664DC232895464AA7DD41F4B38D14FB3315088B1AF9F702401E` |
| `apps/desktop/src/preload.ts` | `23AA3C2030F5E37E3A684BFDDD547729BEA0BCC2D13E22FFE05CAB154BD8D9A6` | `794006467A751EA1AE1F438EAE392BB7CE6082ADAE73C8D601A376EDF81340B1` |
| `apps/desktop/src/remote-source-extract-v2-contract.ts` | `1F813629D25070D8D377137EE212D0629F2B6F357332E67F6C0A9EB2AD408EBC` | `868AF718D49934ADE9E11A2C48152C22AA966565EB4F7E2CC29540EE19056639` |
| `apps/desktop/src/app-preferences-contract.ts` | 缺席 | `002C279CEF5A05EF4114D2172096B3EA13405EC23B848F556C25DD6DD647F273` |
| `apps/desktop/src/app-preferences-ipc.ts` | 缺席 | `26990CF6112F2A6FA19E811AF037B5283BC61044D95AD7BB464B640EAC684F0A` |
| `apps/desktop/src/media-asset-contract.ts` | 缺席 | `6D5C0FA402DC737AB3FEBF0494B2A5F48A6A944E5003A5470F17DCE1B34A6871` |
| `apps/desktop/src/media-asset-ipc.ts` | 缺席 | `D0D6AD576850B85365861FE555DAAFCCBB2E1D2A0A7B3924673E27622A07D4CE` |
| `apps/studio-web/src/api/studio.ts` | `0A594F8992AEE5929C6A144DE76DC4287EEA8EAEF5FBEE12E09D16F431D3756D` | `7521270E03EF55B649E8B0EA150FE859CB04EADFD7D84C0886FD856FDD378679` |
| `apps/studio-web/src/aivora/SceneAndAssets.tsx` | `0523F72A5D85247EDA214F40082D8862EDC6DBAC9AFA10CBA8AAEAC023E987AC` | `2F405B4E20FEA1AD072B89E7656E569E6D0C65BDC5A3BBDD31ED577DAB7F1B98` |
| `apps/studio-web/src/aivora/SettingsPage.tsx` | `D752CF7829F0F9A435783AFF34422B71D4D96C2CDDA487602FBDCD6DD4695B43` | `0DE9968C06088F73BA32FD2489EA9B56A74F5BA0C17AAFEF43C2CBD9982F1516` |
| `apps/studio-web/src/aivora/SourceExtractionPanel.tsx` | `5A309EB949F93513C7CF622A6ED4C967709B054806A28CBAD3B1382F7BED7709` | `DB425445A677B49AC6B181CF6E8D92283A69A73C7287B9DF4C788B1D4DF17CF3` |
| `apps/studio-web/src/aivora/adapters/appPreferences.ts` | 缺席 | `1DF5CA1020C719689711BD66336536D6CDCA7ABB808A53039BE87EF0803F8752` |
| `apps/studio-web/src/aivora/adapters/assetLibrary.ts` | 缺席 | `58A60DD7C0BCC8C344259A3EA8635DC84CFCC1D44088ADCF55F73BFB3B0857BC` |
| `apps/studio-web/src/aivora/adapters/remoteSourceExtract.ts` | `7B06E2814A0CCE68D065960E859E35A3DD0CED0DEE49FD6A9A7BAA28BFA8A2DF` | `69FAC685BC3667CF3D29BEC480458450B7C4C08F40767AB5616801CD59E5646B` |
| `services/api/src/aijian_api/main.py` | `5C0477C375BA2A25358A9F05E79DF8206C9496D715210E55B6320440E2FE9AAB` | `BBC596FDD33BDBD18A2ABEE96524CFDDCDA8A9D11AAFA76FC03FD11232D0900F` |
| `services/api/src/aijian_api/repository.py` | `D210EC7936267BF56B7B8CBB5DE33D30153629CC1D72A63CCF23E44BAADE72E5` | `BB366B214157007E2CB906EEADDC895E1ED60AE95DC97D86BEE686F137710E69` |
| `services/api/src/aijian_api/episode_script_contracts.py` | 缺席 | `057DC8290593356CD941BF0D2E34DC721BD1BEA4392FA387EDED8CFAE1F0554D` |
| `services/api/src/aijian_api/episode_script_schema.py` | 缺席 | `5D3F5D27777673EB301DD6EDD284E56CDCB767143D01C1D0F9922E8626E8F63A` |
| `services/api/src/aijian_api/episode_script_store.py` | 缺席 | `EE203A8A9B6C0D3D127FD6C88D94DA33854AD9C0516B4D8B214E18B4D66D9A1B` |
| `services/api/src/aijian_api/episode_script_routes.py` | 缺席 | `27FBCECDF973F318F4AF747ACBE9061E757252402C2DC9D9C687E8E7934838A8` |
| `services/api/src/aijian_api/app_preferences_contracts.py` | 缺席 | `20D04DA1EBA19DBA6415A3DB1392D4F8A17F2326C3C244241E21461A59833313` |
| `services/api/src/aijian_api/app_preferences_schema.py` | 缺席 | `9DC55503D88D26539500D56D3671C29FF6D08CEAF786BE5D21EA7AF4A15DCF69` |
| `services/api/src/aijian_api/app_preferences_store.py` | 缺席 | `3D193ACA7B8567DB36F94E602C67875F856FC408292139A8EA51A78C53DA7719` |
| `services/api/src/aijian_api/app_preferences_routes.py` | 缺席 | `FFA9E0C73DB2DEB03A405CFCE44C3C5FEBBF71C13EC265A7C749AC1E0FE87E43` |
| `services/api/src/aijian_api/media_asset_contracts.py` | 缺席 | `B2363B030BF20B17BBFD1BA3127D4B4B2E09F0CBC00D4A9D17A74A39334DF73A` |
| `services/api/src/aijian_api/media_asset_schema.py` | 缺席 | `85217B98DC473B177E7DD551AED195D95EB60C263E03E55DCE995495DE104CF2` |
| `services/api/src/aijian_api/media_asset_store.py` | 缺席 | `E2B2002D157DEBA5F2E03F5340AD83BE9B09BE4F5D77E1ACF614D3617A60AF8D` |
| `services/api/src/aijian_api/media_asset_routes.py` | 缺席 | `02F85E078A0C3C9450342E7064A7524CA0EC51135D746EEC253A21CBAE283D13` |
| `services/api/src/aijian_api/product_timeline_export_contracts.py` | 缺席 | `69B353D5483D9E511526FF47D57741A0B0C8B240216F7AF04D02477CAD7425F0` |
| `services/api/src/aijian_api/product_timeline_export.py` | 缺席 | `7BC471EF4494897A7C534C55375F274A66CC6E96D806CCF220FF6DED77A2C8D6` |
| `services/api/src/aijian_api/product_timeline_export_routes.py` | 缺席 | `95683D41F23925A0E3E47C879D909BD9B46059A1795010C7045F1E744B649D29` |

## 后续 RIGHTS27 四新文件

| 路径（c19 旧均缺席） | 快照 SHA |
| --- | --- |
| `services/api/src/aijian_api/media_asset_rights_schema.py` | `3F875459907319E7365A3D021D2803E5146DDB71C73E99DF44E2E38DF82C91FE` |
| `services/api/src/aijian_api/media_asset_rights_contracts.py` | `E6DA0D812E6E46B51E4EFEC5EF2A5955EE3A054E1865966A2038EB9AF301EDDB` |
| `services/api/src/aijian_api/media_asset_rights_store.py` | `86A5F851E71ECCC5D75E7AC66B03D240C3E9CB0B606D56762A682E4C777A9079` |
| `services/api/src/aijian_api/media_asset_rights_reader.py` | `BF38C626440888D474872C8C7E6093EC96F41B0211A66EAE1870A8B6D52EE676` |

## 主目录 13 项保护与最终收敛来源

09:39 CST 主目录 HEAD `7523f010561b91c5457aca4b38919801605c42d7`、13 路径仍在；此表是未来合并前的逐项冲突来源，不执行合并。

| 主目录路径 | 当前状态与来源判定 | 最终处理门 |
| --- | --- | --- |
| `apps/studio-web/src/components/FakeWorkflow/fake-workflow.css` | 主目录旧删除；候选 HEAD 同样删除 | 保留删除意图；主目录原状态不清理，最终按候选基线复核。 |
| `apps/studio-web/src/components/InvalidationHistory/invalidation-history.css` | 主目录旧删除；候选 HEAD 同样删除 | 保留删除意图；主目录原状态不清理，最终按候选基线复核。 |
| `apps/studio-web/src/components/ProductionShell/production-chrome.css` | 主目录旧删除；候选 HEAD 同样删除 | 保留删除意图；主目录原状态不清理，最终按候选基线复核。 |
| `apps/studio-web/src/components/ProductionShell/proposal-review-card.css` | 主目录旧删除；候选 HEAD 同样删除 | 保留删除意图；主目录原状态不清理，最终按候选基线复核。 |
| `apps/studio-web/src/components/ProductionShell/source-extract-run-launcher.css` | 主目录旧删除；候选 HEAD 同样删除 | 保留删除意图；主目录原状态不清理，最终按候选基线复核。 |
| `apps/studio-web/src/components/ProviderSettings/provider-settings.css` | 主目录旧删除；候选 HEAD 同样删除 | 保留删除意图；主目录原状态不清理，最终按候选基线复核。 |
| `apps/studio-web/src/components/TaskQueue/task-queue.css` | 主目录旧删除；候选 HEAD 同样删除 | 保留删除意图；主目录原状态不清理，最终按候选基线复核。 |
| `apps/studio-web/src/components/Timeline/timeline-workspace.css` | 主目录旧删除；候选 HEAD 同样删除 | 保留删除意图；主目录原状态不清理，最终按候选基线复核。 |
| `apps/studio-web/src/styles.css` | 主目录旧删除；候选 HEAD 同样删除 | 保留删除意图；主目录原状态不清理，最终按候选基线复核。 |
| `apps/studio-web/src/main.tsx` | 主目录旧删除；候选正式入口 SHA `4D7E16613EE27A073DA9C972B5270EF5385A9EF2E26A4288DBBB214F79276D0C` | MGR01 已具名决定候选保留 AIVORA 正式入口；不据此覆盖主目录。 |
| `package.json` | 主目录修改 SHA `B49F110327A6A2710B5AFE39123B14FBB75855F8DEB8B290B710B276340D3F1C`；候选 SHA `49C29668A12945B3ECEF191FC188585C2F297B2625F06AD087EC7C96043B5821` | 只按 dev:api / dev:api:reload 意图合入候选脚本并再审；不以主目录旧整文件覆盖。 |
| `services/api/tests/test_dev_commands.py` | 主目录与候选均 SHA `1A5DF6C6BA259B2B570F6AD00CD017EE8C8F98E66BCECD2669D28266E71F7067` | 由候选作者包作唯一内容来源，主目录原件留到签署。 |
| `.pnpm-store/v11/index.db` | 主目录本机缓存 SHA `2B793A22A3B541C9DE91DABD286BE285EDD8669B612B35B730870745AEA5D1A9` | 排除产品/提交/上传；保留原地。Git 枚举缓存侧目录曾出现瞬时不存在警告，不据此清理。 |

最终主目录整合前，由 MGR04 重取已通过 QA 的同一源码/构建/安装输入指纹、主目录 13 项和上述冲突来源，依总控授权受控集成；不 reset/clean、不强推。尚待队列：P19 接线及正式导出 QA、REL02 安装与许可、整品 AC01–AC10/真实服务，不能挤入本次 REL03 窗口。

## 窗口状态增量（09:39 取件基线之后）

MGR04 已独立核收 QA02 v6 的正常关闭、后验和窗口释放，`window-release` 证据 SHA256 `549C3A0384BC630C1509A4C4330D2577851B7555DE739C649512AC17941BBB09`。1424×720 CSS 视觉为局部 RED，已交 DEV04；这不延长 QA02 对 c19 的占用，也不能改写原始失败。REL03 当前剩余入口门为 QA03 在旧 c19 保留 AC05 CONSUMED 短窗 RED/UNKNOWN 并释放，以及 MGR02 明确同步放行；不再等待已完成的 QA02 关闭。REL03 的32项来源、旧 SHA 表与后续 schema26→27 顺序保持不变。

## REL03 同步后状态与后续独立包（09:52 CST）

前文 09:39 旧基线表及入口门是**同步前时间点**，不可再用于判断 c19 当前源码。MGR04 已按 MGR02 正式窗口将 REL03 快照 `FF818539604AE69C0739BE3A5E3FAD1F77EC56120FF4F644BC33B1046E655568` 的 32 项保护同步 c19；写前旧 32/32 与快照 32/32 核准、备份旧 11 文件，写后新 32/32 及非目标 78/78 状态与字节不漂，HEAD `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`，status 87→110，相关进程 0。固定回执 `release-snapshots/20260928-rel03-c19-sync-1/SYNC-RECEIPT.json` SHA256 `97373084ED5F6BA642EEF7DF7F504410F84D8FA5CA2946198AE9C5B3FEB1E101`，状态 `SYNCED_NOT_QA_ACCEPTED`。REL01 09:51 只读再核 c19 目标 32/32 与回执新 SHA 一致；不据此替代独立 QA。

MGR02 应串行安排 QA01 使用外置隔离库执行新建、22→26 迁移与重开，QA03 再做 Web/Desktop 强制 TS/build 及业务回归，后续由 QA02 在固定同源产物作原生门；构建会写 dist，须与源码同步窗口分开。QA03 已对 REL03 固定输入完成五项外置定向测试合计 14/14：旧 AC05 CONSUMED 的 adapter、desktop client、HTTP 正向链及 P22/P17；原始记录在 `work/qa03-ac05-front-20260924/run-04-rel03-targeted-20260928/`。该结果未包括强制 TS/build、Panel 自动 GET 或 model 正式入口，不能升格前桌端全验收。

下一取件保持小包分离：

1. model 入口仍使用前文 `25B496...` 单文件快照；必须在 REL03 P22 adapter/studio 同窗测试正式新建持久化、偏好读回与重开后，按 MGR02 新窗口同步，不把它算入已同步32项。
2. selected-reader 仍是新路径 SHA `9A3268DA438BEB6E1085F4BECDC5DDF289AA9CB1BC906D875D2FBD4E84E96B68`，先由 QA01 独立外置根实测零写与竞态，再决定 c19 窗口。
3. RIGHTS27 已从四文件+repo delta 扩成 MGR01 签署的七文件 `BACKEND_ONLY` 闭包，固定 `release-snapshots/20260928-rights27-backend-7-1/SNAPSHOT.json` SHA256 `8F5650849D3110003F9E50208551C6F2B56721F4FD2BD23DDE582DEE1545FF2C`，REL01 快照字节 7/7 复核一致。c19 下一目标旧基线：`repository.py` schema26 SHA `BB366B214157007E2CB906EEADDC895E1ED60AE95DC97D86BEE686F137710E69` → schema27 `F5809A08198C6D7AC9C3EF8979761803912C59EA9E3B729BF31C8A2F1B241441`；`main.py` REL03 SHA `BBC596FDD33BDBD18A2ABEE96524CFDDCDA8A9D11AAFA76FC03FD11232D0900F` → 已备份的原始 `8B3D6D0EA0EC1B6FAACEEB16D12FEA5CD73FFD4284461C2FBAEBBA3A2E26B170`；四 rights 文件及 `media_asset_rights_routes.py` 共五新路径应仍缺席。七文件逐项源位置与新 SHA 见该快照。必须先 REL03 schema26 隔离迁移 QA 和 selected-reader 独立零写 QA，再由 MGR02 排 26→27 外置库迁移/路由拒绝测试与串行 c19 窗口。此包不含 UI、P19 最终 claim、B-readiness 或 packaged 后续 `main.py`。
4. 1424×720 CSS 局部 RED 的作者修复另封 `20260928-source-preview-low-height-css-1/SNAPSHOT.json` SHA256 `673497C7AAEA3C5B836CD2F1B991C6298E606D42809D084F4DE2E782C696EA9E`，旧 `FCCB6ACC0476641B0BFBE0D47028D008CF2C0FBCA35956F2B053C5D49EA16523` → 新 `D57ACFD69CE6190A85C0A4041798CF572889534D0FA228BDA01A5A12C83E2B6E`；由 QA03 新同源 build 及 QA02 1424×720/881、1024×881、Tab 原生复验，不能混入本次已同步 REL03 回执。

主目录 13 项与前文来源/冲突表保持原状；本次 REL01 仅维护管理记录，不写 c19 或主目录。

## REL03 局部 QA 与低高度 CSS 同步时序更正（2026-09-28）

上节把低高度 CSS 写为“后续未同步”是当时状态，现以此节为当前状态。MGR02 已独立核收 QA01 在外置 `C:\aqr1` 隔离库对 REL03 后端 7/7 PASS、exit0：覆盖 fresh/reopen、旧22/23→26迁移、失败迁移回滚、双 episode CAS/幂等、1px PNG 资产/篡改/跨项目与偏好重开；raw SHA256 `6260A89A25EE515EF474A74DAF8F8BD7778B36C0382D58AB6C5BD2681C19C2F8`，证据清单 SHA256 `295B2240638DA68771A1F3A5B6C16C75B10618F72F8E0F36DD528C529517608A`。QA03 在固定 REL03 源的前端五组定向 14/14、exit0 已完成。两组只属局部 QA，不覆盖强制 TS/build、原生、真实 provider、正式导出或安装。

MGR02 在 QA01/QA03 两短窗释放后，单独放行低高度 CSS；MGR04 已将 `20260928-source-preview-low-height-css-1` 的唯一文件同步 c19，回执 `release-snapshots/20260928-source-preview-low-height-css-c19-sync-1/SYNC-RECEIPT.json` SHA256 `6F76ABAFEE75BFFE219F3E1646A17296989B39D96D7D59D7F56B48F3955E0EE8`，状态 `SYNCED_NOT_VISUAL_QA_ACCEPTED`。c19 CSS 旧 `FCCB6ACC0476641B0BFBE0D47028D008CF2C0FBCA35956F2B053C5D49EA16523` → 新 `D57ACFD69CE6190A85C0A4041798CF572889534D0FA228BDA01A5A12C83E2B6E`；回执记 REL03 目标 32/32、非目标状态文件 109/109、HEAD211c、status110 与相关进程0均未受该单文件同步破坏。REL01 回读回执 SHA/state，未另写 c19。

QA03 正在对固定源执行强制 Web/Desktop TS/build 与布局检查；完成并固定 dist 清单后，QA02 再按 MGR02 窗口复验原生 1424×720/881、1024×881、Tab 与重开。旧 720 RED 保留，CSS 同步本身不等于视觉通过。model、selected-reader、RIGHTS27 七项及后续 B-readiness 均未混入已同步包；主目录 13 项仍保持原状。

## D线 MLT 适配验证独立取件与回退边界（2026-09-28 10:20 CST）

用户已批准在唯一作者候选及现有 QA 流程中做本地 MLT **适配验证**，尚未批准替换正式默认引擎、真实用户工程迁移、新工具静默安装、付费外呼或发行。QA02 v7 在首 BrowserWindow 前退出，CSS/G1 未到，属该次原生启动 UNKNOWN；保留其输入和原件，不把 A/C/D 源塞入该窗口。

### 已封 D 源与目标旧基线

REL03 已在 c19 同步的 `product_timeline_export_contracts.py`、`product_timeline_export.py`、`product_timeline_export_routes.py` 三源码 SHA 分别为 `69B353D5483D9E511526FF47D57741A0B0C8B240216F7AF04D02477CAD7425F0`、`7BC471EF4494897A7C534C55375F274A66CC6E96D806CCF220FF6DED77A2C8D6`、`95683D41F23925A0E3E47C879D909BD9B46059A1795010C7045F1E744B649D29`；当前正式预检只读返回 `BLOCKED/NO_EXPORT_CLAIM`，未创建正式编码任务或输出。旧开发导出 `development_timeline_export.py` 使用 FFmpeg 且身份为 `DEVELOPMENT_EVIDENCE`，不充当正式多轨产品路径。

MLT 适配前十源码安全点：`release-snapshots/20260928-d-pre-mlt-source-10-1/SNAPSHOT.json` SHA256 `0D9CA5DA67FC08687C33B74F45A647D455FE5A281D0613014630ACE761D864A5`；正式D七项、工程TEST草案三项，c19 十个目标路径均缺席。REL01 10:19 定向回读快照 10/10、作者源 10/10 与下表匹配。状态 `PRE_MLT_AUTHOR_SOURCE_FROZEN_NO_C19_SYNC_NO_QA`，正式 claim allowlist 空、工程 schema31 未注册且无 route/worker；不视为可运行候选。

| D10 路径（c19 当前缺席） | 安全点 SHA256 |
| --- | --- |
| `services/api/src/aijian_api/product_export_schema.py` | `5FE02402F77DEF10B0DA1CFE4FDEBE548F568EBE42FE3B1A471F7123D4E07EFE` |
| `services/api/src/aijian_api/product_export_contracts.py` | `080FA93C9B78D156350609841117BE96DA67101750425A66A163F22191185B10` |
| `services/api/src/aijian_api/product_export_store.py` | `58FBF5CB525283CDF18FFD5A197AD6C58E867DEBF63A3477AE13A22F7574E9E4` |
| `services/api/src/aijian_api/product_export_output_verify.py` | `769B6EB6DCD7C7235523E7F3832B48E41840E16859CB2A2393BD4228B0B88F8A` |
| `services/api/src/aijian_api/product_export_render_plan.py` | `74675F4EC7D92D94A8AC8F2440630B48F88E6D844FA9F8CDFCC331D2FE7FFC1C` |
| `services/api/src/aijian_api/product_export_claim.py` | `A5EB43D6A2356EDA0C9A66424247DA9437D66AE19C6CE1CE7DD52CE626693BCF` |
| `services/api/src/aijian_api/product_export_encoder.py` | `26634F0C2C831EAF3CD723121BF638D62E58B2028210948EF2EB08ED6CDA775A` |
| `services/api/src/aijian_api/engineering_test_export_schema.py` | `4808177EC8155A488DD3F219D46F2F6F2D546BE9C474FC2D342B3CB806DF3C44` |
| `services/api/src/aijian_api/engineering_test_export_contracts.py` | `A987B536A671FAD3501FE37A4BAD9D21DFCB032B46D732BBCC623C79E1A46BDA` |
| `services/api/src/aijian_api/engineering_test_export_store.py` | `B1635AB570B6EE5CB30202AA276A9682252279A7887513382CC323F1F149D835` |

另有 `20260928-schema28-30-migrations-4-1/SNAPSHOT.json` SHA `F9F5A954B2E7A59DE4B6C1FA0A0CE0A69EEB6F64BDEB9EA8E36402401D43913E` 保存D依赖的 `product_export_schema.py` 及 repository 27→28→29→30 逐版原件；它是依赖开放的迁移包，需 RIGHTS27 先过独立 QA 和逐版隔离升级/回滚/重开，不从作者最终 repo30 直接覆盖 c19 schema26。C线旧六项快照 `EEC486...` 已因 probe_routes 后续改写失效，不能作为 MLT 工程消费者取件源。

### MLT增量唯一作者与暂定源

MGR01 已具名：DEV06 唯一写 `media_execution_plan_contracts.py`、`episode_media_execution_plan.py` 的只读冻结映射；DEV08 唯一写 `mlt_execution_adapter.py`、`mlt_execution_worker.py` 的执行/取消/输出验证；DEV07 唯一写桌面 `media-preview-session-contract.ts`、`media-preview-session-ipc.ts` 及 host bridge；DEV04 唯一写 `MltPreviewPanel.tsx`、`adapters/mediaPreviewSession.ts` 与现有播放器挂载；DEV01 只做共享迁移/CAS/接口短审。下表只是 10:18 作者树读到的在写状态，**未封包、不可同步**。

| owner / 暂定路径 | 10:18 作者 SHA 或状态 |
| --- | --- |
| DEV06 `services/api/src/aijian_api/media_execution_plan_contracts.py` | `19E8C75C0E759263775D623F1AA35247924C183F9DDAB5D60169E009B03CA71F` |
| DEV06 `services/api/src/aijian_api/episode_media_execution_plan.py` | `C509DE53AE077EFD1231BF5AB73D1058FABFCAB65FF21FA852CB44180427CC37` |
| DEV08 `services/api/src/aijian_api/mlt_execution_adapter.py` | `当时缺席` |
| DEV08 `services/api/src/aijian_api/mlt_execution_worker.py` | `F600202027D8E64FA384DBFD83EEC50ACE55C33C4D2F6A20652B79CDE62B45D3` |
| DEV07 `apps/desktop/src/media-preview-session-contract.ts` | `9F2DB4A16FA3CC2C31C0D7542B39D109D5CB4C733289E2872B6AE6130B1C0D1E` |
| DEV07 `apps/desktop/src/media-preview-session-ipc.ts` | `23FC9DA96AFC40FE20FC3AAE678F350509355E011B8A50A95C2BA759CD16989A` |
| DEV04 `apps/studio-web/src/aivora/MltPreviewPanel.tsx` | `当时缺席` |
| DEV04 `apps/studio-web/src/aivora/adapters/mediaPreviewSession.ts` | `40DE9E60C3E93972D7DA1952B430B7897F8E9B6EC1597795C492629519295502` |

### 唯一 TEST 工程、工具与回退

ART04/MGR03 最终规格：`C:/Users/Administrator/Documents/Codex/2026-09-23/aivora-git-c-users-administrator-documents/work/art04-mlt-test-20260928/MLT-唯一合成TEST工程规格.md` SHA256 `7D1E494083EF6702E9B17F8A2D923A46E03A763525E2DF3737C33AFC7ED07FE0`。125帧/25fps/5秒；双视频重叠25帧与一次叠化、独立1000Hz非人声提示音两段、220Hz BGM、两字幕、两音轨增益0。五件合成输入、工程和MP4尚未产生，实际路径/字节/SHA不得预填；旧AF56/D687规格仅历史。现C合同只支持顺接，重叠MLT验证必须独立表示，不能冒称C已支持多轨。

REL02 Windows只读调查取最新作者文件 `packaging/windows/MLT-WINDOWS-READONLY.md` SHA256 `EA191C4DF3E8C3CA816ACAF66A00981D9CC1BDC8D29B1AB5503C49F57AF74D30`；早先A2E2/107C哈希已被更新替代。调查在限定PATH/标准目录未找到可信MLT；官方MLT源码、Shotcut portable ZIP均只是待总控审查的隔离TEST获取方案，不是已安装工具、可复制产品runtime或已核发行许可。下载/解包/安装动作与工具版本、来源/完整SHA/依赖/许可需先单独核准。

回退边界是版本/选择门，当前没有实际回退操作：MLT新文件和TEST工程只在显式隔离验证路径使用，验收前不改正式D默认 `BLOCKED/NO_EXPORT_CLAIM`，也不改现有FFmpeg `DEVELOPMENT_EVIDENCE` 路径或媒体锁。若MLT工具、依赖、输入或预检缺失，停止该TEST并保留D10安全点原字节；不能把旧单段FFmpeg结果冒充双视频A/B。若未来有持久operation已被claim且执行结果未知，需按原身份只读核回执并维持UNKNOWN，不自动改走FFmpeg二次编码。D10仅保护那10条路径，不回滚A/C/RIGHTS或主目录其它作者增量。

QA窗口由MGR02串行：先固定五件合成资源和TEST脚本/字幕ID及SHA，DEV07/DEV08同一清单交接；QA01在外置根核工程映射、隔离、哈希、幂等与取消，QA03核接口/播放器组件与必要同源build；QA02 v7 UNKNOWN 单独诊断关闭后才排真实Electron预览/解码与MP4一致性。原生实时预览与预渲染文件播放分别记，逐帧、混音PCM、字幕边界、seek/暂停、预览/导出一致、缺件/取消/关闭进程均需独立证据。DIALOGUE_SPEECH_NOT_TESTED、SFX缺席范围须保留；没有性能阈值只报告测量。当前不写c19或主目录，不运行MLT/工具安装。

## MLT TEST 规格与 v7 诊断增量更正（2026-09-28）

上节记载的 ART04 规格 `7D1E494083EF6702E9B17F8A2D923A46E03A763525E2DF3737C33AFC7ED07FE0` 现为**历史版本**。MGR03/MGR02 已固定同一路径当前规格为 8,414 bytes、SHA256 `4323DFEF3EEF9337BAF49A5118DE1397B4C2AFBE2E67768E133F87C950DDF16D`，REL01 回读吻合。唯一新增的执行约束：320×568 的 V1/V2 合成源到 1080×1920 画布在本 TEST 中明确 `STRETCH_TO_CANVAS`，无裁切/留边，左右白色识别条完整可见；该轻微变形不能作为正式作品默认映射。125 帧/25 fps、视觉重叠、两条测试音轨、字幕、增益 0 和 `DIALOGUE_SPEECH_NOT_TESTED` 仍按当前规格。MGR03 已将新 SHA 交 DEV06/07/08、MGR02/QA02、REL02/MGR04；以后 TEST 工程/资源清单一律绑定 `4323...`，不按 `7D1E...` 取件。五输入/工程/MP4仍待实际生成与哈希。

QA02 v7 原 runId 仍为首 BrowserWindow 前 `STOP_OR_UNKNOWN`，不能事后写成已确认其原始 stderr。QA01 在相同固定 c19 sidecar 源与命令、全新外置 profile 单次独立复现启动阻断：PID8492 exit1、握手前无 stdout，stderr SHA256 `1C957DB1A71A61A4C4B2925294700492F7F56AE101DD3F7E38635CB3CB53EF4C`，capture JSON SHA256 `5642A4CA8FE322C8F2E66318E85533962B1F1A9A68ABFAF78F297F096953E314`，诊断 `work/qa01-sidecar-diag-20260928/DIAGNOSIS.md` SHA256 `98067E970976DAAF614BFBE5A86C83778ACB8C91581C0BFBDF188ACB11D64FE5`。traceback 定到 `media_asset_routes.py:203` 的 `get_content` 返回注解 `Response | JSONResponse` 与 FastAPI response_model 推断冲突；可解释首窗前退出，但独立复现不冒作 v7 本轮原文。MGR02 已派唯一 owner DEV06 在作者树作该文件最小修复；需先冻结旧/新 SHA，由 MGR04 单文件保护同步，再 QA01 隔离 create_app/sidecar 握手，QA02 用新 runId 原生复核。不得把 A42、MLT、RIGHTS 等包混入启动修复窗。

Shotcut portable ZIP 获取方案已由总控统一向用户请求确认，**尚无同意**；仍不下载、解包、安装或运行。REL02 的只读调查和 D10 安全快照继续只作版本输入，MLT 实验不替正式默认 D 路径。

REL02 对齐当前 `4323...` TEST 规格及 DEV08 固定 XML 模块需求后，`packaging/windows/MLT-WINDOWS-READONLY.md` 再更新为 SHA256 `63571A58CB40901B48AD081AD6999424BD0F3E09BE536F6A0298C01643AEB0ED`（REL01 回读 9,654 bytes）；前文 `EA191C...` 也仅是历史取件值。其 luma/mix/qtext/avformat/xml 与 Qt 依赖仍须按实际工具包核，Shotcut ZIP 继续待用户确认。REL02 安装验证脚本变更属独立安装主包，不纳入本 D10/MLT 同步或 QA 窗。

## MLT TEST 对 A 线剧本合同的前置门（2026-09-28）

DEV02 报告且 REL01 10:38 只读回核：c19 `services/api/src/aijian_api/episode_script_contracts.py` 仍旧 SHA256 `057DC8290593356CD941BF0D2E34DC721BD1BEA4392FA387EDED8CFAE1F0554D`，其 DIALOGUE 合同缺 `delivery`；作者活树 SHA256 `6F1C0308092089F23B64075B48F45FC848A0A2EA5694A9289A118EA5EED8A57B` 明确要求 `delivery=ON_SCREEN|OFF_SCREEN`。新 SHA 同时存在已封 A SCRIPT/confirmation 九源码快照 `BE3256CDD8131BCC9A322D0236E3E158E2E20F199F5006196402350682397F0C` 与 A 运行 42 项快照 `C2DCBC1283B6056F4101357B4850307A8F1640FC21F25313E0720A19C26DB2EC`；两包仍是作者封包，未同步/未QA。

当前唯一合成 TEST 的两个脚本块须显式 `OFF_SCREEN`，不删 `delivery` 或填暗示真人语音的默认人物；现为1000Hz非人声提示音。旧 c19 合同会使这类创建请求422，故在 MGR04/MGR02 受控窗口按完整 A 运行包和其有序 repository 迁移、main 注册同源同步，并由 QA 独立回读精确新 SHA 前，SRT 第五输入及 TEST fixture 创建保持 `BLOCKED`，不执行 DB/API POST。不可为解此门单独拷合同、绕过验证或把静态封包称已运行。已将该依赖通知 MGR04/MGR02；REL01 未写 c19、主目录或 TEST 资源。

### TEST 剧本合同前置门的限定更正

上一节“必须完整 A 运行包及其迁移/main 同源同步”**不再是 MLT TEST 解除422的唯一方案**。DEV02 后续静态审指出：c19 已有 schema24/25 与 `episode_script_routes.py`、`main.py` 路由注册；REL01 定向回读 c19 当前 `repository.py` schema26 SHA `BB366B214157007E2CB906EEADDC895E1ED60AE95DC97D86BEE686F137710E69`、script store SHA `EE203A8A9B6C0D3D127FD6C88D94DA33854AD9C0516B4D8B214E18B4D66D9A1B`、routes SHA `27FBCECDF973F318F4AF747ACBE9061E757252402C2DC9D9C687E8E7934838A8`、main SHA `BBC596FDD33BDBD18A2ABEE96524CFDDCDA8A9D11AAFA76FC03FD11232D0900F`。作者完整合同 `6F1C...` 除 DIALOGUE `delivery` 外还含 story_bible/source_extraction/acceptance 字段；若只拿它整文件覆盖 c19 旧合同、保留旧 store，可能接受未验证来源声明，不能作最小 TEST 修复。

DEV02 建议的**待签最小方案**：从 c19 旧合同 SHA `057DC8290593356CD941BF0D2E34DC721BD1BEA4392FA387EDED8CFAE1F0554D` 仅增加 DIALOGUE `delivery=ON_SCREEN|OFF_SCREEN` 验证；TEST 两块明确 `OFF_SCREEN`，不伪装为真实人声。必须先由 MGR01/总控签这一单文件差异、生成并封存新精确 SHA，再等 MGR02/QA02 当前原生窗口释放，由 MGR04 按旧字节保护同步。QA 在**全新隔离 TEST DB** 先证无旧 script 版本，执行旧合同422与新合同201/GET exact 的有界验证；正式用户库旧版兼容另行处理。完整 A 业务包继续独立走其依赖和 QA 门。当前最小包尚未签署或写入 c19，SRT 第五输入/TEST fixture仍 `BLOCKED`，无 DB/API POST。本次仅更正交接边界。

### 最终前置门：正式兼容包未冻结（覆盖上两节方案）

总控/MGR04 新前置已撤销“必须完整 A 包/迁移/main 才能解 MLT TEST 422”为唯一途径，也**未批准**上节的旧合同加 `delivery` 后在全新空 TEST DB 执行422→201/GET作为产品或 MLT 业务 fixture 通路。DEV02 核旧/新 script store 均对 `model_dump` 重算内容哈希；单增 `delivery` 默认字段可能改变旧 ACTION/DIALOGUE 读回、内容哈希与幂等身份。`QA_ONLY_NEW_EMPTY_DB` 仅是研究草案，不是同步或执行授权。

当前可取件条件改为：MGR01 先让 DEV02 解决既存草稿读取、hash 与幂等兼容，固定**最小正式兼容依赖包**的唯一作者、精确旧/新 SHA、差异与回退范围；不得盲加迁移或改写历史版本。随后 MGR04 在 MGR02 释放独立窗口后按该签包受控同步，QA 对旧稿兼容与新 TEST 语义分别核证。A42/B31 及现有快照与组合历史原样保留，不为这项修复覆写。QA02 当前原生窗口不动；在兼容包冻结且 QA 签署前，SRT 第五输入、TEST fixture 的业务创建仍 `BLOCKED`，无 DB/API POST。前两节所列整包和空库路径只作决策历史，不是当前执行指令。
