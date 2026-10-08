# REL01 首批 12 文件候选清单

日期：2026-09-24。唯一产品仓库：`C:/Users/Administrator/Documents/sp`。统一开发候选工作区：`C:/Users/Administrator/.codex/worktrees/s2-q1-g1-d00-default-deny-59f-20260923/sp`；分支 `codex/aivora-resume-20260924`，HEAD `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`。本清单固定首批 12 个文件的**内容身份**供版本经理签署；它们仍是未提交工作区差异，不是独立 Git 提交、已通过测试的媒体链或发布候选。

表内路径相对统一候选根。内容 SHA256 为文件原始字节；已跟踪文件的差异 SHA256 为 `git diff --no-ext-diff --binary HEAD -- <单文件>` 的原始输出字节哈希。新增未跟踪文件在 HEAD 中无原件，按文件内容 SHA256 标识。按下表顺序拼接 `路径<TAB>内容SHA256<LF>` 的 UTF-8 字节，12 文件清单指纹为 `92C239ED530622FCFF63EFE9242B2DA1EC7B55E5F69D9E2AF94919EDA06DF769`。

| # | 文件 | 作者释放与 K01 来源 | 内容 SHA256 | 与 HEAD 差异 SHA256 / 新增内容 |
| ---: | --- | --- | --- | --- |
| 1 | `apps/studio-web/src/aivora/model.tsx` | DEV03 来源修复，MGR01 签审；只增加 `setSourceManifest(manifest)` 一行；旧 K01 前端源 `6f65e55` 供依赖参考 | `0B2F661BFB9F156489667603F070DA04AE3F28633452201236D65249996CE211` | `602BC46C0216BE3723D078C3A7EFEA696AD9A4CF38BC4067CFB7F2802F0C47D8` |
| 2 | `services/api/src/aijian_api/development_timeline_export.py` | DEV08-FIX01 已释放；旧 K01 服务源 `d673179`，本轮文件内容与旧 blob 不同 | `6C297B026820DFC0F4B5E0413738E506C4312E08237C68FFA56D8FFA22CF5A19` | 新增内容同左 |
| 3 | `services/api/src/aijian_api/development_timeline_export_routes.py` | DEV08 路由冻结；旧 K01 `d673179` 同路径 blob 与当前相同 | `BF61AA17899CA0A32BBFCDADF868F99D0C7E4A3EED6E7932509B598EAC25CD55` | 新增内容同左 |
| 4 | `services/api/src/aijian_api/main.py` | DEV01 公共路由注册，冻结；旧 K01 `d673179` 提供导出路由来源 | `D7CAEC3F9A7CC21C1B41B39401FFB04BE22A4C820481BE74F9DE6B9881E16AB1` | `7C054FADCBB2F88CDB615E66CDD62BE1219918F02AB5D0D235EABE75770B7C9C` |
| 5 | `apps/desktop/src/api-client.ts` | DEV07-FIX01 已释放；旧 K01 桌面桥接源 `99109b3` | `754F46ECFD96F83B2F26EB6DB9CF532580D02CFDCD60A012E9D080C4BDA36A9A` | `20E3B1E13DE6A8595F7A512528C19096991A57AB0F097DE0117B9D88A655D00F` |
| 6 | `apps/desktop/src/development-export-contract.ts` | DEV07 桌面契约冻结；旧 K01 `99109b3` | `C1D8FBE8DA8EF5154A5226B838719872CC59541840F611D695A60CC19136155B` | 新增内容同左 |
| 7 | `apps/desktop/src/development-export-ipc.ts` | DEV07-FIX01 已释放；旧 K01 `99109b3` | `FF855759CD4DD64818A6745C231435C3F0B606D0A67C2DC992C86B05524E7B62` | 新增内容同左 |
| 8 | `apps/desktop/src/main.ts` | DEV07 注册冻结；旧 K01 `99109b3` | `315C39B9AAF6606BAA5722E454BD53DCF75A63E5DCE8A014DF3CD7BBB1DC3C41` | `D64EE443EB67B52A6CE8430D512F66C195AC8834E8134DF87CB0B4B6BADF9BA0` |
| 9 | `apps/desktop/src/preload.ts` | DEV07 安全桥接冻结；旧 K01 `99109b3` | `91FA34256495B7B96BE782B9235C7543E9CDEC4DC26C86E1EA1C365EC84A73A5` | `B1739829AF1A0D7FC372536454983D44A182928CD2C69FC6AD12A6A6411A3CE2` |
| 10 | `apps/studio-web/src/api/studio.ts` | DEV01-CONTRACT01 已释放，公共 transport；旧 K01 桌面源 `99109b3` 曾涉及该文件 | `B8415F87508C9B1BF509FCD882A9DFDAE155C2B57109DFEC98C2E12C49554032` | `311B7228E24CD2558C67AD7DE28EFCD51BA97F3BDC814E2DB8B09686B2740909` |
| 11 | `packages/contracts/openapi.json` | DEV01-CONTRACT01 已释放，API 契约；旧 K01 生成源 `7030b05` | `43AD22FABD3CDB894084EC34C8CDB9DB21CD17B9F6C4105EA11F86DFFFBF9F05` | `E9AC7FCC7F75F416641B82DB6944B0C658477C1C1ED2E60444450AD99E03A3FF` |
| 12 | `packages/contracts/src/generated.ts` | DEV01-CONTRACT01 已释放，生成类型；旧 K01 `7030b05` | `5FC45ED42399C91AEBB6571F309B7375A12CA7F07432EA1CC340E1CF58DEC487` | `4F3631A5C2A48EBD6083C18114916D6D31EED29A9819021F4E35B1E57F398CEC` |

