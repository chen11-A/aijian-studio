# REL01：74 件 QA 组装目录版本与接口只读审查（2026-09-29）

状态：`STATIC_REVIEW_ONLY_NOT_PACKAGED_NOT_RUNTIME_QA`。QA02 目录为 `C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\native-source-qa-20260924\qa02-packaged-staging-r2-20260929`。本审查未改目录、c19、源文件或产物；未运行 Electron、EXE、安装器或 provider。

## 固定输入与字节

| 角色 | 精确来源/组装目的地 | SHA256、责任和下一门 |
| --- | --- | --- |
| 74 件取件清单 | `release-snapshots/20260929-packaged-isolated-readonly-plan-1/INPUTS.json` | `9B25674215BBC53C0BA9134EAAA5A2462F235083CCD3AF2FB8B1760E323F6A5E`；MGR04 固定版本，QA02 唯一组装。REL01 固定 Python 只读复算 stage 74/74 路径、大小、SHA，额外 0，总 56,540,415 B。 |
| QA02 组装后记录 | `.../qa02-packaged-staging-control-r2-20260929/POST.json` | `3DEB22180EE924BCFD631CC9E618B3BF78F8B1E6D9434EEBBB54D35263329DE1`，仅 `QA_ISOLATED_SOURCE_ASSEMBLY`。 |
| c19 四路径 POST | `release-snapshots/20260929-c19-r1-four-path-prewrite-1/POST.json` | `D7EF083ED343C9507725321BAF37333101E2E3B9DEDA0F25CEAAC00E82183D90`；c19 HEAD `211c9e8b...`、状态 114 行/UTF8 SHA `FE92C6E787E71888226D3E3B9E5AE12833080C40194BA2C2A236BF6F7F258AEB`，当前仍匹配。MGR04 写入、MGR02 后验窗口。 |
| 桌面运行包 | stage `app/package.json`；`app/dist/main.js`、`preload.js` 及 37 个相对依赖 JS | package `42FA9DD9CED0F83CDADCD552A7C91F44BEAD0A92F5F994F3ADD762FB57E97712`，main `24B364C92A9B86930CAD5203E55929FB7307D5AFF64DE0DD7D6EA3A71985AA0F`，preload `949A91F34EB3D788CBD7B974BFF4F54BEA35BC5C05E6F88B3F0A64D068581960`；39/39 相对 require 目标在 stage 存在。来自 QA02 的真实 c19 后同步 TypeScript emit，结果 SHA `7CDCA4482B832E25F23F149B4486B694DF40B528E081179173B37AC2639FA411`。动态 Electron loader 仍待 QA03。 |
| contracts | stage `app/node_modules/@aijian/contracts/` 七文件 | 固定 CJS runtime：package `2664E7764122BEEE9E35596B8370C0E0F855A970C21DD23460B49462EF0D14CC`，exports 指向同目录三个 JS；桌面四处运行时 require 使用 `artifact-proposal` 或 `invalidation-operation`，均有对应 exports/文件。七件来自 `20260928-contracts-runtime-cjs-seven-1`，由 MGR04 冻结；旧 Node smoke 针对旧 main，**新 39 JS + 七件 Electron 加载未验**。QA03 单独做同组合 loader。 |
| renderer | stage `resources/renderer/index.html` 与 24 个 asset | index `AFE003E1635BAC787FC77FB32BCA0F34594D99D14DB8E63D0BF4A447F75C9D46`，入口 JS `index-CyIvZNT0.js` `9C4E72498F28AD25C4B30FE365068FA64576201A1D9D736ADC4A0F15BF29BB4C`；来自 c19 9/28 Web typecheck/build receipt `7CE9C715...` 的 25 件，MGR04 快照 `20260928-web-p23-preview-renderer-dist-25-1`。QA03 需验证当前 app/preload/sidecar 组合的真实 UI、请求与回读。 |
| sidecar | stage `resources/sidecar/aijian-sidecar.exe` | `2F23AC50CEA16D60D3C2AA1013F11F7C7D00570767740C2026A9C4243468E692`，18,568,181 B；QA03 R2-only 新锁 EXE 构建局部 PASS，运行/长路径/Busy73/正常关闭未由组装证明。 |
| config | stage `resources/config/media-toolchain-lock.json` | `A4554A71D7942C0706585B609E77059F71634E84EB9A2EDD4072965A9FCFB072`，锁定 Gyan FFmpeg 8.1.2 的开发 profile，`distribution_status=DEVELOPMENT_ONLY`；发行媒体二进制与许可证来源未批准。 |

