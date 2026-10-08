# REL01 恢复后的版本合并边界（只读）

抓取时间：09/28/2026 08:39:32。本报告所称当前均指这一时间点；作者和 QA 同时工作，实施前必须重新冻结逐文件 SHA。
机器清单：`C:\Users\Administrator\Documents\AIVORA\management\manager-handoffs\rel01-live-diff-manifest-20260928T083932.json`；SHA256 `83AD1843EE593663995F546A9F90D7CE1B60E702AEA7274676E0D95A0ABF72EE`。该 JSON 逐项记录三棵树的路径、Git 状态与文件 SHA256；删除项的 SHA 为 null。

## 同版边界与历史快照

- 唯一作者候选 HEAD `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`，未提交路径 103；c19 HEAD `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`，未提交路径 87。两树共享 81 路径，其中 76 路径状态和字节一致、5 路径 SHA 分歧；作者侧独有 22 路径，QA 侧独有 6 路径。当前 c19 由 MGR02/QA03 独占。
- 受保护主目录 HEAD `7523f010561b91c5457aca4b38919801605c42d7`、状态 13：10 个旧 CSS/入口删除、`package.json` 修改、`.pnpm-store/v11/index.db` 与 `services/api/tests/test_dev_commands.py` 未跟踪。Git 枚举本机缓存时出现短暂目录不存在警告；清单仍逐项记录 13 路径，此处不据它推断缓存目录稳定。
- basic12 历史 12 文件中，仅 `apps/studio-web/src/aivora/model.tsx` 和 `services/api/src/aijian_api/development_timeline_export_routes.py` 与作者/c19 同 SHA，其他 10 路径已变。原指纹 `92C239ED530622FCFF63EFE9242B2DA1EC7B55E5F69D9E2AF94919EDA06DF769` 只代表 9 月 24 日签署版本。
- MEDIA02-25 在作者/c19 各有 12/25 路径与历史快照同 SHA，13/25 已变；历史指纹 `5D77F33FD7DE48935EEF000661C95B038B8DD28F543DF8F09E91F4CDAEF101A6` 不能代表当前送测包。AC05-full-34 在作者侧 27/34 同 SHA、c19 侧 32/34 同 SHA；policy/store 后续单文件修复须连同旧 RED 分开保留。
- 不复活 basic12/MEDIA02 或旧 AC05 包整包覆盖。已签快照不改、不补拷；候选冻结时生成新的 exact staged manifest，并将其哈希与 QA 输入一一对应。

## 作者侧新增、c19 尚无的 22 路径

下表 owner 按 MGR01 本轮具名派工记录；文件在开发中，不据其存在声明已签交包。每个路径的具体 SHA 见机器清单。

| 唯一 owner / 模块 | 路径 |
| --- | --- |
| DEV07 桌面桥接 | `apps/desktop/src/app-preferences-contract.ts` |
| DEV07 桌面桥接 | `apps/desktop/src/app-preferences-ipc.ts` |
| DEV03 设置页 | `apps/studio-web/src/aivora/adapters/appPreferences.ts` |
| DEV03 设置页 | `apps/studio-web/src/aivora/SettingsPage.tsx` |
| DEV04 素材页 | `apps/studio-web/src/aivora/adapters/assetLibrary.ts` |
| REL02 安装预检 | `packaging/windows/release-inputs.example.json` |
| REL02 安装预检 | `scripts/release-preflight-windows.ps1` |
| DEV05 偏好后端 | `services/api/src/aijian_api/app_preferences_contracts.py` |
| DEV05 偏好后端 | `services/api/src/aijian_api/app_preferences_routes.py` |
| DEV05 偏好后端 | `services/api/src/aijian_api/app_preferences_schema.py` |
| DEV05 偏好后端 | `services/api/src/aijian_api/app_preferences_store.py` |
| DEV02 分集剧本 | `services/api/src/aijian_api/episode_script_contracts.py` |
| DEV02 分集剧本 | `services/api/src/aijian_api/episode_script_routes.py` |
| DEV02 分集剧本 | `services/api/src/aijian_api/episode_script_schema.py` |
| DEV02 分集剧本 | `services/api/src/aijian_api/episode_script_store.py` |
| DEV06 媒体资产 | `services/api/src/aijian_api/media_asset_contracts.py` |
| DEV06 媒体资产 | `services/api/src/aijian_api/media_asset_routes.py` |
| DEV06 媒体资产 | `services/api/src/aijian_api/media_asset_schema.py` |
| DEV06 媒体资产 | `services/api/src/aijian_api/media_asset_store.py` |
| DEV08 正式导出 | `services/api/src/aijian_api/product_timeline_export_contracts.py` |
| DEV08 正式导出 | `services/api/src/aijian_api/product_timeline_export_routes.py` |
| DEV08 正式导出 | `services/api/src/aijian_api/product_timeline_export.py` |

## 同路径分歧与 QA 专属项

