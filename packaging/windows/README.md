# AIVORA Windows 安装输入

**2026-10-08 更新：**当前独立重建分支已实际下载并校验 Windows 工具链，新增原生 sidecar 冻结与测试入口。请先看 [当前环境与可复现步骤](TOOLCHAIN-STATUS.md)。下文包含旧候选历史，不代表当前源码或安装器已验收；其发行与数据安全门仍保留。

本目录定义 Electron 桌面程序的受控资源布局。`runtime-layout.json` 是安装器的输入约束，不是已生成的安装包；`scripts/stage-windows-runtime.ps1` 只在完整发行清单通过预检后，将固定字节放进全新暂存目录。

## 固定布局

| 目录                                  | 内容与所有者                                                                                                                                                               |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/`                                | Electron 主进程、preload、编译后的全部运行模块及可执行的应用包元数据；DEV07 负责现有桌面入口与运行时模块。                                                                 |
| `app/node_modules/@aijian/contracts/` | DEV07 的 `scripts/build-contracts-runtime.mjs` 输出目录全部文件：runtime `package.json`、三个 JS export 和三个声明文件。不得把指向 `src/*.ts` 的开发包直接复制入发行输入。 |
| `resources/renderer/`                 | `apps/studio-web/dist` 的完整构建输出，入口为 `index.html`；它是桌面内嵌界面。                                                                                             |
| `resources/sidecar/`                  | 固定的 `aijian-sidecar.exe` 及其运行所需文件；DEV07 从此目录受控启动，用户无需预装 Python。                                                                                |
| `resources/config/`                   | 只读媒体工具锁。后端从可信资源根读取，不从任意工作目录猜测。                                                                                                               |
| `resources/media/`                    | 获发行许可且成对锁定 SHA256 的 FFmpeg/FFprobe；当前开发工具不得复制到这里。                                                                                                |
| `build/`                              | 固定 SHA 的 `electron-builder.json` 与 `installer.nsh`；只供安装器构建，不进入应用资源。                                                                                   |

`app/dist/main.js`、`app/dist/preload.js`、`resources/renderer/index.html`、`resources/sidecar/aijian-sidecar.exe` 和媒体锁/工具是暂存门的必需角色。其余 Electron JS、renderer assets、sidecar 资源、字体、许可证原文和 NOTICE 也须逐文件列进固定清单；脚本只核清单中的文件，不替经理判断清单是否穷尽。包内路径由每项 `destination` 明示，哈希为原文件 SHA256。

DEV07 的 c19 真基线打包分支来自版本组冻结快照 `C:/Users/Administrator/Documents/AIVORA/management/manager-handoffs/release-snapshots/20260928-c19-packaged-resource-root-main-1/`；`SNAPSHOT.json` SHA256 `9D11A58DAD05D48BED698D05160A6FF7327C52BBEC630D0C0E03EE92A2D45364`、其中 `main.ts` SHA256 `E1BAAA599BB340BA4F2DEAD8755485B2E55406894E23F29D225EC0690823ABF0`。候选打包主进程从 `process.resourcesPath/sidecar/aijian-sidecar.exe` 以 `args=[]`、`cwd=sidecar` 启动，传 `AIJIAN_RESOURCE_ROOT=process.resourcesPath`，并从 `process.resourcesPath/renderer/index.html` 加载界面；缺根、sidecar、锁或 renderer 时在启动前失败。REL02 静态核这些目录与本布局一致。同步前 c19 `main.ts` SHA256 `443624A7007C6664DC232895464AA7DD41F4B38D14FB3315088B1AF9F702401E` 无打包态分支；现 c19 已同步候选 `main.ts` SHA256 `E1BAAA599BB340BA4F2DEAD8755485B2E55406894E23F29D225EC0690823ABF0`，并构建 `dist/main.js` SHA256 `4541E89FFC4944ED449FD85F1C01AA6CCF7AEA14C5D53C3593327CDBDA78FB03`，但未执行 packaged Electron；发行清单必须绑定经独立类型/构建检查的冻结源及实际构建输出，不能只补环境变量或拿作者整源当 c19 已集成。开发态 sidecar 的资源根覆盖仍须拒绝；安装态再由独立 QA 读回 exe、`args`、`cwd`、renderer 和资源根。

QA03 外置回执 `resource-root-gate-v2/resource-02/RECEIPT.json` SHA256 `5129F1BC927D8108EC666E17776A042C7BDCDA5E7EB84D50B02996BD955E661E` 固定上述候选/快照，报告 TypeScript 类型与构建诊断 0、隔离 emit 57 件（`main.js` SHA256 `4541E89FFC4944ED449FD85F1C01AA6CCF7AEA14C5D53C3593327CDBDA78FB03`），以及抽取函数 VM mock 的正常目录与五个缺资源/非打包负例。此 emit 含测试模块，是 QA 隔离产物，**不是**可直接列入发行清单的 desktop dist；该 QA 回执生成时 c19 main 尚为旧 SHA，随后已在受控窗口同步。MGR04 已安排该一文件同步并完成 c19 类型/构建，下一门仍是完整发行运行树与真实 packaged Electron 资源读回。

版本组 c19 同步门 `release-snapshots/20260928-c19-packaged-resource-root-sync-1/GATES.json` SHA256 `4B1941606E45AC4E0DC11BA8A90A48DBBA1BEAA081D405AB377A757493E4E9F7`：`main.ts`/`dist/main.js` 分别为上述 SHA，类型与构建 exit 0，其它 desktop 文件未漂；`packaged_electron`、`installer` 均为 `NOT_RUN`。目前 c19 有 desktop/renderer dist，但没有 REL02 的 `packaging/windows/` 与暂存脚本；REL02 唯一作者候选有打包文件，却未生成这些 dist。发行预检要求**同一候选根**持有全部已批准文件与完整清单，不能拼接两个工作树后声称通过；由 MGR04 定版取件后再做正向暂存。

`app/package.json` 应使用本目录的 `app-runtime.package.json` 作为清单源，并固定其 SHA；它把开发仓的 `workspace:*` 换成确切版本，且固定 `productName=AIVORA` 供 Electron 默认 `userData` 命名。`app/node_modules/@aijian/contracts/package.json` 由 DEV07 的 runtime 编译输出提供。两者版本必须相同，且独立 Electron 冒烟必须证明 builder 处理后仍能加载。`electron-builder.v26.json` 仅是待核定的配置草案；`com.aivora.studio` 是首次发行待最终核定的稳定技术 ID，不表示域名或品牌权属已核。构建前须检查旧安装身份、升级备份执行门和工具缓存。

builder v26 默认可能重建原生依赖，并对未找到的生产依赖只报 warning；草案显式设 `npmRebuild=false`、`nodeGypRebuild=false` 和 `allowMissingDependencies=false`，暂存脚本也固定核这些值。应用运行依赖须已在暂存目录、由独立冒烟验证；这些配置不阻止 builder 下载 Electron、NSIS 或其它构建工具，工具缓存及 SHA 未固定前仍不得调用 builder。

暂存清单还必须列 `runtime-layout`（源路径为 `packaging/windows/runtime-layout.json`，目标在 `resources/` 下）及 `runtime-layout.json` 中每个必需角色。独立 QA 另交 pinned `contracts-smoke` JSON 回执：`schema_version=1`、`result=PASS`、`exit_code=0`、`candidate_head`、`electron_version`，以及 `desktop_main_sha256`、`contracts_package_sha256`、`contracts_artifact_js_sha256`、`contracts_invalidation_js_sha256`。`stage-windows-runtime.ps1` 比对回执 SHA、候选和这些固定输入后才创建全新暂存目录。回执记录的是相同 Electron/包结构的 CJS/ESM 加载结果；QA 保留原始命令和输出。预检或暂存本身不产生安装器。

`release-inputs.template.json` 逐一列出当前布局的全部必需角色及来源占位，`example_only=true`、空 SHA 和待审状态使它不能通过发行预检。版本组须在实际构建后把占位替换为候选内真实文件，补齐完整 desktop/renderer/sidecar 目录中每一项运行文件和许可证材料，计算每项 SHA，再由对应负责人填发行批准引用；不能只将模板的开关改为 `false`。

发行预检对源路径统一 `/` 与 `\` 后判重；同一文件不能以两种 Windows 分隔符写成两个清单项。每个源仍须在候选根内逐段检查链接并校验 SHA。

脚本还逐文件枚举 desktop `dist`、renderer `dist`、contracts runtime 输出和 sidecar 目录；任一构建文件未列入清单、未按对应目录结构映射到包内目标或出现链接即拒绝。清单仍须由版本经理审核字体、许可和工具之外的其它资源是否完整。

当前 c19 desktop `dist` 有 57 件，其中 18 件为 `.test.js`，还含仅供测试导入的 `proposal-run-test-fixture.js`。暂存脚本现拒绝 desktop 树内 `.test.js`/`.spec.js` 和 `*-test-fixture.js`（含 CJS/MJS 后缀）；不能删除 c19 现有 QA 产物来凑发行清单。QA03 已在独立目录完成 Release TS 编译：`RECEIPT.json` SHA256 `E2B3B93A22AFCFC7FDAA1E0142322FE754B0A2E41D68D0E289542592CA7EEB9B`，38 个 JS/405,973 bytes，逐件来源与拟定 `app/dist/` 目标见外置 `rel02-release-desktop-qa-output-20260928.json` SHA256 `6BF209D835E777396FF4E245AF746E8BF84D2714CFFD2FEA8ADF82B6204A6309`。该树尚未受控进入同一发行候选，不能直接视为已暂存或已打包。

版本组随后冻结这 38 件干净输出于 `release-snapshots/20260928-release-desktop-runtime-38-1/dist/`，`FILES.json` SHA256 `227375AE5ED3AB42BD40BDDFD0694EDCE0B654C89B9D999399A68655BA9E369D`；REL02 复核 38 件 SHA/字节无漂。它是下一门 **desktop runtime 唯一取件输入**，仍须由版本组放进包含其余已批准组件的同一候选根、编完整发行清单并通过独立 Electron 冒烟，才能调用暂存脚本；冻结副本不等于发行暂存或安装。

版本组在任何安装器工具运行前，用 `scripts/verify-windows-stage.ps1 -StageDirectory <绝对暂存目录> -ExpectedStageReceiptSha256 <预先固定的STAGED-INPUTS.json哈希> -ExpectedInputManifestSha256 <预先固定的发行清单哈希>` 再核暂存回执、布局、所有列名文件和无额外文件。它只读、不调用 builder；即使返回 PASS，也只证明暂存目录字节与固定回执相符，不证明安装器生成物、安装或应用运行。

## 当前可用性

- 开发候选未生成 `apps/desktop/dist/main.js` 或 `apps/studio-web/dist/index.html`；仓库没有 sidecar 独立可执行产物，也没有已安装且获准的 Windows 安装器工具。现有 `apps/desktop/package.json` 只有开发 Electron 启动与 TypeScript 编译。
- 当前 WinGet FFmpeg 8.1.2 full 构建启用 `--enable-gpl --enable-version3 --enable-static`、`libx264`、`libx265` 等组件；仓库锁将该成对工具标为 `GPL-3.0-or-later`、`DEVELOPMENT_ONLY`。它可用于已授权的本机开发验证，不能直接作为本暂存目录的发行输入。
- 现有 `@aijian/contracts/{artifact-proposal,invalidation-operation}` 是桌面非类型运行导入。DEV07 新版 runtime 编译入口拟输出 `type=commonjs` 的独立七件；暂存清单必须逐文件列出真实输出与 SHA，不能使用旧 ESM 七件。新版尚未构建或加载；独立 QA 须在同一包结构下验证 CJS require、ESM import，并另验实际 Electron 加载，失败阻断暂存和安装候选。输出存在本身不证明可加载。

## 可发行媒体工具的输入

由发行负责人确定 GPL 合规发行或另选满足功能的 LGPL 构建。必须先固定 FFmpeg/FFprobe 二进制来源、版本、完整配置参数、成对 SHA、实际编码能力、对应源码与外部组件来源、许可证全文、NOTICE 和应提供的源码/构建材料，再由媒体契约 owner 更新受控锁并完成独立核对。FFmpeg 官方说明：启用 GPL 部分后整个 FFmpeg 适用 GPL；其 LGPL 发行检查清单要求关闭 `--enable-gpl`/`--enable-nonfree`，并核对对应源码和外部库义务。参见 <https://ffmpeg.org/legal.html>、<https://ffmpeg.org/general.html>。Gyan 的 Windows 构建页称其预编译包为 64 位静态 GPLv3：<https://www.gyan.dev/ffmpeg/builds/>。

当前本机包的 `README.txt` 指向 FFmpeg commit `38b88335f9`，并附 GPLv3 `LICENSE`；它没有让本项目自动取得完整发行清单或合规签署。许可证结论由有权负责人给出。现有 preflight 对媒体锁要求 `RELEASE_APPROVED`，而当前后端锁 schema 尚无这一状态；正式发行契约需双方协调，不能改清单标签绕过。

## 安装与数据边界

安装范围为 Windows 标准用户的 per-user 安装，无管理员提权。升级前备份并验证用户数据可读；失败保留原版和数据。卸载默认仅移除程序，保留 `userData/workspace` 和凭据引用；清理数据必须是另一个明确用户动作。草案拟用 `electron-builder@26.17.0` 及 NSIS；依赖引入、缓存/网络行为和许可仍待审批。本目录不调用下载、签名或发布。

**构建阻断项：**`installer.nsh` 已接入 v26 的 `customInit`，发现旧安装登记、旧版可执行文件或 `%APPDATA%/AIVORA` 留存目录就会在覆盖前中止；这是当前缺少一致性备份入口时的安全阻断，并非升级或保留数据后的重装已实现。须先实现并用旧版安装实测 NSIS 在覆盖旧版前完成数据备份、完整性校验和失败中止；再固定 `appId` 与旧安装身份兼容性、签名/权属、sidecar 独立可执行文件、媒体发行输入、Electron/NSIS 工具及其离线缓存 SHA。现有 `verify-windows-install.ps1` 只检查 QA 提供的安装前后文件证据，不会替安装器执行备份。

独立 QA 应在无 Node/Python/FFmpeg 开发工具的环境验证安装、中文路径、sidecar 启停、保存重开、升级恢复和卸载后数据策略，并以同一安装包 SHA 记录结果。暂存检查、编译通过或本机开发运行不代替该验收。