## renderer、API、IPC 的具体版本差异

1. stage renderer 的实际 JS 是 9/28 Web 产物，stage main/preload 是 9/29 四路径 POST 后 c19 emit；R1 修改 main 的打包子进程 TEMP/错误分类，不新增 IPC。静态抽取 stage preload `aijian` 的 64 个方法，与当前 c19 `apps/studio-web/src/api/studio.ts` 的 64 个 `bridge.` 用名：缺名 **0**。stage renderer JS 中这 64 名均出现于实际桥接检测/转发代码。preload 的 64 个 `ipcRenderer.invoke` channel 字面量均在其余 38 个 stage 桌面 JS 中出现。此为名称覆盖证据，不证明处理器注册时序、参数/响应语义或运行时 UI。
2. stage R2 EXE 使用固定 194 源、其中 185 个 API Python 文件。以**固定 Python consumer 视图**比对当前 c19 API 树：127 同字节、11 不同字节、47 在 c19 缺席。例：`provider_connection_routes.py` stage 构建源 SHA `8591532DFF70DDB78C7BFF2FFCD1162A1801393F01F3B1C0E90040098EE40C`，c19 SHA `F9BD655D91BD1BC1D58C8F06DD0174A592A77E6F91ACEE41714C2E561F1820A2`；R2 源新增 provider PATCH、key rotation 和 operation 查询，当前 stage preload/renderer 仅提供 provider list/create/delete。多出的后端端点未在当前 renderer 暴露，不能从桥接名一致推断完整 R2 API 已被 UI 消费。`main.py` 亦从 c19 `BBC596...` 到构建源 `ECD229...`，增入 episode/media/rights/product-export/readiness 路由与打包资源定位；这些组合须用实际 R2 EXE 逐路验证。11/47 是两个不同候选的版本差异，不直接判为已复现故障。
3. packaged main 要求 `resources/renderer/index.html`、`resources/sidecar/aijian-sidecar.exe`、`resources/config/media-toolchain-lock.json` 均为普通文件；stage 有这三项。media lock 仍是开发配置，且 stage 无 `resources/media/ffmpeg.exe`/`ffprobe.exe`，故媒体编码/发行功能没有可验收输入。

## 发布布局与待门

作者 `packaging/windows/runtime-layout.json` SHA `0F6EFF7BCAB2585A90846AA4CC9F5C70CD5D34953E902898CD2AA8D95B93516B` 标为 `installer-input-only`。`GAPS.json` SHA `770F0B7A30402B6E6DCADFEE0E3BACB4E712D54065CF8F836ABA67B4EBB1A2F1`：21 个必需目的地中 13 在 74 件内，缺 8。`build/electron-builder.json` 有静态作者源 `electron-builder.v26.json` SHA `A579F9D258EE8F2B3A437215E0B39B52A45D3867B4F4BFE55F82B15F9230A63E`；`build/installer.nsh` 有源 SHA `F24F391E31C30160BE3F541DFB2008E3CEF082C2D6D1DC2263ACB557AD0C544F`，两者尚未批准纳入。另缺 `resources/media/{ffmpeg,ffprobe}.exe` 与 AIVORA/FFmpeg 各两份 LICENSE/NOTICE，固定获准源未知。`runtime-layout.json` 自身亦未作为此 74 件中的组装文件。

下一门由 MGR02 分别签范围：QA03 的新组合 CJS/Electron 模块加载与 R2 EXE 无窗口隔离运行；随后才可审真实 packaged Electron 可见 renderer/UI、资源/媒体、安装器工具与升级/卸载。REL02 负责 packaging 输入和工具/版式审查；媒体发行来源与许可审批仍须总控明确，不从本目录推定。现有 `electron-builder.v26.json` 固定 Electron 43.2.0/NSIS x64/per-user，但实际工具及二进制未固定；`installer.nsh` 遇旧安装/用户数据会中止，升级备份流程未实测。
