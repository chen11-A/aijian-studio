# REL01 候选来源、差异与保护清单

核对日期：2026-09-24。唯一仓库：`C:/Users/Administrator/Documents/sp`。当前开发工作区：`C:/Users/Administrator/.codex/worktrees/s2-q1-g1-d00-default-deny-59f-20260923/sp`，分支 `codex/aivora-resume-20260924`，HEAD `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`。本表是未提交工作区的只读审查快照，不是固定媒体验收候选或发布 SHA。

## 旧 K01 来源与迁移边界

| 工作 | 原始提交 | 该提交补丁 SHA256（`git show --format= --binary --no-ext-diff`） | 涉及文件与当前归属 |
| --- | --- | --- | --- |
| 已批准来源接时间线 | `6f65e55cdb42a511727b36f32590e7fc12d3309d` | `8A8518258A0D17371A6DC0763446AC95157CC5B757528FFEB431855966ED6041` | 旧 `MediaPages.tsx`、`realTimelineDevelopment.ts`、`model.tsx`；本轮制作页/适配层归 DEV04，时间线适配层归 DEV06，公共 model 作者另由软件经理指定。 |
| 开发导出前端 | `b9ccc28b957c4f34a1b161de0652e235c4896eba` | `CEE39B3ED7EB0251401F22F4EF7AC4FE5F32BA3767AF7B2FC196D015DCB11A30` | 旧 `MediaPages.tsx`、`developmentExport.ts`、`realTimelineDevelopment.ts`、`model.tsx`；本轮 DEV04 未释放，不能组合。 |
| 桌面 typed API/IPC | `99109b3279bf2a25c9ddb26b144f14ee4cc0d424` | `4DDF737A9E13BE5A4BCA97B237AAC7FF498BB9D7B1CE123ACB37824BF3A2B860` | 桌面五文件由 DEV07 管；`studio.ts` 是公共 transport，本轮由 DEV01 唯一作者处理。旧桌面分支后续修复至 `c3a10643c09921784c7b903a32ddb77ceb56832e`。 |
| 后端开发导出 | `d6731796a65e77e3d650b5e363a3c3e6282c7ab8` | `67349902104166B948F24645ACA8D02F5C4D69F09C6A9C26BA64EC5DB3F125A9` | 导出服务与路由由 DEV08 管；共享 `main.py` 注册由 DEV01 协调。 |
| 生成契约 | `7030b05c2cf8400adbfcf65529384ec8a4235c45` | `C4B590C901EB1B90A43EE0BF1B781073A31992B63322707D35B2FC8C964F2315` | `openapi.json`、`generated.ts` 由 DEV01 唯一作者处理。 |

旧 K01 提交共同从 `2d9980dd8271d9f7f9cbae44624f12375e13946f` 起步，和当前 `211c9e8` 的整树差异含 G1 能力回退与删除。因此仅按文件、依赖及签审差异受控恢复；旧整树不得覆盖或盲合。

## 当前已释放或冻结的基础差异

以下路径均相对当前开发工作区。SHA256 是当前文件字节哈希。已跟踪修改的“差异 SHA256”按 `git diff --no-ext-diff --binary HEAD -- <单文件>` 的原始输出字节计算；未跟踪新增文件没有 HEAD 内原件，以文件 SHA256 标识新增内容，待固定包时另核整体差异。