## 依赖和逐文件保护

- 基础包依赖顺序：DEV08 服务/路由 → DEV01 `main.py` 与生成契约 → DEV07 桌面 API/IPC/preload/main → DEV01 web transport。来源 `model.tsx` 修复属 M1，可独立于媒体链核验。作者释放和 MGR01 的文件归属签审不代替独立 QA。
- DEV04 正在写 `apps/studio-web/src/aivora/MediaPages.tsx`、新增 `DevelopmentMediaPanel.tsx`、`DevelopmentExportPanel.tsx` 与 `adapters/developmentExport.ts`；这些页面/适配层**不在首批 12 文件**。
- DEV05-STALE01 已交包的 `apps/studio-web/src/fake-timeline-run-development.ts` SHA256 为 `2E3F843D084A899DFC3DE1546DDB3E621E2B70AB8745252D1EFB806F02294BD3`；DEV05 已交包的新增 `apps/studio-web/src/aivora/adapters/developmentFakeTimeline.ts` SHA256 为 `285FF82E768C301DE90C6D980CA5249B0A8512F53EB6DC7E64DE729E620C92FD`。两文件属于下一 H87 增量，现排除并保护，不能覆盖或纳入 basic12。`DevelopmentMediaPanel.tsx` 由 DEV04 在写，引用前一协调器接口。
- DEV06 已释放的 `apps/studio-web/src/aivora/adapters/developmentTimeline.ts` SHA256 为 `6218B1ADC4F5CBEF3FC1C64FE250380592E5F1B5B7E92F2C7EC0DF1118F7D910`，单列待下一增量，亦不在 12 文件指纹中。
- 本首包形成后，共享文件下一轮写入窗口另开；`apps/desktop/src/development-export-contract.ts`、`development-export-ipc.ts`、`preload.ts`、`apps/studio-web/src/api/studio.ts`、`index.html`、`vite.config.ts` 的后续变更必须产生新清单/指纹，不能沿用本表送测标识。
- 主仓库 HEAD `7523f010561b91c5457aca4b38919801605c42d7` 的 13 项未提交内容原样保护。c19 QA 树已有 M1 双文件差异：`model.tsx` SHA256 `0B2F661BFB9F156489667603F070DA04AE3F28633452201236D65249996CE211`；QA01 `model.test.tsx` SHA256 `807ABAEBAD12C4E1DE3539427A44ABCB599CAB27F03F2ECAF8CAB36AEA664FB8`，双文件差异 SHA256 `1BAD75EE4F875139015D7B48630A34DBE582A1A76335848B425D21D50561AF3C`。REL01 已释放 c19 给 QA02 独占原生验证；不得并行部署本 12 文件或覆盖 QA01 测试与原始证据。
- 本表没有声称 H87 页面接线、可播放 MP4、原工程门或安装发布通过。M1 原生结果须以 c19 原差异和独立 profile/PID 记录；媒体基础包待 QA02 正常关闭并释放 c19、MGR04 签署本表后，才按单独指令顺序部署。部署后重新标识 HEAD＋完整差异及隔离 profile/build，不把 c19 M1 结果无条件套给新候选。

冻结输入来源提交、原路径和 bytes/SHA256 另见 `C:/Users/Administrator/Documents/AIVORA/production/inputs/20260924/来源核验清单.md`；制作组只确认内部测试输入边界，不推及外部授权。