| 同路径冲突 | owner | 作者 SHA256 | c19 SHA256 |
| --- | --- | --- | --- |
| `apps/desktop/src/api-client.ts` | DEV07 | `BA441EC4CB09C434FD0F8D95AB1BAA83AD57081C12EBCE5CF2D61E61F52FB3CB` | `455CAEE9755317D2C186A1CF5110AB1A308D1FA5ECCDE4C0F57F18019F2597C3` |
| `apps/desktop/src/main.ts` | DEV07 | `E4E83705B1BABC8F2B86B087583B7D66D0D505A20EFF7E3D4F4EF0724BA887CF` | `EDE168AF7DB9A3F11A6DB428221FE38D596BB5230E10E26F5D9EABB0F8127FA9` |
| `apps/desktop/src/preload.ts` | DEV07 | `72308467660B396FBBA20D20E93F4E819DE66D2E770956A4893C16AC67C48A43` | `23AA3C2030F5E37E3A684BFDDD547729BEA0BCC2D13E22FFE05CAB154BD8D9A6` |
| `services/api/src/aijian_api/main.py` | DEV05 | `984906389F9E72CD087B92B278A89B9112CEE29A3021CE4CB4DB1979A45CD9EC` | `5C0477C375BA2A25358A9F05E79DF8206C9496D715210E55B6320440E2FE9AAB` |
| `services/api/src/aijian_api/repository.py` | DEV01 | `21246448D62BB45C0E145F8F7B5CAA8EC0D9233F3B60F8E20C57E1ADFF4E6A4D` | `D210EC7936267BF56B7B8CBB5DE33D30153629CC1D72A63CCF23E44BAADE72E5` |

c19 独有 6 个测试路径，仅属于 QA 证据，不能倒灌作者候选或主目录：

- `apps/desktop/src/fake-timeline-run-contract.test.ts`（`A463D513304FCB9AE107A2B622A7FACAF6A0005A8508AF88D4C6F7C28AF40BC6`）
- `apps/studio-web/src/aivora/adapters/developmentExport.test.ts`（`38F68994FFF67C3C230A8F6D39D4154761B18C7DDF6C52E5C3A48B708EDB2CEC`）
- `apps/studio-web/src/aivora/adapters/developmentFakeTimeline.test.ts`（`5F81ADB533EE5EC592685EBAB03942CD452ADCB50D4BCEE6912CBADC55102695`）
- `apps/studio-web/src/aivora/model.test.tsx`（`807ABAEBAD12C4E1DE3539427A44ABCB599CAB27F03F2ECAF8CAB36AEA664FB8`）
- `services/api/tests/test_development_timeline_export_api.py`（`1904D4A0B7E96FBC24F49AE7DB058A8E9FBC2154F884DC70C008F36C04C3ACEF`）
- `services/api/tests/test_fake_timeline_run_api.py`（`F59424DC5BF0F923270BE31A8575044B744F88DCF36557D31263CB3F4D7DCD09`）

## 主目录保护与顺序

- 主目录的九个旧 CSS 删除已与候选 HEAD 删除方向一致；`apps/studio-web/src/main.tsx` 是单独冲突：主目录删除，候选保留唯一入口。须 MGR01 具名判定后才可整合。`package.json` 的 dev:api 差异应按意图合入候选脚本，不能拿主目录旧整文件覆盖；`test_dev_commands.py` 与作者源逐 SHA 比对；`.pnpm-store` 为本机缓存，排除产品清单。原 13 项不 reset/clean。
1. MGR01 固定新增模块及 5 个共享冲突的唯一作者、完成信号和逐文件最终 SHA；AC05 正向回执仍由 QA03/相关作者优先闭环。REL02 安装预检两新文件独立冻结，桌面 main 打包态仍由 DEV07 串行接线。
2. MGR02 释放 c19 对应独占窗口后，版本组以新冻结源清单比对 c19 实际 SHA，保留 QA 六个测试文件及原始 RED，只对具名产品路径按 owner 顺序同步；任一漂移退回重签，不按旧快照复制。
3. 独立 QA 对同步后的同一源码、构建产物和结果签署；本地/Mock、原生、真实服务与安装证据分别记录。当前无整品/安装/真实 Provider 验收。
4. 主目录整合前再次核 13 项、入口决议、package/test/cache 处理和最终候选指纹，依总控授权执行；不自动合 main、推送或发行。

本次仅做只读树核对并写管理交接与机器清单；未改开发候选、c19、主目录，也未运行测试或构建。

## MGR01 后续具名决议（2026-09-28）

- MGR01 决定候选保留正式 AIVORA `apps/studio-web/src/main.tsx` 为本轮交付入口；主目录该路径旧删除及其余 13 项原状不动。不恢复其它 UI，不据此授权覆盖主目录。REL01 回读候选入口 SHA256 `4D7E16613EE27A073DA9C972B5270EF5385A9EF2E26A4288DBBB214F79276D0C`。
- MGR01 通知后端 `services/api/src/aijian_api/main.py` 最终 SHA256 `BBC596FDD33BDBD18A2ABEE96524CFDDCDA8A9D11AAFA76FC03FD11232D0900F`，REL01 回读相同。它已不同于本报告 08:39:32 机器清单中的该路径 SHA；该清单只可作时间点差异证据，不能作为下一同步源。后端公共依赖仍待 MGR04 取完整快照和 QA 窗口。
- 本次追加时作者树 `HEAD=211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`、Git 状态 105；再次说明开发仍在增量写入，须完成后重新冻结全量具名清单。