| 路径 | 归属及状态 | 文件 SHA256 | 差异 SHA256 |
| --- | --- | --- | --- |
| `apps/studio-web/src/aivora/model.tsx` | DEV03 来源修复，软件经理签审的一行 `setSourceManifest(manifest)`，已单独送 c19 QA | `0B2F661BFB9F156489667603F070DA04AE3F28633452201236D65249996CE211` | `602BC46C0216BE3723D078C3A7EFEA696AD9A4CF38BC4067CFB7F2802F0C47D8` |
| `apps/desktop/src/api-client.ts` | DEV07-FIX01 已释放 | `754F46ECFD96F83B2F26EB6DB9CF532580D02CFDCD60A012E9D080C4BDA36A9A` | `20E3B1E13DE6A8595F7A512528C19096991A57AB0F097DE0117B9D88A655D00F` |
| `apps/desktop/src/development-export-ipc.ts` | DEV07-FIX01 已释放，新增文件 | `FF855759CD4DD64818A6745C231435C3F0B606D0A67C2DC992C86B05524E7B62` | 新增内容同左 |
| `apps/desktop/src/development-export-contract.ts` | DEV07 桌面桥接冻结快照，新增文件 | `C1D8FBE8DA8EF5154A5226B838719872CC59541840F611D695A60CC19136155B` | 新增内容同左 |
| `apps/desktop/src/main.ts` | DEV07 桌面注册冻结快照 | `315C39B9AAF6606BAA5722E454BD53DCF75A63E5DCE8A014DF3CD7BBB1DC3C41` | `D64EE443EB67B52A6CE8430D512F66C195AC8834E8134DF87CB0B4B6BADF9BA0` |
| `apps/desktop/src/preload.ts` | DEV07 preload 冻结快照 | `91FA34256495B7B96BE782B9235C7543E9CDEC4DC26C86E1EA1C365EC84A73A5` | `B1739829AF1A0D7FC372536454983D44A182928CD2C69FC6AD12A6A6411A3CE2` |
| `apps/studio-web/src/aivora/adapters/developmentTimeline.ts` | DEV06 已释放，新增文件 | `6218B1ADC4F5CBEF3FC1C64FE250380592E5F1B5B7E92F2C7EC0DF1118F7D910` | 新增内容同左 |
| `services/api/src/aijian_api/development_timeline_export.py` | DEV08-FIX01 已释放，新增文件；旧 d673179 同路径 blob 与当前不同 | `6C297B026820DFC0F4B5E0413738E506C4312E08237C68FFA56D8FFA22CF5A19` | 新增内容同左 |
| `services/api/src/aijian_api/development_timeline_export_routes.py` | DEV08 路由冻结快照，新增文件；当前 blob 与旧 d673179 同路径相同 | `BF61AA17899CA0A32BBFCDADF868F99D0C7E4A3EED6E7932509B598EAC25CD55` | 新增内容同左 |
| `services/api/src/aijian_api/main.py` | DEV01 公共注册文件，当前冻结于此快照 | `D7CAEC3F9A7CC21C1B41B39401FFB04BE22A4C820481BE74F9DE6B9881E16AB1` | `7C054FADCBB2F88CDB615E66CDD62BE1219918F02AB5D0D235EABE75770B7C9C` |

## 仍在写的文件与依赖

- DEV01 正处理 `packages/contracts/openapi.json`、`packages/contracts/src/generated.ts`、`apps/studio-web/src/api/studio.ts`；哈希会变，待作者释放后重取。公共路由/生成契约只有唯一作者，`main.py` 保持上述冻结哈希。
- DEV04 正处理 `apps/studio-web/src/aivora/MediaPages.tsx`、`apps/studio-web/src/aivora/DevelopmentExportPanel.tsx`、`apps/studio-web/src/aivora/adapters/developmentExport.ts`、`apps/studio-web/src/aivora/adapters/developmentFakeTimeline.ts`；未交包，不纳入当前固定基础包。
- 完整调用依赖：后端导出服务及路由 → `main.py` 注册 → OpenAPI/生成契约 → 桌面 API/IPC/preload/main → web transport 与适配层/页面 → 固定候选独立 QA → 制作实际使用。DEV05 的 Fake 任务回执和 DEV06 的素材/时间线读回还需分别交接。桌面与后端的静态可送测不证明 H87 已接线或有可播放 MP4。

## 保护项、证据与放行

- 主仓库 `C:/Users/Administrator/Documents/sp` 当前分支 `codex/phase0-ffmpeg-toolchain`、HEAD `7523f010561b91c5457aca4b38919801605c42d7` 的 13 项未提交变化保留；不切换、清理、合 main。
- c19 来源 QA 树 `C:/Users/Administrator/.codex/worktrees/c19-trim-211c9e8-qa-20260923` 的 HEAD 仍为 `211c9e8`，双文件限定差异 SHA256 `1BAD75EE4F875139015D7B48630A34DBE582A1A76335848B425D21D50561AF3C`；`model.tsx` 为上述单行修复，QA01 的 `model.test.tsx` SHA256 `807ABAEBAD12C4E1DE3539427A44ABCB599CAB27F03F2ECAF8CAB36AEA664FB8`。该树已释放给 QA02 独占后续运行，REL01 不再写入。定向 RED→GREEN 属这个 QA 差异包，不自动迁移成统一媒体候选通过。
- 冻结输入来自 `d495d0cfd2b82fae3cad4288a72da55210b34e91`，已恢复到 `C:/Users/Administrator/Documents/AIVORA/production/inputs/20260924/`；字节/哈希与 Git 原件相同，详见同目录 `来源核验清单.md`。制作组确认内部测试输入边界，未见独立对外分发或真实供应商授权凭据。
- 当前结论：MGR01 已签审文件归属与依赖原则；DEV01、DEV04 文件仍在写，固定媒体包及同版原生/影片证据尚未形成。REL01 只读重取释放后哈希，并由 MGR04 批准组合顺序。不得因本清单直接 commit、合 main、发布或改 QA 树。
