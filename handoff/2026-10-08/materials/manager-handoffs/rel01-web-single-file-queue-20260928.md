# REL01：P23 设置页与媒体原件预览串行队列（2026-09-28）

当前状态：MGR04 已在 MGR02 批准的同一独占短窗同步下列两个 Web 单文件；**已同步、未 QA 验收**，无 build、页面 QA 或原生播放结果。c19 唯一实际同步写者为 MGR04；REL01 只读维护差异与回退清单。下表记录取件来源及写前回退值。

| 顺序 / owner | c19 目标及旧 SHA256 | 冻结候选及新 SHA256 | 源与回退 |
| --- | --- | --- | --- |
| 1 P23 项目设置 / DEV03 | `apps/studio-web/src/aivora/SettingsPage.tsx` `0DE9968C06088F73BA32FD2489EA9B56A74F5BA0C17AAFEF43C2CBD9982F1516` | `086C90CCBF3AD20B519CE934DC6A8F0B842E2B8FB5643AFFD54E12F4891E87FA` | `release-snapshots/20260928-p23-settings-c19-overlay-protected-1/SettingsPage.after.tsx`；`BEFORE.json` SHA `35B69BA541FB06A379E84ABD3C697CCFF280D2668D56CF7F0F1A6C80E316B930`，含旧源和 patch `CBD3CF3E292AAE516442EF8F0A43CC90B96C83ACC1DF60B1E329DB656D0FD53D`。回退为同目录 `SettingsPage.before.tsx` 旧字节。 |
| 2 已存原件预览 / DEV04 | `apps/studio-web/src/aivora/SceneAndAssets.tsx` `2F405B4E20FEA1AD072B89E7656E569E6D0C65BDC5A3BBDD31ED577DAB7F1B98` | `7B9F1842292C101FE5B32E9F0F82A36D6CF5F8AD30FA7A1C7EF22430D9E0C03F` | `release-snapshots/20260928-scene-assets-media-preview-protected-1/SceneAndAssets.tsx.after`；`SNAPSHOT.json` SHA `BA587345604F367079AEBE4FB5F79CAB97306B19F58D762DF6E19324E1531C98`，HANDOFF SHA `B3D9468E75B907393BC4E4122B858A685B850631118E77CF70D74DBD762210E5`。回退为同目录 `.before` 旧字节。 |

两目标文件不重叠。MGR04 的 Scene 快照复核 P23 `BEFORE.json` 记录的 c19 Web `src/dist` 外围 192 件，零漂移，dist 未改；本次 REL01 回读两目标旧 SHA 也相符。两候选都复用当前 c19 的 `studio.ts`、`model` 与各自 adapter，没有申请这些共享文件的写入。写窗前仍须重核外围与目标旧字节；先完成一个包的 QA、记录产物和回退点，再排下一个，避免归因混淆。

## 各自依赖与 QA 门

**设置页**：候选调用当前 c19 `studio.ts` 的 `getProject/updateProject` 和 `adapters/projectManagement.ts` 的 journal/CAS/未知结果只读核对；StoryPages 名称 CAS 已在 c19。范围仅真实项目名称的显式保存、取消、权威读回，以及画幅/目标时长/语言等只读展示。P23 migration32、完整设置 store/合同未在位，因此不能称完整 P23。QA03 应在固定源上核 TS/build、真实项目保存/重开、冲突/UNKNOWN 不重投、项目切换、旧用户设置与 StoryPages 回归；保存成功以服务端版本读回为准。

**原件预览**：候选复用当前 c19 `assetLibrary`、`studio.ts` 和桌面 `readProjectMediaAssetPreview` 桥接。只给已存且已核字节的 WebM 视频、WAV/MP3 音频创建 Blob URL；关弹窗或切项目回收 URL，错集/延迟返回丢弃。它不提供媒体探测、生成动画、口型、组装版本或正式导出。QA03 核 TS/build、图片旧流程、组件/Blob 身份、大文件/缺失/损坏/跨项目与 URL 生命周期；QA02 在固定同源 Electron、隔离 profile 中分别实测原件解码与实际 play/pause/seek、重开和失败场景。按钮点击、READY 回执及 mock 组件不能替代原生播放证据。当前原生 sidecar 启动问题须另按其修复窗口关闭后再排该门。

**剧本编辑 UI 另列后续包**：其六个 studio gateway 的 script/confirmation 依赖尚不齐，confirmation routes、桌面 script/confirmation IPC 与 c19 UI 文件均缺；DEV07 新旧稿只读兼容候选也未 build/QA。DEV02/DEV07/DEV04/MGR01 应先固定完整多 owner 来源和历史草稿 hash/幂等门，不并入上述任一单文件窗口。

## 同步回执与接续门（覆盖上文写前措辞）

受保护写包 `release-snapshots/20260928-p23-and-preview-c19-sync-1`：`PREFLIGHT.json` SHA `0FD8DF17258AAE0C219CE32B0C1806E67A19B546E2B01F664F4526FD12F710C6`，Settings 单文件回执 SHA `09A28CAFBCE9373C54208465415524A8F59758432222F2DEF7411FC1DBDE802C`，Scene 单文件回执 SHA `A6A83179362A6DC4D27C5E24F8C9FF8C577D3A53AE9365208077D1F1911724DC`，`POSTFLIGHT.json` SHA `68984CB8EBD181711D46BF72F76F5B3581E71EB40329760C369708E2FCA1C061`。REL01 另回读 c19 两目标新 SHA 与回执一致；`StoryPages.tsx` 仍为 CAS-only `34D272A7ED104E2A983BAB774212C17F6CF7F9913198212B7052E7487B67DA60`。

写前/写后 `HEAD=211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`、status 110 行，Web `src/dist` 原192件中仅两目标变化、外围190件不变；相关进程0、`git diff --check` exit0，dist未构建。旧文件备份在写包 `old/`，两个回执均记录备份、来源、目标回读精确 SHA。已请求 MGR02 关闭该写窗；QA03 接固定两文件同源 typecheck/build 与各自行为回归，QA02 对媒体实际 Electron 播放单独验收。任何构建产物或后续修改须另记 SHA，不能倒填进本次同步回执。

## QA03 同源 Web 门（同步后增量）

QA03 在上述两文件固定 c19 源上运行一次统一 `tsc -b` 与 Vite build，均 exit 0；`web-gate-v4/web-04/RECEIPT.json` SHA `7CE9C71557B70EB12DBBA654258524D4A178A9DA61E2FC52F1CD23A12A6085C1`，状态 `WEB_TYPECHECK_BUILD_PASS`，首 RED 为 null。Web 源 113 项指纹保持稳定，HEAD 与 status 指纹稳定；dist 82 项仅替换 Vite JS 文件名及 `index.html`，新 dist 指纹 `72E3B9C334BE8AF165CB9E886BD3F629BDA2FC523E128EF1EC3AA789FCF91E7C`。这覆盖写后同源类型检查与构建，**不覆盖** P23 名称 CAS 持久回归、双 sidecar 或 WebM/WAV/MP3 原生解码/播放；后者仍由 QA03/QA02 分门验收。

## QA03 P23 隔离 sidecar 门

QA03 对已同步来源另做一次真实 sidecar 隔离 CAS 与双新进程重开：`p23-sidecar-gate-v1/sidecar-01/RECEIPT.json` SHA `A68F4FF76254CD32D9E1C8AC1E657DD25F651F6811494DD92635A3ACB5CA8850`，状态 `P23_SIDECAR_CAS_REOPEN_PASS`，首 RED 为 null。记录 POST201、PATCH200、GET200，旧 revision PATCH412 未覆盖；第二个新 PID 从同一 SQLite list/get 读回新名称 revision2，两进程正常 exit0、结束 PID0。该门证明后端持久 CAS/重开范围；409/UNKNOWN 仍只是独立 local/mock UI 组件结果，真实 Electron 项目设置页面及媒体原件播放未验收。
