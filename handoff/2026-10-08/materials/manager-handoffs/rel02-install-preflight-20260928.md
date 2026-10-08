# REL02 Windows 安装任务包（静态交接）

日期：2026-09-28。范围：唯一 AIVORA Electron 桌面软件的本地安装准备。本文件只定义下一实施包，不代表已有安装候选、安装验收或发行许可。

## 当前输入与阻断

- 唯一开发候选：`C:/Users/Administrator/.codex/worktrees/s2-q1-g1-d00-default-deny-59f-20260923/sp`，核对时 HEAD 为 `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`，含未提交产品改动。开工时必须重取逐文件哈希；HEAD 不能单独标识候选。主仓库 `C:/Users/Administrator/Documents/sp` 的原 13 项改动保留。
- `apps/desktop/src/main.ts:69-85` 在 `app.isPackaged` 时抛错；开发模式从仓库 `.venv` 和 `PYTHONPATH` 启动 sidecar。`:116` 以开发目录关系加载 renderer。`apps/desktop/src/sidecar-process.ts` 已有子进程握手、超时和关闭联动，应保留。
- `apps/desktop/package.json` 只有 TypeScript 构建和开发 Electron 启动；现有 package/lock/pyproject 未找到安装器或 Python 独立打包工具配置。`pyproject.toml` 设置 `package = false`。现有构建通过不代表可安装。
- `config/media-toolchain-lock.json` 唯一 FFmpeg/FFprobe 配置为 GPL-3.0-or-later、`DEVELOPMENT_ONLY`。`services/api/src/aijian_api/media_toolchain.py:60-64` 对 GPL/nonfree 配置维持开发专用。`sidecar.py:98-99` 与 `main.py:312-313` 从当前工作目录读媒体锁；安装布局必须明确该路径。现有开发工具二进制不能直接当作已获发行批准的安装输入。
- 独立 c19 由 MGR02/QA03 独占；本岗不写 c19，不复用其 dev Electron 启动为安装证明。

## 拟分配文件与唯一作者

| 文件或输出（拟议，待 MGR04 确定） | 唯一作者与工作 |
| --- | --- |
| `apps/desktop/src/main.ts`、必要时 `apps/desktop/src/sidecar-process.ts` | DEV07 经 MGR01 确认后修改：为打包态选择固定 sidecar 可执行文件与工作目录，校验资源存在，定位包内 renderer；沿用受控环境、握手、关闭联动和用户数据目录。REL02 不并写。 |
| `services/api/src/aijian_api/sidecar.py`、`main.py` 的媒体锁定位接口 | 如确需修改，由 MGR01 指定原业务作者；传入受控资源根，不依赖安装目录可写或开发仓库 cwd。REL02 只提供布局要求。 |
| `packaging/windows/release-inputs.json`、`packaging/windows/README.md`（新文件） | REL02 拟写固定输入清单、目录布局、构建前拒绝条件、安装和回退操作；文件名与 schema 经 MGR04 核定。 |
| `scripts/package-windows.ps1`（新文件） | REL02 拟写只消费已核哈希输入的本地打包命令；待确定可复现安装器工具后实施，不隐式下载、调用外部服务或签名。 |
| `NOTICE` 与发行许可证目录（增补） | REL02 汇总 Electron、Python 依赖、字体、图像、媒体工具等许可原文、来源与哈希；许可解释和发行决定由有权负责人签署。 |
| 安装产物目录与 `manifest.json` | MGR04 指定仓库外的固定目录；REL02 生成产物清单和 SHA256，REL01/MGR04 核对源码、构建和包一致性。 |

以上为拟议路径，不是整目录写权限。DEV07 当前持有桌面运行时源；涉及既有文件的写入等 MGR01/DEV07 释放记录。

## 固定输入清单与 manifest

打包前固定：候选 HEAD 与未提交文件清单及 SHA256、`package.json`/`pnpm-lock.yaml`/`uv.lock`、renderer `dist`、desktop `dist`、sidecar 独立运行时及其依赖、媒体工具及锁、字体/图片、全部许可材料。每件输入记录绝对源路径、逻辑包内路径、文件大小、SHA256、来源、许可状态、唯一 owner；拒绝缺失、漂移或 `DEVELOPMENT_ONLY` 发行输入。

产物 `manifest.json` 至少记录候选指纹、构建命令与工具版本、输入清单哈希、安装包文件名/大小/SHA256、界面版本、sidecar 与媒体组件指纹、许可证清单哈希，以及 QA 使用的同一安装包指纹。正式字段和目录由 MGR04 冻结；不得用仓库 HEAD 代替脏候选指纹。

## 实施与独立验收

1. MGR01/DEV07 冻结桌面文件 owner、打包态资源布局与 sidecar 启动契约；MGR04 冻结候选和固定输入。REL02 只在释放后写新增打包文件。
2. 本地构建安装候选后，REL02 对每个输入、包内必需组件及安装包计算 SHA256，留原始命令、日志、失败和产物映射；不把构建成功记作安装通过。
3. QA03 用无 Node、Python、FFmpeg 开发工具的干净 Windows 标准用户环境，按安装说明安装并启动。记录安装包 SHA、系统/账号、安装路径、进程、sidecar 握手和错误入口。
4. QA03 在中文路径下创建或读取一份已批准测试作品，保存、正常关闭、重开并核对身份和内容；验证安装目录只读条件下用户数据留在用户目录，sidecar 退出后无假在线状态。
5. QA03 对同一数据执行备份、升级、恢复与再次读回；模拟 sidecar 启动失败、媒体工具缺失/不匹配，核对诊断和数据保全。保留原始失败；发生数据库迁移时另核迁移前备份与回退策略。
6. MGR04 核源码/构建/包哈希与 QA 记录一致。AC01、AC10、工程门、完整产品和最终用户验收各自签署；局部安装检查不能代签整品。

## 待一次汇总的决定

1. **新增工具与下载**：确定受支持的 Windows 安装器和 Python 独立运行时打包方法、版本、来源、锁定哈希及下载许可。现阶段不下载新依赖。
2. **发行许可**：确认可发行 FFmpeg/FFprobe 配置与编码能力、来源/哈希/义务；复核字体、图片、Electron、Python 依赖及模型材料。现有 GPL 开发配置不作为正式发行输入。
3. **签名与对外发行**：签名证书、发布渠道和实际对外发放另行明确；本任务不签名、不发布。
4. **安装范围**：安装器形式、目标 Windows 版本、升级与数据回退策略由 MGR04 固定后写入操作说明。真实付费服务调用、正文上传和新服务安装分别按授权边界执行。

当前结果：静态任务包已备；无安装包、无独立安装测试、无发行签署。

## 第一增量执行回执

仅新增两个文件，未改 `package.json`、桌面运行时、c19 或主仓库：

| 文件 | SHA256 |
| --- | --- |
| `packaging/windows/release-inputs.example.json` | `1773534143852926BA8B60D07CE8319F0C4DC7621BEDB531E0F2D4030D4CC727` |
| `scripts/release-preflight-windows.ps1` | 初版 `E9F1521F812AF0BC1AC76EC2B9C16C933494DD5D3001827440D8A42AAC498115`；发行门修复后 `ABD972E43245D225725CA79B64F93CBD6F978D897A0922E1AF41752B19BB901F` |

脚本用 PowerShell 内置 JSON、Git 只读 HEAD、SHA256 校验候选输入；默认 `Release`，开发用途需显式 `-Purpose Development`。`example_only=true` 始终拒绝；发行模式拒绝 `DEVELOPMENT_ONLY`、缺少批准引用、必需角色缺失、路径不安全及哈希漂移。它只验证所列输入，不能证明清单已穷尽依赖，也不构建安装包。

本地检查原始结果：

```text
parse_error_count=0
example_schema=1 example_only=True purpose=Development
EXAMPLE_EXPECTED_REJECT=Release preflight: example manifest cannot be used as an input
DEVELOPMENT_PREFLIGHT_PASS
DEV_ONLY_EXPECTED_REJECT=Release preflight: input is not approved for release: preflight-script
HASH_DRIFT_EXPECTED_REJECT=Release preflight: input SHA256 drifted: preflight-script
```

开发通过案例使用系统临时目录中的单文件清单，输入为脚本自身及其现算 SHA；运行后删除该临时清单。未执行安装、构建、签名、下载或外呼。下一增量需先冻结实际 sidecar/renderer/媒体运行时布局、工具与许可证，并由 DEV07 完成其拥有的打包态接线。

### 发行门修复

MGR04 复核发现：初版只读输入 manifest 自称的 `distribution_status`，可把实际开发专用媒体锁伪标为已批准。仅在预检脚本 Release 分支增加 18 行：固定 `media-lock` 为仓库 `config/media-toolchain-lock.json`，读取真实 profile；用已校验的 FFmpeg/FFprobe 文件 SHA 选择唯一 profile；要求该 profile 明确为 `RELEASE_APPROVED` 且许可证类别、SPDX 均为 LGPL。无已批准 profile、哈希不匹配、未知或开发专用状态均拒绝。精确差异为脚本第 82–98 行新增检查；其余代码未改。初版可由上表旧 SHA 对照重建。

```diff
@@ -78,6 +78,24 @@ if ($Purpose -eq 'Release') {
     foreach ($role in @('desktop-main', 'desktop-preload', 'renderer-index', 'sidecar-runtime', 'media-lock', 'ffmpeg', 'ffprobe')) {
         Assert-Input ($seenRoles.Contains($role)) "required release input missing: $role"
     }
+
+    $mediaInput = @($verified | Where-Object { $_.role -eq 'media-lock' })[0]
+    $ffmpegInput = @($verified | Where-Object { $_.role -eq 'ffmpeg' })[0]
+    $ffprobeInput = @($verified | Where-Object { $_.role -eq 'ffprobe' })[0]
+    Assert-Input ($mediaInput.path.Replace('\', '/') -ceq 'config/media-toolchain-lock.json') 'media-lock must use the repository lock'
+    $mediaLockPath = Assert-PlainFileUnderRoot $root $mediaInput.path
+    $mediaLock = Get-Content -LiteralPath $mediaLockPath -Raw -Encoding UTF8 | ConvertFrom-Json
+    Assert-Input ($mediaLock.schema_version -eq 1 -and $null -ne $mediaLock.profiles) 'invalid media toolchain lock'
+    $approvedProfiles = @($mediaLock.profiles | Where-Object { $_.distribution_status -eq 'RELEASE_APPROVED' })
+    Assert-Input ($approvedProfiles.Count -gt 0) 'media lock has no release-approved profile'
+    $matchingProfiles = @($mediaLock.profiles | Where-Object {
+        $_.ffmpeg_sha256 -ieq $ffmpegInput.sha256 -and
+        $_.ffprobe_sha256 -ieq $ffprobeInput.sha256
+    })
+    Assert-Input ($matchingProfiles.Count -eq 1) 'ffmpeg/ffprobe SHA256 do not select one locked profile'
+    $selectedProfile = $matchingProfiles[0]
+    Assert-Input ($selectedProfile.distribution_status -eq 'RELEASE_APPROVED') 'selected media profile is not approved for release'
+    Assert-Input ($selectedProfile.license_class -eq 'LGPL' -and $selectedProfile.spdx_license -match '^LGPL-') 'selected media profile license is not release-compatible'
 }
```

现有 Python 媒体锁 schema 只允许 `DEVELOPMENT_ONLY` 或 `RELEASE_REVIEW_REQUIRED`，现有锁为 GPL 开发专用。因此当前 Release 必须拒绝；未来发行 profile 需要媒体契约 owner 与许可证负责人共同确定并修改，REL02 不自行改锁或宣称许可通过。

新增拒绝用例把所有 manifest 条目标记 `RELEASE_APPROVED` 并填 `TEST_ONLY_NOT_AN_APPROVAL`，但 `media-lock` 指向当前真实开发锁。其他必需角色均使用当时存在的仓库文件及现算 SHA 作为测试替身；这不是可发行输入。原始输出：

```text
syntax_errors=0
FAKE_APPROVAL_EXPECTED_REJECT=Release preflight: media lock has no release-approved profile
EXAMPLE_EXPECTED_REJECT=Release preflight: example manifest cannot be used as an input
DEVELOPMENT_PREFLIGHT_PASS=1
HASH_DRIFT_EXPECTED_REJECT=Release preflight: input SHA256 drifted: preflight-script
```

测试清单只写系统临时目录并在运行后删除。没有正向发行通过案例，因为实际许可和可发行媒体 profile 尚不存在；本地拒绝检查不等于独立 QA 或法律批准。

## 2026-09-28 后续打包草案增量

上述“发行门修复”记录保留当时版本原样。后续版本把媒体许可类别从只允许 LGPL 改为可接受经真实锁 profile 审批的 LGPL 或 GPL，且要求 `spdx_license` 与类别匹配及 profile 自身的 `approval_reference` 非空。这样不会把当前 GPL `DEVELOPMENT_ONLY` 锁放行；GPL 路线仍需许可负责人核真实分发义务及对应源码。当前脚本 SHA256：`8A7F0FC67B3D2E6FCA53D3A983DAC02F674A7111FADD66DB47D349833367F1FD`。语法 0 错误；示例清单 Release 仍报 `example manifest cannot be used as an input`。未取得正向发行批准。

唯一作者候选新增 `packaging/windows/runtime-layout.json`、`app-runtime.package.json`、`electron-builder.v26.json`、`README.md`、`INSTALL-VERIFY.md`、`MEDIA-RELEASE.md`，及 `scripts/stage-windows-runtime.ps1`、`verify-windows-install.ps1`。暂存脚本先做真实 Release 预检、独立 Electron CJS/ESM 冒烟回执 SHA 与输入哈希绑定、运行时目录全文件枚举和目标安全检查；不在候选或其它 Git worktree 写暂存输出，且不覆盖旧目录。安装验证脚本仅核文件/哈希，实际运行与读回留独立 QA。`app-runtime.package.json` 为 CommonJS 主进程与固定 `@aijian/contracts` 0.1.0 运行依赖元数据，不复制开发 `workspace:*`；暂存会核与编译后 contracts runtime 包版本相同。

`electron-builder.v26.json` 为待审批草案：`appId=com.aivora.studio` 是首次发行待最终核定的稳定技术 ID，`productName=AIVORA`；本机卸载登记和已读仓库材料未发现旧身份，不等于其它机器、权属或兼容核定。计划工具为 `electron-builder@26.17.0`、NSIS，仓库尚未安装/锁定，`package.json`/`pnpm-lock.yaml` 未改。sidecar 独立 exe、媒体发行锁与二进制、独立 QA 冒烟、安装器升级前自动备份与失败中止钩子均未完成。该配置当前不能用于正式构建或交付，未下载、构建、签名、发布或安装。NSIS 配置默认 per-user、不提权、不删 app data；正式升级数据安全仍需实际钩子和旧版安装 QA。

最新文件 SHA256：

| 文件 | SHA256 |
| --- | --- |
| `packaging/windows/app-runtime.package.json` | `E770C563D30D202B4595DB4667796C62E34D54D9A0BAEF65F956A0D04DA06C9E` |
| `packaging/windows/electron-builder.v26.json` | `F532CA51DF57635C6FB545EF6DE86B2BCAD7B7D62590AAC63FD24A975AA62718` |
| `packaging/windows/INSTALL-VERIFY.md` | `C05696F6783F0213B5DA8BF4AD68FBE0B0F4954847A061166ADB46DB5F6FFE88` |
| `packaging/windows/MEDIA-RELEASE.md` | `5764469CD51CCFEB6162933F3476E3D946CC7918F72F1477DB0ECFBD0B9C6780` |
| `packaging/windows/README.md` | `7276DC7CB3A4FE0477E187D3DC2A7E2BB3141C7935117A093D8CE0A9BC521ECF` |
| `packaging/windows/runtime-layout.json` | `1A742B2C43AF9E5E707D66567A8BB1AD39C9CDFBA18A326566D2F89CBC788842` |
| `scripts/stage-windows-runtime.ps1` | `313548A8D7B473B2582075D9ECB1A81663CD4A8FC56701C49993C846D449B012` |
| `scripts/verify-windows-install.ps1` | `1E4A21BE7264BA356F5E15CA21B8118BDBF59C8AC542A2BC8475243668CD6898` |

以上 SHA 在 2026-09-28 本增量写入时计算；后续文件修改须重算。官方参照：https://www.electron.build/v26/docs/nsis/ 、https://www.electron.build/v26/docs/contents/ 、https://pyinstaller.org/en/v6.22.3/license.html 。

### 后续安全增量与最新 SHA（替代上表当前值）

预检因 Windows 隐藏构建目录路径逐段读取而给 `Get-Item` 加 `-Force`，最终本轮 SHA `7B62665C220870846CE8377EFBA69658ADF706005464A832FB3974620E84D28C`。阶段输出新增固定 `build/installer.nsh`、`build/electron-builder.json` 两角色并锁源路径；stage SHA `11F459B5E60454E54695B8FC2A9370CB39C3BB3BE07EB5B43E8FACE22B1BCC06`，layout SHA `0F6EFF7BCAB2585A90846AA4CC9F5C70CD5D34953E902898CD2AA8D95B93516B`。

`installer.nsh` SHA `D1D2104EA8322CD09084471CFC0F7AA3E8C6E8620F2A5DF955A3B7B0B69ABEA0`：v26 NSIS `customInit` 检测 HKCU 安装登记或旧 `AIVORA.exe` 后立即 Abort；首次安装可继续。当前这是可审的升级前失败门，**不代表升级备份完成**。DEV05 已给 `--backup-workspace` CLI 静态接口，尚未完成 exe/恢复/跨文件一致性独立 QA，按其要求不接通钩子。`UPGRADE-BACKUP-CONTRACT.md` SHA `DC6BECBE78ECE7ECDB13F8C774CB3F402EA57D54FE35FA835529056F42A1EF05` 记录未来新包 helper 的执行与恢复门。

`electron-builder.v26.json` SHA `2386E1B1487DDD9874C1D42485A06ACA0AF4C2DBBC105F94D28405895D945C0C`，锁 `electronVersion=43.2.0`、win32-x64 ZIP SHA `EBA5F5088AF40ECB364FE258809C79A5234C6ECE5A75C64722772EBA01B02786`，已与 Electron 官方 v43.2.0 `SHASUMS256.txt` 精确匹配（https://github.com/electron/electron/releases/download/v43.2.0/SHASUMS256.txt）。`BUILD-TOOL-REQUEST.md` SHA `9B406D38F4B62667AD37409F0AEC70A57BD6B38ACD845F3CB59805B8CE315B73` 列 electron-builder 26.17.0 npm sha512 integrity、MIT、PyInstaller 6.22.3、NSIS/tool cache 与网络边界；所有新工具仍未安装。JSON 3/3 解析、PowerShell 3/3 语法 0 错；Release 示例清单拒绝且暂存目录不存在。

## MLT Windows 插单只读调查（2026-09-28）

总控经 MGR04 插入 MLT 适配依赖调查，先只读、不获取或安装工具。唯一作者候选 `packaging/windows/MLT-WINDOWS-READONLY.md` SHA256 `A2E2D42242FDE0D6745D5EDBA91D166EDD3655B97A127ED9193E1B6B56D1BF96` 已记本机范围、MLT v7.40.0 官方源码唯一资产（6,775,875 bytes，sha256 `f11c30e21670f62a3dfc56a31306ac02f3feea00908a2821a4a0bf3e989d3d6a`）、官方 Windows CI MSVC/vcpkg baseline、模块依赖、Qt/pango 条件与许可。DEV08 暂定合成 TEST 需两视频轨/转场、双音轨/字幕、H264/AAC；ART04 素材/工程 SHA 未冻结。当前无可信本机 melt 或官方 v7.40.0 Windows release binary，不把 Shotcut 整包当发行 runtime；下一门为固定 TEST 的服务/输入和许可范围，再请求完整工具链审批。

### MLT 规格校正与唯一推荐（替代上节暂拟值）

MGR03/ART04 最终 TEST 规格当前实算 SHA256 `7D1E494083EF6702E9B17F8A2D923A46E03A763525E2DF3737C33AFC7ED07FE0`；AF56D、D687F 是补对白边界和增益前的历史版。目标 125 帧/25fps/5.000s/1080×1920、双视频重叠 25 帧、1000Hz 非语音提示音+BGM 双轨 `gain_millidb=0` 与两条字幕。五件合成输入/工程/MP4 尚未生成，无 SHA。

`packaging/windows/MLT-WINDOWS-READONLY.md` 最新 SHA `EA191C4DF3E8C3CA816ACAF66A00981D9CC1BDC8D29B1AB5503C49F57AF74D30`。唯一优先获取建议仅用于隔离技术 TEST：官方 Shotcut v26.8.1 Windows portable ZIP，225,002,077 bytes、SHA256 `b0148856de01b39add4bf4d6a813bfbc554b4663b65e3ca25cb2589f47555a6a`，官方 checksum 文本 849 bytes；审批后只下载、校验、解包并核 melt/version/modules/DLL/license，不能把 Shotcut 全包当 AIVORA 发行 runtime。当前未获批准也未下载。若 ZIP 无所需 melt/服务或许可不合适，则回源码构建另审；MLT v7.40.0 release 仅源码 tar，无官方 Windows melt binary。本机无 MSVC/CMake/Ninja/vcpkg；源码路径需要固定完整传递依赖与下载范围后再申请。

## 2026-09-28 升级回执验证与MLT执行规格增量

`verify-windows-install.ps1` 当前 SHA256 `3FE32F6F2455E3126ADD35695F260CE774059B4906643329956C30242B2D2B28`：PostUpgrade 不再把备份当单个文件，而核 DEV05 helper 的备份目录 `receipt.json` 预期 SHA、source_workspace、数据库、每个列名文件的字节数/SHA、未列文件与链接。`INSTALL-VERIFY.md` SHA `ECEAB84856145655468A139067571C62234B571CF8A7A139DE847DDAC6D1C4FC` 同步参数语义。PowerShell AST 0 错；系统临时目录纯合成两文件正向 `positive=PASS files=2`，故意追加媒体字节后 `tamper=EXPECTED_REJECT Windows install verification: backup byte size drifted: media-assets/item.bin`，临时目录已逐项清理。该测试只验证脚本格式/防篡改逻辑，不证明真实 SQLite 恢复、安装器备份钩子或升级。

ART04 同路径规格后续固定当前 SHA `4323DFEF3EEF9337BAF49A5118DE1397B4C2AFBE2E67768E133F87C950DDF16D`，取代 7D1E：新增本合成 TEST 专属 V1/V2 320×568 到 1080×1920 `STRETCH_TO_CANVAS`、白条完整，其他帧/轨/gain 未变。DEV08 当前 XML 候选用 luma/mix/qtext/avformat/xml，因此 Qt 模块和实际 Qt DLL/字体为必核。`MLT-WINDOWS-READONLY.md` 当前 SHA `63571A58CB40901B48AD081AD6999424BD0F3E09BE536F6A0298C01643AEB0ED`；旧 SHA 只作历史。Shotcut 官方 portable ZIP 仅待审批隔离TEST获取方案，未下载或安装。

## 发行输入完整角色模板增量

唯一候选新增 `packaging/windows/release-inputs.template.json` SHA256 `3AC00845A1A9811EE3640623EDAF671D4607E0AE0F8B666C398B5581240CC6A8`：对 runtime-layout 21 个必需目的地加 runtime-layout 自身共 22 角色逐项列源路径/目标；未构建或未批准的路径为明示占位，SHA 为 null、状态 `RELEASE_REVIEW_REQUIRED`、`example_only=true`。静态核对 `required=21 inputs=22 missing=0 mismatch=0 duplicate=0`，Release 预检实际拒绝 `example manifest cannot be used as an input`。这只是完整角色模板，版本组仍需枚举 desktop/renderer/sidecar 构建目录的额外文件，冻结每项 SHA 与审批材料。README 当前 SHA `88375CBF3D8B9ADAC672141846479EFA86F25B1DEFC22E366E3EDB4032B317A6`。

## Runtime 目录映射封口

REL02 `scripts/stage-windows-runtime.ps1` 当前 SHA256 `0E9345CE0346AA3F009FEDB71A27D842B7BC53551E32C2067A46D60FD14D7EEC`：在原有四类目录完整枚举/无链接检查之外，逐文件要求 desktop dist→`app/dist/`、renderer dist→`resources/renderer/`、contracts runtime→`app/node_modules/@aijian/contracts/`、sidecar runtime→`resources/sidecar/`，保留相对目录。这样列入 manifest 但目标放错的文件也会拒绝。PS AST 语法 0 错；发行模板仍按 example_only 拒绝，外部暂存目标未创建。因真实 dist/sidecar/媒体许可缺失，本轮无正向 Release 暂存证明。

## 暂存回执只读复核入口

新增 `scripts/verify-windows-stage.ps1` SHA256 `2BEA94B70538ED1E071CAE19440C66443EA2B00248998D2E8773366C3C667866`，供工具获批后在 builder 运行前核暂存目录：外部固定的 STAGED-INPUTS.json 和发行清单 SHA、布局必需目标、每个列名文件 SHA、额外文件与链接。脚本只读，不调用 builder。PS AST 0 错；纯合成两文件暂存目录测试 `positive=PASS count=2`，修改 main.js 后 `tamper=EXPECTED_REJECT Windows staged input verification: staged file SHA256 drifted: app/dist/main.js`；临时目录逐项清理。此合成测试不证明真实 Release 暂存/安装。README 已补调用边界，SHA 见本节后续报告。

## 运行时身份与重装保留数据门

根据 Electron 官方 `app.getPath('userData')` 默认由 appData+应用名组成、`productName` 优先于 `name` 的文档，REL02 在 runtime 包元数据固定 `productName=AIVORA`，并让 stage 脚本核 builder config `appId=com.aivora.studio`、productName 一致及 NSIS per-user/no-elevation/preserve-appdata/include 钩子。`app-runtime.package.json` 当前 SHA `42FA9DD9CED0F83CDADCD552A7C91F44BEAD0A92F5F994F3ADD762FB57E97712`；stage SHA `51F893AA5128DD4186CD08F62C6F28284CCAEFA95AFAA3D41D65C63051F8DA51`。`installer.nsh` 当前 SHA `F24F391E31C30160BE3F541DFB2008E3CEF082C2D6D1DC2263ACB557AD0C544F`：旧登记、旧 exe 或 `%APPDATA%/AIVORA` 留存目录任一存在均在覆盖前 Abort，避免卸载保留数据后重装绕过备份门。实际 Electron userData 路径仍须 DEV07 独立打包冒烟读回，NSIS 尚未编译/运行。README 当前 SHA `C901D63288AF13E3D33E92FA70C087E809EA0BCB5A666B7DB9E7235E53E372D8`、UPGRADE-BACKUP-CONTRACT SHA `C6AEAFA523BEECD8B924600CB33CD99EAB43C284E08921347FBC567C6761A99C`。

DEV08 的 MLT 静态适配又固定 `affine` filter/transition 作为 TEST stretch 服务；REL02 隔离候选需在 `melt -query` 核该服务。具体文档 SHA 以最新回读为准，仍无二进制运行。

## 历史安装身份静态审查补记

总控提醒旧版 Electron 可能使用不同 userData 名称。REL02 回读当前 `apps/desktop/src/main.ts`：打包分支以 `app.getPath('userData')/workspace` 传 sidecar，`app.setPath` 仅用于未打包 E2E；源码包名 `@aijian/desktop`，当前 runtime 包 `productName=AIVORA`。`services/api/src/aijian_api/credential_vault.py` 以系统 keyring 保存 provider 密钥，服务标识 `aijian-studio/provider-api-key`，数据库持引用。未读任何凭据值。`packaging/windows/UPGRADE-BACKUP-CONTRACT.md` 已改为将 `%APPDATA%/AIVORA/workspace` 记作待证路径，并要求旧版安装登记/appId/可执行文件名、实际 app.getName/userData/workspace/DB 映射与隔离 fixture 的备份失败、恢复可读性。当前 SHA256 `0DD1B43246B5129B71EC8ED1B2C8DB8CEAB3CE386183EFA950DF9FBCFDF47611`。NSIS hook 未改，仍只拒绝它能识别的旧安装及 AIVORA 目录，不能称覆盖所有历史升级；等待 DEV07/QA 实包读回和 DEV05 凭据映射核定。

## 备份路径重叠复核与凭据引用边界

`verify-windows-install.ps1` PostUpgrade 现拒绝备份目录与源工作区**任一方向**的父子重叠（原来只拒绝备份位于工作区内）；SHA256 `855D545003DC28C0D96601C8AD02455B025B05A62C8D76557978567458EDDE3D`。PS AST 0 错；合成目录把备份设为工作区父目录，返回 `Windows install verification: backup directory overlaps user data`；临时 fixture 逐项清理。此验证不证明真实备份/安装。

`UPGRADE-BACKUP-CONTRACT.md` SHA256 `AAF91B0689CA431C0BC4F35A3F457E8EC6E5859EEB9A0200FFB6DEC3F091535C` 补 DEV05 静态结论：旧 v30→31 数据库 credential_ref=connection_id，但 Vault 密钥不随工作区备份；同系统账号/同 keyring 后端/旧槽存在才可能解析。跨账号/机器或槽缺失必须 MISSING/UNAVAILABLE 并由用户明确重新配置，不自动外呼/轮换。`INSTALL-VERIFY.md` SHA256 `AE1366BE62F361642E565F542515CDAD2D301350CAA20A0B5461B377BC8B5E1A` 补路径/凭据读回门。未读取密钥，未运行旧版迁移或安装。

## 发行清单源路径判重修正

`release-preflight-windows.ps1` 现在把源路径 Windows 分隔符统一后才判重，避免同一候选文件以 `/` 和 `\` 两种写法重复列名、破坏一源一项清单约束；SHA256 `A4AA987D8411A8EF5771720AEB4DCE6A17FB6378B17A9941731737CD6EF2EE0A`。合成 Development 清单两项指向同一 runtime-layout.json，分别使用两种分隔符，预检按预期拒绝：`Release preflight: duplicate input path: packaging\windows\runtime-layout.json`；PS AST 0 错，合成清单文件已删除。README SHA256 `FC5BCDCB49AF9AFB4A4E26438B3DB0FB67B867F7DA9B026D198227EC5C3A23EB` 补规则。当前仍无完整 Release 输入或安装器。

## builder v26 默认行为收紧

官方 v26 配置说明：`npmRebuild` 默认 true，`allowMissingDependencies` 默认 true（缺生产依赖仅 warning）；选定 v26.17.0 发行晚于 v26.16.0 的该字段引入。REL02 的 `electron-builder.v26.json` 显式设 `npmRebuild=false`、`nodeGypRebuild=false`、`allowMissingDependencies=false`，SHA256 `A579F9D258EE8F2B3A437215E0B39B52A45D3867B4F4BFE55F82B15F9230A63E`；`stage-windows-runtime.ps1` 核这三个值，SHA `09E171A21BC8CED0BD9E3FB74DC8A0D33C3D147B1F1FD1A7E19FBBED64C3D7DB`。JSON 回读布尔值 PASS、stage PS AST 0 错；未安装 builder，因此未做其实际配置校验或构建。README SHA `CE5D5DEAB307FEF2DEE9848EFB5FCBBCF90F38DF8558AB31D0C9DA6338812F40`、BUILD-TOOL-REQUEST SHA `4E6AE9C046A23AF64AF7E2E24656F78E404F4A425D8773548EE6FB1B191EB2D5` 明示这些设置不能阻止 Electron/NSIS/辅助工具下载，缺固定缓存仍禁止调用。

## MLT TEST 源码与安装布局当前性

REL02 回读当前 `apps/desktop/src/main.ts`：打包 sidecar 指向 `process.resourcesPath/sidecar/aijian-sidecar.exe`，renderer 指向 `process.resourcesPath/renderer/index.html`，与暂存 layout 对齐。`services/api/src/aijian_api/mlt_execution_worker.py` 现已有 `ENGINEERING_TEST_ONLY` MltEngineeringRuntime，要求安装根、melt、模块目录和全树文件身份；MLT 调查文档旧句“无调用点”已失效并修正，`MLT-WINDOWS-READONLY.md` 当前 SHA256 `A8E7EB604B00B6D3B3A4098A8619CF5D59DE902DC3773CC0647E7CAE7F2F55C8`。尚无 MLT Windows 二进制或服务/渲染验证，TEST runtime 不进入本次产品安装布局。桌面/renderer dist、独立 sidecar exe 仍不存在。

## D/repo30资源根安装态读回门

接 DEV05 静态依赖提醒：作者 `apps/desktop/src/main.ts` SHA `F6C664EF46B52ACFE827B578B6C787E43CD1EE4312A21B44640C2AA3DA92E97B` 已在 packagedSidecarOptions 以 `resolve(process.resourcesPath)` 传 `AIJIAN_RESOURCE_ROOT`，sidecar `runtime_resources.py` SHA `E93FC66B03FB4CF9B2969EC2AF453BCF3DA54C4B2C5E9B7E8D481BC7D72EFA0B` 从该根定位 `config/media-toolchain-lock.json` 与 `media`，REL02 layout SHA `0F6EFF7BCAB2585A90846AA4CC9F5C70CD5D34953E902898CD2AA8D95B93516B` 已列sidecar/lock/ffmpeg/ffprobe。但 c19固定QA checkout不能据此视作已有传参，亦无打包态读回。`INSTALL-VERIFY.md` SHA `4D8E5B5096735C3932A02B7FD30DF4CDACDFF47B728E8E7E8CD4807BB920186A` 增独立QA对实包 resource root、子进程变量、exe/lock/tool SHA 的路径/PID/哈希读回；缺读回或发行锁不批准时不做D新POST/输出认领。不读其它环境变量/凭据、不运行D或安装。

## DEV07 c19 最小打包分支取件契约

MGR01确认 c19 旧 `apps/desktop/src/main.ts` SHA `443624A7007C6664DC232895464AA7DD41F4B38D14FB3315088B1AF9F702401E` 无 packaged sidecar 分支，renderer仍指checkout dist；仅补 `AIJIAN_RESOURCE_ROOT` 无效。DEV07 将在其唯一owner窗口提供 c19 基线最小功能包（受控 sidecar exe/args/cwd、资源根、renderer index，不整源搬 A42）。REL02 只读核 `runtime-layout.json` 现有 app/dist、resources/renderer、sidecar、config/media 目标吻合未来接口，layout未改。`README.md` SHA `AB77E6C7CFF1143DD51BC775D4AEC9D02173517F8187EAE4C35334CB5E622FE3` 明确必须绑定 DEV07 新候选和实际构建 SHA、开发态拒资源根override；`INSTALL-VERIFY.md` SHA `2113AA1C6CD77F207242F24D733E6A5482616278513CA8C2128EC1EA84081058` 要求实包独立读回exe/args/cwd/renderer/resource root。新候选尚未取件，未安装/打包/c19写入。

## DEV07外置c19打包资源根候选静态对照与QA交接

REL02回读DEV07外置候选三件SHA：`work/dev07-c19-packaged-resource-root-candidate-20260928/main.ts` `E1BAAA599BB340BA4F2DEAD8755485B2E55406894E23F29D225EC0690823ABF0`，`main.diff` `85464554C583D8A7DF20CDC0E378E832307FAFE0E74EB8FD034766E649A740C8`，`SOURCE.json` `555EA6519DC50AC192AA0013C0B7AA3E92B5F5EF149A025C71FA71CA13754952`；c19基线main仍SHA443624A...。候选只在packaged Windows分支固定root/sidecar exe、args[]、cwd、AIJIAN_DATA_DIR/AIJIAN_RESOURCE_ROOT及renderer路径，缺资源fail closed；dev分支原路径不改。与REL02 layout的sidecar/config锁/renderer目标静态吻合；runtime layout未改。README更新为明确候选/未构建/未c19集成，SHA `D637D3DE28455B1B5B712F4EA5B54CAC3FB2C312B88290D98B93CAB02B3E5C15`。已将精确候选/哈希交QA03做c19外置类型/构建/负例，交QA02待MGR02窗口做实包readback；不写c19、不调用builder/安装、不代称QA通过。

## DEV07外置候选冻结取件指针

MGR04封存 `management/manager-handoffs/release-snapshots/20260928-c19-packaged-resource-root-main-1/SNAPSHOT.json` SHA `9D11A58DAD05D48BED698D05160A6FF7327C52BBEC630D0C0E03EE92A2D45364`；REL02回读目录内旧main443624A、候选mainE1BAAA、diff854645、SOURCE555EA651各实体SHA均与manifest一致。README现在以此版本组快照为精确取件源，SHA待本条前一行命令回读；仍是 STATIC_EXTERNAL_CANDIDATE_NOT_SYNCED_NOT_QA_ACCEPTED，c19无写入，QA03类型/构建与QA02实包读回未闭。
本次README最终SHA256 C81219006C621EFB20CEF73C071CFA12CDC28E2477C2C5DBDF1F71FC62148678。

## QA03外置packaged resource-root门回读

REL02回读QA03 `resource-root-gate-v2/resource-02/RECEIPT.json` 实体SHA `5129F1BC927D8108EC666E17776A042C7BDCDA5E7EB84D50B02996BD955E661E`，绑定版本组snapshot 9D11A58...、候选main E1BAAA...、c19旧main 443624...；typecheck/build诊断raw皆空SHA E3B0...，隔离emit 57件，main.js SHA `4541E89FFC4944ED449FD85F1C01AA6CCF7AEA14C5D53C3593327CDBDA78FB03`；negative-cases.json SHA `0DCE9D2FFF4F4AAEE9E05B9B27E1E6F74CAF303F6528E805807C3E472EFDD8DE`，正常fixture PASS、缺sidecar/锁/renderer/root与非packaged共5负例均按预期拒，范围 `EXTRACTED_FUNCTIONS_VM_MOCK_ONLY`。REL02另读c19当前main仍443624A。QA emit含测试模块，不是发行dist。README现SHA `AD022093FB3860053FE652AE53B74EC9ED6A05EA85B44D48169A8E9C671C92DC` 明确此门已过但c19未集成/实包未验；仍等MGR04唯一owner同步、独立packaged Electron读回和其余发行输入。未运行builder/安装。

## c19 packaged资源根单文件同步与REL02单根预检边界

版本组 `release-snapshots/20260928-c19-packaged-resource-root-sync-1/GATES.json` 实体SHA `4B1941606E45AC4E0DC11BA8A90A48DBBA1BEAA081D405AB377A757493E4E9F7`：c19 main.ts E1BAAA59、dist/main.js 4541E89F，typecheck/build exit0，其它desktop文件精确，packaged_electron/installer均NOT_RUN。REL02直接回读c19两文件哈希匹配。当前c19有desktop及renderer dist，但无REL02 packaging/windows或stage脚本；REL02唯一作者候选有打包文件，却无这些dist。`README.md` 更新为同一候选根全文件/批准清单要求，不能跨两个工作树拼接声称Release预检通过，当前SHA见本条前一行命令回读。仍无sidecar exe、正式媒体许可/工具缓存和实包读回，不执行builder/安装。
本次README最终SHA256 21F15FC7DEA9FF7927FD66B674A004EDBBF9D8CC195F15FB6223208FEBF7F2EE。

## REL02 98项精确来源清单与桌面测试产物拒绝门

回应MGR04同根暂存准备，REL02新建外置只读 provenance `C:/Users/Administrator/Documents/AIVORA/management/manager-handoffs/rel02-source-inventory-20260928.json`，最终SHA256 `8C5F8801EFEA48C08FF3B44B447320EBC3F0FD4235C44D0704EA9723EE4C7772`（早期0FA8版已失效）。它列唯一作者REL02文件16件逐路径/SHA/bytes、c19 desktop dist57件与renderer dist25件逐路径/暂存目标/SHA/bytes、c19当前main/preload/index及author build-contracts/media-lock/LICENSE/NOTICE引用、未闭依赖。98件复算0漂，状态PROVENANCE_ONLY_NO_CROSS_ROOT_RELEASE_PASS，无文件复制/Release预检/构建。当前desktop dist中18个.test.js及proposal-run-test-fixture.js；REL02 stage脚本新增拒desktop .test/.spec和*-test-fixture JS/CJS/MJS，SHA `D47FBC188CCD77967BB0DD2B2ACFD263D5A241B1A5F44355CFA2C67BAA35D079`，PS AST0，样本拒绝/允许表达式结果符合预期。README SHA `45C375D3CAA54DA39CF62ABA5F9E4B8A4D35FF84147457D2304A67F8490B2756` 记需DEV07独立发行干净dist；现c19 QA/开发dist不能直接入包。原有QA文件不删。仍缺同根、contracts runtime、sidecar exe、可发行媒体/许可、Electron smoke、builder/NSIS缓存、升级备份钩子与实包QA。

## DEV07 Release desktop 构建输入冻结与QA03取件

REL02回读MGR04 `release-snapshots/20260928-dev07-release-desktop-config-1/SNAPSHOT.json` SHA `8F8CD22912410E0A3AF414A0AC3651B0EB1E7C3DE9199EE2818F55A972CEF8BA`，同目录tsconfig.release.json SHA `78A912423D648016FED26B823D2C182E42A97F6A459745D2AAFCE4435EAA9062`、SOURCE.json SHA `5EDB58F5841731B5DFC1679C14BA623810809A86C62DBD43A4D6BB87F00CC27A`，状态 INPUT_FROZEN_NOT_BUILT。配置仅显式main/preload入口、include=[]、排除test/spec与proposal-run-test-fixture，noEmitOnError=true、fresh外置相对outDir；SOURCE列57 desktop TS+3 contracts TS+8依赖。已交QA03按MGR02窗口从冻结目录取件重哈希、独立构建、核完整emit/无测试模块；提醒配置复制到QA目录后outDir随配置位置移动，SOURCE记录的作者output_dir不能当实际QA输出。此门未build/未c19 dist覆盖、非Electron/安装验收。REL02 provenance清单当前SHA `B8092F330385EC07A0EBF298DFFDF96170EA16A7549E16E6FAA4A2C9A4133ACA`，16+57+25共98件SHA/bytes重核0漂。

## QA03 Release desktop一次性包预执行只读核

`release-desktop-gate-v1/RUN-PACKET.json` SHA `2E7D28B7DE04BC8FEA355354ED122DB09614D7D352617E65FAD86D038D1D08D9`、`run-once.cjs` SHA `DC03851FBEC1A174E2F2500BE8FB6AF57CB3D535964B619BD0D33E3AF11B5E40` 与冻结config78A912/SOURCE5EDB58吻合；REL02执行 Node `--check` runner exit0，QA dist、RUN-STARTED、RECEIPT 均不存在。runner将前核68输入/HEAD/status/node/tsc/fresh outDir，后核main/preload/完整emit闭包/无test/spec/fixture与c19不漂；REL02未发现需在本次隔离tsc前另加的打包条件。待MGR02单签、未运行构建；后续同根发行预检、packaged Electron和安装仍独立。

## Release desktop隔离构建PASS与38件冻结取件

QA03 `release-desktop-gate-v1/RECEIPT.json` 实体SHA `E2B3B93A22AFCFC7FDAA1E0142322FE754B0A2E41D68D0E289542592CA7EEB9B`：受单签一次tsc exit0，38 JS/405973 bytes，TS runtime closure38、相对导入64、无test/spec/fixture；main4541E89F、preload949A91F3，68输入和c19 status/旧dist未漂，raw stdout SHA4719806C...、stderr空SHAE3B0...。REL02逐件复核外置dist 38项SHA/bytes 0漂，生成只读拟 `app/dist/` 映射 `rel02-release-desktop-qa-output-20260928.json` SHA `6BF209D835E777396FF4E245AF746E8BF84D2714CFFD2FEA8ADF82B6204A6309`，与QA回执38/38匹配。MGR04随后冻结 `release-snapshots/20260928-release-desktop-runtime-38-1/FILES.json` SHA `227375AE5ED3AB42BD40BDDFD0694EDCE0B654C89B9D999399A68655BA9E369D`，REL02复核冻结副本38/38哈希/字节无漂。它仅是desktop runtime取件输入，非同根发行暂存/实包。README当前SHA `8BF9C9EEF3A69B7B96CBC716B96BF9A976A4305C4AF9A491CC1E5B6EB3C82499`；来源清单因README与冻结指针更新为SHA `EFFE3A910D1C74A6B3DA51D60CCB0DF3869AAA691368C99E5F06BBAD89716F90`，旧B809版失效，98旧来源项SHA/bytes重核0漂。仍缺contracts runtime/Electron加载烟测、sidecar exe、发行媒体/许可、工具缓存、升级前备份钩子与安装QA。

## 2026-09-28 FFmpeg/FFprobe 开发输入与发行材料只读复核

本机 WinGet Links 解析到同一 `ffmpeg-8.1.2-full_build/bin`：ffmpeg.exe 242496512 bytes、SHA256 `AD8F211BC894755E0061C55AB280AE00E8D3D4F15A8CC4372B24CFA247B5942E`；ffprobe.exe 242291712 bytes、SHA256 `9DF3B0B5275E830961DF6D94E1F7A71121A7ABD5FF708E9FEC8A0B6084A55015`。均与唯一仓库锁 profile 一致。`ffmpeg -version` 为 8.1.2-full_build-www.gyan.dev，启用 `--enable-gpl --enable-version3 --enable-static --enable-libx264 --enable-libx265`。包内 `LICENSE` 35147 bytes、SHA256 `8CEB4B9EE5ADEDDE47B31E975C1D90C73AD27B6B165A1DCD80C7C545EB65B903`；`README.txt` 45280 bytes、SHA256 `09124E0F7C3D43D9054C62726A176371E8B99960732F51DDD68C6AE68982F434`，写 License: GPL v3、源码 commit `38b88335f9`。递归扫描本机该包仅找到 LICENSE/README.txt，未找到 NOTICE/COPYING；未核到该静态构建逐项对应的外部库源码、补丁、许可与分发方案。

仓库 `config/media-toolchain-lock.json` 唯一 profile 明确 `GPL-3.0-or-later`、`DEVELOPMENT_ONLY`；`services/api/src/aijian_api/media_toolchain.py` schema 仅接受 DEVELOPMENT_ONLY/RELEASE_REVIEW_REQUIRED，且 GPL/NONFREE 仅允许 DEVELOPMENT_ONLY；REL02 `scripts/release-preflight-windows.ps1` 则要求 RELEASE_APPROVED。仅改 release manifest 标签或锁文本不成立，需媒体契约 owner/许可证负责人协调真实发行状态。现有 `timeline_export.py:281` 用 libx264；`fake_media_package.py`、`media_proxy.py` 用 libvpx-vp9/libopus。FFmpeg 官方 legal/general 文档说明启用 GPL 组件会使 FFmpeg 适用 GPL、x264/x265 需 GPL；对 AIVORA 交付范围的法律判断留许可证负责人。来源：https://ffmpeg.org/legal.html ; https://ffmpeg.org/general.html 。

MGR04 82/70/12 只读包的媒体四项仍缺或未批准：发行 ffmpeg、ffprobe、LICENSE、NOTICE。现有 WinGet 字节和 LICENSE 仅是开发来源事实，不能把媒体 4 项从缺口移到已核准；MLT/Shotcut TEST-only 下载审批与此四项独立。当前只读核查无需新工具。若选择新增发行媒体工具，先固定发行路线、供应方与准确 URL、版本、供应方校验值/签名、预期本地 SHA、编码能力、许可和对应源码/NOTICE 内容及签署，再提交一次包含来源/版本/哈希/用途/动作的最小下载或构建授权；未选源前不填造哈希，不下载、不安装、不复制、不暂存。

## 2026-09-28 contracts runtime 冻结输入只读映射

MGR04 `release-snapshots/20260928-contracts-runtime-source-gate-1/INPUTS.json` SHA256 `04312C1B9BD087018FC608757CCD1CCD68CD8E6107CD1622F9788E8730C0B4BF`，`QA-HANDOFF.json` SHA256 `A07266F80E4935B3E477C61AAC5B062F0D78E40B216812BDFF2C838D5E305217`；状态 `SOURCE_FROZEN_RUNTIME_OUTPUT_MISSING_SMOKE_NOT_RUN`。本次核 `runtime-output` 不存在。预期七件 package.json/generated.js/generated.d.ts/artifact-proposal.js/artifact-proposal.d.ts/invalidation-operation.js/invalidation-operation.d.ts 与 REL02 `release-inputs.template.json` 和 `runtime-layout.json` 七个 `app/node_modules/@aijian/contracts/` 目标逐项吻合。暂存脚本还要求包名 `@aijian/contracts`、`type=module`、版本等于桌面依赖，并须精确 CJS/ESM 加载及 Electron smoke receipt（含候选 HEAD、Electron 版本、desktop main 与 contracts 哈希）；这些均未因静态映射而通过。82/70/12 只读封套的 contracts 七项仍为 `MISSING_OR_UNAPPROVED`，不存在可填发行 manifest 的七个产物哈希；等 QA03 构建和烟测独立回执后复核，无暂存/打包动作。

## 2026-09-28 standalone sidecar 与 Windows 打包工具只读盘点

已向 DEV07/DEV05 分别索取 packaged 启动合同、Python 冻结入口/依赖闭包/验证门。当前 author 根 `apps/desktop/src/main.ts` packaged Windows 路径运行 `resources/sidecar/aijian-sidecar.exe`，args=[]，cwd=`resources/sidecar`，显式 `AIJIAN_DATA_DIR=<userData>/workspace`、`AIJIAN_RESOURCE_ROOT=<resources>`。`services/api/src/aijian_api/sidecar.py` 的 `if __name__ == '__main__'` 无参数走 run，有参数走 `--backup-workspace`/`--output` 备份命令；开发态用 `.venv/Scripts/python.exe -m aijian_api.sidecar`。`runtime_resources.py` 的 frozen 分支绑定 `sys.executable == <resourceRoot>/sidecar/aijian-sidecar.exe`、lock 在 config、media 在 media，拒 PATH fallback。冻结方式和构建入口尚未固定：REL02 manifest/layout 当前仅接受 exe 一项；如 onedir 带附属文件，须先扩展精确闭包和清单，不能只复制 exe。如 onefile，须核解包/运行和依赖闭包。DEV05/DEV07 下一取件和独立验证回执待其 owner 回复。

本机 `Get-Command` 未找到 electron-builder、makensis、pyinstaller；author/c19 两根 node_modules 均无 electron-builder 包或 .bin；author `.venv` Python 3.12.13、uvicorn 可导入、`PyInstaller` 不可导入，亦无 pyinstaller.exe。本机常规 NSIS 两安装位置、`%LOCALAPPDATA%/electron-builder/Cache`、`%USERPROFILE%/.cache/electron-builder`、Roaming electron-builder 均不存在；npm cache index 未命中 electron-builder-26.17.0、nsis-resources、winCodeSign。Electron 包 `apps/desktop/node_modules/electron/package.json` 版本43.2.0，ZIP 缓存实体 144326439 bytes、SHA256 `EBA5F5088AF40ECB364FE258809C79A5234C6ECE5A75C64722772EBA01B02786`，仅此一项具本机实物。缓存查询范围为上述常见位置，不声称全机不存在任何私有安装。

新增工具一次精确请求沿现有 `packaging/windows/BUILD-TOOL-REQUEST.md` 提案：electron-builder@26.17.0 的固定 npm tarball URL/integrity、唯一 lock 写手；PyInstaller==6.22.3 需定官方 wheel URL/SHA、所有传递依赖与所选 onefile/onedir 方案；builder 隐式的 NSIS/nsis-resources/winCodeSign 须按实际版本/上游 URL/SHA/许可列全。已有 Electron43.2.0 ZIP 可核重用。当前不具 builder/NSIS/PyInstaller 的完整可审输入或 sidecar exe，未下载、安装或构建。媒体发行许可仍是独立门，不停止其他本地取件。

## DEV05 sidecar 冻结入口答复与子进程阻断

DEV05 确认 `services/api/src/aijian_api/sidecar.py` 的 `__main__` 是单 exe 入口：无参数启动 API、stdout 单行握手、stdin 父管道保活；`--backup-workspace <绝对既存workspace> --output <绝对新目录>` 走离线备份。冻结 EXE 需 `console=True` 才可保留 pipe 握手。现 stage 仅收单 exe，优先 onefile；其 Python/DLL 解包到 TEMP `_MEI...`，临时路径权限与清理待 QA。DEV05 正在 owner work/ 准备可审 spec/门槛，目前 spec/工具/EXE/build receipt 均不存在，未能给发行版本/哈希。`runtime_resources.py` 冻结分支绑定 EXE、lock 与 media 位置如上。

新增静态阻断：`fake_agent_executor.py:272` 用 `[sys.executable, '-m', 'aijian_api.fake_agent_subprocess']`；`fake_provider.py:121-123` 用 `sys.executable -m aijian_api.fake_provider_worker`。冻结后的 `sys.executable` 是 sidecar exe，传入 `-m` 会走 sidecar.py 的备份参数解析而非模块子进程；不能把相关 fake 工作流算作已打包可用。需 DEV05 owner 明确发行中是否包含这些流程并修复/受控排除，QA 独立从冻结 EXE 验子进程、握手、HTTP 健康、正常关闭、备份 CLI、TEMP 解包与清理。当前仅静态风险，未有 EXE 运行失败回执。源码核查 SHA：sidecar.py `03B5EE2E3C80BF3550AA918D4825451CAEADD8FF95BEDF20759F50E8C3FBD4F2`、runtime_resources.py `E93FC66B03FB4CF9B2969EC2AF453BCF3DA54C4B2C5E9B7E8D481BC7D72EFA0B`、fake_agent_executor.py `0002DEAE36DE2BF24B5F98AA5CF2FDA30262FAF2434270A5B41A8E1A9002802A`、fake_provider.py `7D70B9C5C98731AC76C2CE596488F1C78E6951C072EF1757DADB02D07B74885C`。

## DEV05 sidecar EXE 静态候选回读

REL02 回读 owner 目录 `work/dev05-sidecar-exe-entry-20260928/` 四件：entry.py SHA `5FDB3282C0E5F213E8BF65DACA2A3A5349402DCA0C10EAEC0FB19D0546FA0DA7`；aijian-sidecar.spec SHA `C9D4AC8617F3D4DDD2269FE0927D48C8A2FA6CB842BB9AB131D369D96D2C458B`；BUILD-NOTES.md SHA `85C256853FABA84CDF429DA2DCEBD1296CC341BA8D23735979481AE090487F12`；SOURCE.json SHA `9911C951030F559BCEF1BD71C312AC62D7F947C4A5FBD71CB093ECCF6CB99F5A`。SOURCE.json 内 15 个源路径实体 SHA 复算 15/15 无漂，entry/spec Python AST parse 2/2；author HEAD `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`，worktree dirty，候选 untracked。

entry.py 精确分发无参 sidecar.run、备份 CLI、`-m aijian_api.fake_agent_subprocess` 和带两路径的 `-m aijian_api.fake_provider_worker`；后者 worker main() 标注 Never 并以 SystemExit 退出，未落入拒绝分支。未知 -m 拒绝码2。spec 对 Windows x64/Python3.12/PyInstaller6.22.3 设门，目标 onefile、console=True、upx=False；产物拟 `aijian-sidecar.exe`，静态符合 REL02 单 exe layout。`PyInstaller` 未安装、EXE 不存在，本次未 import/build/run；动态 fake handler、keyring、uvicorn 隐式依赖、TEMP `_MEI` 清理、握手/HTTP/备份/子进程均待真实 EXE 与独立 QA。SOURCE 15 项并非完整二进制闭包或发行许可清单。下一取件是 MGR04 冻结完整源码与批准 wheel/哈希，受控构建并交 exe/receipt；媒体 profile 仍为 DEVELOPMENT_ONLY。

MGR04 sidecar 静态入口冻结取件：`release-snapshots/20260928-sidecar-exe-static-entry-1/SNAPSHOT.json` 实体 SHA `5BEF3BB0D652C74DFA58FF6EAED871F589FCE614DB76B8FA3C897B0AAFF6F244`；同目录 entry.py/spec/BUILD-NOTES/SOURCE 四件实体 SHA 分别与作者候选 5FDB3282/C9D4AC86/85C25685/9911C951 完全相同，5/5 读回通过。状态 `STATIC_ENTRY_FROZEN_NO_EXE`，快照内无 dist/aijian-sidecar.exe。此冻结仅可供后续受控构建取件，不能填 stage 的 sidecar-runtime hash。

## 2026-09-28 frozen contracts7 + desktop38 Node 加载 smoke 静审封套

MGR04 frozen contracts runtime FILES.json SHA `522E822F6E267BA5161A110D5A64439428D33FD9BBAB189609C96101F732BB4B`，7件302425B；desktop FILES.json SHA `227375AE5ED3AB42BD40BDDFD0694EDCE0B654C89B9D999399A68655BA9E369D`，38件。REL02 回读45/45源文件 SHA+bytes 0漂，四个 desktop consumer 确实 require artifact-proposal/invalidation-operation 两子路径。QA03 `contracts-runtime-gate-v1/FROZEN-INPUT.json` SHA `3E4E48D37523B1625F11099353DD8810B8E91FBD0324AF368A487A6CD663EFF6`；其 Node-only RUN-PACKET SHA `4196F5621980D2DEEC567FFCA97940FE69B1DD0B4D8ED2F6AF9DB34F3234AE0B`、runner SHA `A40884C15C4534CDB7C6DE1B786C29833B91F715014C9DE745CD7676DD3EB2A3`、CJS probe SHA `F35D2DFA2BA11CF8382403C5BB4DE3389A8E7D60113D6B5ADECD48D38BF7562C`、ESM probe SHA `7EE4E5B0A048603BA189976B2D3DE66B98A7DA6A9E3CEEC702E2E4594C311769`；Node --check 三脚本 exit0。QA candidate 不存在，未运行。

REL02 已另备只读静审映射封套 `management/manager-handoffs/rel02-contracts-load-smoke-20260928/RUN-PACKET.json` SHA `2BFDF41A0F779E3499F2D269B47179D8F70D6EB55995C5D0A038B04E5C6280C6` 并交 MGR02。QA03 是唯一执行 owner，需 MGR02 单签、一次 fresh QA candidate：四个 CJS consumer 各独立 require、三个 ESM import，逐例 raw/PID/exit、首 RED 停止并保留未运行。此门是 Node 加载，不执行 Electron；旧 QA runner 中 electron_version 取自 package 元数据，不能作真实 Electron 运行回执，Node-only 结果不能满足 stage 需要的独立 Electron 证据。stage/installer/media 许可门仍未闭。

## MGR02 旧 contracts Node smoke 封套停止裁定

MGR02 已明确：REL02 旧静审封套 SHA `2BFDF41A0F779E3499F2D269B47179D8F70D6EB55995C5D0A038B04E5C6280C6`、QA03 旧 packet SHA `4196F5621980D2DEEC567FFCA97940FE69B1DD0B4D8ED2F6AF9DB34F3234AE0B` **不签、不运行**。DEV07/DEV01 新 CommonJS 构建候选改变模块格式；旧七件 build PASS receipt `107D35C35A835BAE6769B5DCFCC18D7A41E616CCDCEEFCD13D9D07879AA592D9` 仅绑定旧候选，旧包即使将来有 Node PASS/RED 也不能推进最终发行。两包及旧七件快照保留原样，不覆盖、不改标签、不自动重试。待 MGR04 冻结新版唯一作者输入后，由 QA03 另单签 build→CJS/ESM 真加载；Electron/Release stage 仍独立 NOT_RUN。REL02 未执行旧门。

## 2026-09-28 CJS contracts 新源与 REL02 暂存契约

MGR04 新冻结 `20260928-contracts-runtime-cjs-source-gate-2/INPUTS.json` SHA `27B7EB69996B8B52011E3472E4A5FE5BA3C9D0A9778785DD1B4B2FBA1AFA9A4D`，预期 runtime 包 `@aijian/contracts@0.1.0 type:commonjs`、仍七件；源码 package.json 保持 `type:module`，新版构建脚本 SHA `9EE011623897973A56F796AD66CCA7A849801CA04420E428C7EA6FAE78D4E617` 会产生独立 commonjs package。此门尚未构建/加载。REL02 自有 `scripts/stage-windows-runtime.ps1` 将 contracts runtime 元数据断言从 `type=module` 改为 `type=commonjs`，现 SHA `A7112F4FC2BCFA14EAD111D8910662357B8B812DC9E3D99AC1B576D22BD27225`；PowerShell AST 0 错。`packaging/windows/README.md` 改为明确旧 ESM 七件不能复用、新 CJS 七件仍需 CJS/ESM 与实际 Electron 独立验，现 SHA `FCA6C0B0CCF4CEF74ED629C3AE7F6734D7C3A2583E06567C2040E8725ECAC1E8`。未运行 stage。

旧 82/70/12 只读封套固定 stage 脚本 SHA `D47FBC18...` 和来源清单 SHA `EFFE3A91...`，因此对当前 REL02 作者字节已失效；MGR04 需重建封套，不修改旧快照。REL02 新建保留旧清单的并行 provenance `rel02-source-inventory-20260928-cjs.json` SHA `8406A653AC2F1D3078EDFF2498838CF19A2BE9EADF1A81F39E9728D26B230B78`，16 个 REL02-owned 文件当前 SHA/bytes 回读。stage smoke 目前仅核 receipt 的 `result=PASS`、`electron_version` 文本和若干输入哈希，尚不能凭自身证明实际 Electron 进程；独立 QA 门必须给真实 Electron PID/exe/版本/raw 证据，未来 receipt schema 和 stage 校验需协调。旧 Node smoke 已被 MGR02 拒签，不可复用。

## 2026-09-28 新版 CJS contracts 真七件冻结映射

MGR04 `release-snapshots/20260928-contracts-runtime-cjs-seven-1/FILES.json` SHA `6B45D6193436A9E8ED63CB9067AB5306F8653A5F53367B7266B8FC35831C9368`，runtime 七件共303180B。REL02 本机逐件重算 SHA/bytes 7/7 无漂；runtime package.json SHA `2664E7764122BEEE9E35596B8370C0E0F855A970C21DD23460B49462EF0D14CC`，`@aijian/contracts@0.1.0`、`type=commonjs`、三个 exports 同时列 require/import/default；artifact-proposal.js SHA `DCA430DE12DCF6C8C0849110CE8B8991FB9C14A436654CAB52DF2B2ACBDD43DA`，invalidation-operation.js SHA `238A5F831F205B3369A5B277AB935339C03BBAB642DD188B6D1016D3D0FC8466`。与 REL02 当前 stage 的 commonjs 守卫和七个 `app/node_modules/@aijian/contracts/` 目标静态匹配。

新建 REL02 精确来源到暂存目标映射 `management/manager-handoffs/rel02-contracts-cjs-runtime-map-20260928.json` SHA `C10EBA8D165CD4ADC76D8EE03B46B83138A5C86FD27BB5C90FDCC31EEDEDAC36`，7/7 源 SHA+bytes 再核、7个目标唯一；其状态仅 FROZEN_SOURCE_ONLY_NOT_STAGE_APPROVED。旧 ESM7 FILES SHA `522E822F...` 和 build receipt `107D35...` 保留历史，不混用。新版 CJS require/ESM import/validators/d.ts/Electron/stage 均未运行；需 QA03 基于新版七件另签 Node smoke，Electron/正式 stage 独立。

## QA03 新版 CJS7+desktop38 Node 加载一次 PASS 的 REL02 回读

QA03 `contracts-runtime-cjs-smoke-v2/RECEIPT.json` 实体 SHA `136274EB40DBE1D8A8625D4FD2D4325D84D9D5EE89C8A03BA0D60E7195C31D3D`，result `CONTRACTS_CJS_ESM_SMOKE_PASS`、exit_code0，executionRuntime=`Node.js`、electronExecution=`NOT_RUN`、stageExecution=`NOT_RUN`。回执绑定 frozen desktop38 manifest `227375AE...`、新版 CJS contracts7 manifest `6B45D619...`、main.js `4541E89F...`、CJS package.json `2664E776...`；REL02 逐值比对一致。10/10 子进程 code0/未超时/无 spawn error，四 desktop CJS require、三个 ESM import、静态 named import、validator 4x2 正反、TS d.ts 输出核。candidateFiles 48/48 实体 SHA+bytes 回算无漂，各 case stdout/stderr raw SHA 20/20 无漂，QA repo status 前后相同。本次是回读 QA Node 证据，没有 REL02 重跑。

此门可以将新版 contracts **Node CJS/ESM 加载**从 NOT_RUN 更新为 QA03 一次 PASS；不能把 `executionRuntime=Node.js` 改述为 Electron/package/installer/Release stage 通过。REL02 七件 map SHA `C10EBA8D...` 仍为 FROZEN_SOURCE_ONLY_NOT_STAGE_APPROVED；暂存所需实际 Electron 证据、sidecar EXE、媒体发行许可及其余输入仍未闭。

## 2026-09-28 P23 新版 renderer25 冻结取件映射

MGR04 `release-snapshots/20260928-web-p23-preview-renderer-dist-25-1/FILES.json` SHA `07875CD8B2771C64EE9CFF222FD786E8C18A40307491ADE26A2BE101E79B459E`，renderer 25件37254603B；REL02 对快照目录 25/25 源实体 SHA+bytes 重算0漂。新入口资源 `index-CyIvZNT0.js` 存在，旧 `index-V0uKrLD3.js` 不在本次25件中。生成精确 `resources/renderer/` 映射 `management/manager-handoffs/rel02-renderer-p23-runtime-map-20260928.json` SHA `ECDAD0985964F47BFBE96ED5755CF7DB4213FED9E536967ADADFBAB16FF6D4C6`，25/25 源再核0漂、25目标唯一、无旧入口资源。旧 REL02 provenance `rel02-source-inventory-20260928-cjs.json` SHA `8406A653...` 的 c19 renderer tree 是历史快照，不再作为当前新版发行取件；后续同根候选应取新 FILES/map 并重建版本组 stage packet。

QA03 Web receipt SHA `7CE9C71557B70EB12DBBA654258524D4A178A9DA61E2FC52F1CD23A12A6085C1` 只为 typecheck/build 局部门；P23 双 sidecar、媒体实际导入播放、Electron 和 Release stage 均未运行。此 map 为冻结来源，不是发行批准或安装验证。

## 2026-09-28 CJS7+renderer25 只读 stage 封套 v2 回核

MGR04 `release-snapshots/20260928-next-stage-cjs-renderer-readonly-packet-2/PACKET.json` SHA `BF8C9E5C8571E8BB21E6D09C5D415433265F587CF80F48537772DBA68858316E`、`READONLY-CHECK.ps1` SHA `94CCEA53ABF100B834B55914D545436D04FDB3C1B4DA53B6DD6E572D77DD0A99`，PowerShell AST0。封套82目标=77 SOURCE_VERIFIED_CANDIDATE_MISSING+5 MISSING_OR_UNAPPROVED，引用 desktop38/CJS contracts7/P23 renderer25 与 REL02静态7。REL02 静读脚本确认仅 Test-Path/Get-Item/Get-FileHash/Get-Content，未调用 stage/copy/build；执行该**只读** runner 回执 `BLOCKED_NO_STAGE`、available_sources_checked=77、exit2（预期阻断）、stage_started=false；五项精确为 sidecar-runtime、ffmpeg、ffprobe、media-license、media-notice。拟 stage 目标仍未创建。此回执只说明77个来源按封套 SHA/bytes 可核与5项未批准，不等于同根 Release manifest、Electron packaged、媒体许可或安装验收；即使补齐5项仍需正式同根候选/manifest、实际 Electron 证据和版本组授权。旧 packet SHA `80D255...` 保留历史不复用。

## 2026-09-28 sidecar/安装工具/媒体发行门现态只读再核

固定机器状态回执 `management/manager-handoffs/rel02-sidecar-tool-media-readonly-20260928.json` SHA `37E7ED1797DA72661D5FAFF3B1F177A7D579F423CE7FE8A154C1ECF2ACC4BA58`。当前 `pyinstaller`、`electron-builder`、`makensis` 命令均缺；author `.venv` Python3.12.13 SHA `461D6E5F...` 无 PyInstaller 模块/脚本，author node_modules 无 builder；常规 NSIS 与 builder cache 路径缺。Electron43.2.0 ZIP 144326439B SHA `EBA5F508...` 可核，c19 现有 Electron exe 225613824B SHA `8593DB40...`，这些仅本机现态，不等于 builder/NSIS 可用。DEV05 sidecar 静态入口 snapshot SHA `5BEF3BB0...` 仍 NO_EXE。工具提案文档 SHA `4E6AE9C046A23AF64AF7E2E24656F78E404F4A425D8773548EE6FB1B191EB2D5`，不作安装批准。

本机 Gyan 8.1.2 ffmpeg/ffprobe SHA `AD8F211B...`/`9DF3B0B5...` 与 lock SHA `A4554A71...` 相符，profile `GPL-3.0-or-later DEVELOPMENT_ONLY`；本机 LICENSE SHA `8CEB4B9E...`、README SHA `09124E0F...`，NOTICE 无；后端锁 schema 无 RELEASE_APPROVED，REL02 preflight 却要求它。媒体发行文档 SHA `5764469CD51CCFEB6162933F3476E3D946CC7918F72F1477DB0ECFBD0B9C6780`，不表示许可签署。本轮无需下载/安装/付费可推进：独立 sidecar spec/依赖/许可静态闭包审查与构建回执设计；QA 用现有 Electron exe 从外置冻结 desktop38+CJS7 准备单签隔离 Electron 模块加载门（非 packaged app）；媒体/契约 owner 只读确定发行路线和对应源码/NOTICE/状态合同。实际 sidecar exe、媒体发行批准、builder/NSIS 与 Release stage 仍各自阻断。77/5 stage只读封套维持 BLOCKED_NO_STAGE；本轮未动c19、未调用provider、未下载安装或stage。

## 2026-09-28 官方 PyPI 最小 PyInstaller 工具闭包元数据研究

固定研究回执 `management/manager-handoffs/rel02-pyinstaller-wheel-research-20260928.json` SHA `55DA3A05F0D93EC2D75DED611BB13A5E246971443C0910FE04AEC9BE4B2F9930`。仅读取官方 PyPI JSON/npm registry/项目许可页，无 wheel/tarball 下载、安装或执行。PyInstaller 6.22.3 元数据要求 Python >=3.8,<3.16，本机 Python3.12.13 符合；选定 `pyinstaller-6.22.3-py3-none-win_amd64.whl` URL/SHA256 `500bd58c7bf7e584a8435adccbd763a0b918d5c12b08d74ff50fd79b2915458b`。Win32/Python3.12/无 extra 的基础要求六项：altgraph0.17.5、packaging26.2、pefile2024.8.26、pyinstaller-hooks-contrib2026.7、pywin32-ctypes0.2.3、setuptools84.0.0；连 PyInstaller 共7个 wheel，PyPI 公布体积合计2,959,513B。7/7 URL+SHA 再查一致、均未 yanked；本地 packaging26.2/pywin32-ctypes0.2.3 已装但未取得可核 wheel 文件；完整隔离构建仍应以受控 wheelhouse 固定七件。`packaging` marker 校验6/6满足，七件只是工具闭包，不含 AIVORA `uv.lock` 应用运行依赖/许可，也不是完整可构建环境。

官方 PyInstaller 许可页写 GPL2+打包例外，应用依赖许可仍需遵守；hooks-contrib v2026.7 的普通 build hooks GPL-2.0-or-later、runtime hooks Apache-2.0；其余库许可来源/准确 wheel URL/SHA 逐项在回执。后续最小请求可核批准七个精确 URL/SHA 到独立 wheelhouse；同时须另冻应用 runtime wheels，然后离线安装到新 venv、一次受控 build 和 QA。未下载/安装，本地 PyInstaller 仍缺、sidecar EXE 仍 NO_EXE。electron-builder26.17.0 官方 npm metadata tarball/integrity/MIT 已记回执，NSIS/helper 传递包版本/URL/SHA 未固定，继续后排，不触发 builder。来源：https://pypi.org/pypi/pyinstaller/6.22.3/json ; https://pyinstaller.org/en/v6.22.3/license.html ; https://github.com/pyinstaller/pyinstaller-hooks-contrib/blob/v2026.7/LICENSE ; https://registry.npmjs.org/electron-builder/26.17.0 。

## 2026-09-28 最小 sidecar 构建获取申请（仅元数据、未执行）

REL02 与 DEV05 的最新静态候选对齐：DEV05 `SOURCE.json` SHA `CEF345F1112B9B26F80EACEAFE3F4EE6AE68F4A3E4240DD5BC98ED1FA1E1C1F8`，其15个条目逐件回读匹配；`entry.py` SHA `888E9E99BD03221A8E5481158AD5DCA0AB0881003523E656646B628C4AD3F2C5` 已在入口调用 `multiprocessing.freeze_support()`；spec SHA `C9D4AC8617F3D4DDD2269FE0927D48C8A2FA6CB842BB9AB131D369D96D2C458B`。源码另有185个 `.py` 文件，固定在 `rel02-sidecar-source-inventory-20260928.json` SHA `D25721C081715A12837CB02B532A4A75BB5A76F6C3658F3054795F0A9662A274`；107个生成 `.pyc` 排除。作者 checkout 是 dirty，后续构建须按此逐文件哈希冻结并保持 spec 的相对目录，不能直接调用活 checkout。

可执行获取申请 `rel02-minimal-sidecar-build-acquisition-request-20260928.json` SHA `82A7D0AA779A980A129777333733EC114CF8C3D790D1B0235BA885C32647833B`：以 `uv.lock` SHA `FB54B3AD...` 与 `pyproject.toml` SHA `11C9B9DB...` 的生产闭包为准，Windows x64/CPython3.12 共25运行时 wheel +7工具 wheel，共用 `pywin32-ctypes0.2.3` 一件，31件唯一、官方公布体积7,149,210B。31件各列精确版本、官方 wheel URL、发布 SHA/bytes、许可证和来源；25/25 runtime 锁与 PyPI 元数据匹配，均非 yanked。colorama0.4.6 的 BSD-3-Clause、jaraco-classes3.4.0 的 MIT 经上游对应版本 LICENSE 正文再核。扫描本机 uv/pip cache 没有25件中的可逐字节验证 wheel 档案；活作者 venv 仅有22/25匹配已安装分发包，不作离线构建来源复用。七件工具 wheel 也尚未获取和本地哈希。发布 SHA 是元数据，不是文件落地验签。

申请的后续顺序：审批精确31 URL 的单次获取；隔离 wheelhouse 中逐件核 SHA/bytes；以 uv 托管 CPython3.12.13 的基础解释器创建新 venv（解释器 exe SHA `F598FB950A86A895D8F9B4755FC9B38C48ADC7A15732A342E55C17A3C3499602`，其完整分发来源/许可须一并留档），`--offline --no-index --find-links` 安装；冻结源码复核后按 DEV05 spec 在独立 work/dist 执行一次 PyInstaller；留安装、warning、DLL、PE、EXE SHA 回执，交独立干净普通用户 QA 验证启动/退出、Vault、`-m` 双子进程协议、spawn 与 `_MEI` 清理。使用绝对路径，不改系统 PATH。CLI `uv venv`、`uv pip install` 的相关 offline/find-links/python/cache-dir 参数仅只读核过 help，命令并未运行。

本轮没有下载 wheel、没有新 venv/安装/构建/EXE，stage 仍 BLOCKED_NO_STAGE。即使获准获取，也需先补 CPython 分发来源/完整清单与全部 wheel 落地哈希；Electron-builder/NSIS 与媒体发行门另行处理。

## 2026-09-28 CPython3.12.13 基础分发来源补充（只读）

本机 uv 托管 `cpython-3.12-windows-x86_64-none` 是指向 `cpython-3.12.13-windows-x86_64-none` 的 junction；`BUILD` 内容 `20260718`、`python.exe` SHA `F598FB950A86A895D8F9B4755FC9B38C48ADC7A15732A342E55C17A3C3499602`。未找到对应安装 receipt 或原始 tar.gz。REL02 逐件记录本机3413文件、65,199,856B，清单 `rel02-python31213-base-inventory-20260928.json` SHA `B5C475C6259D474A804B50876CA8F9A2C9E3BCAB4751FC6519FCC985B6ED3B38`；本机 `LICENSE.txt` SHA `886A0EAD2D89030EE62DBFF52B04E47AB91998341295BB9C56FB952B4E081C7A`。这是当前安装树指纹，不能证明等同某官方归档，且目录可能含可变文件。

官方 `python-build-standalone` 20260718 发布页及 GitHub release API 同时列 Windows x64 CPython3.12.13 两个 install-only 候选：stripped tar.gz 21,932,298B、SHA `0d422a1439ec308e03f47df551bc30f5994727c456e414b026d202bcda9b7c1c`；未 stripped tar.gz 46,136,591B、SHA `56c9dd9681c4810cb8bfdec277ee2606d8ab17e678e5bc2bd138eb8098e330b6`。uv 官方文档称其托管 CPython 来自 python-build-standalone 且通常剥离调试符号；本机 `BUILD` 与发布日一致，但没有归档 bytes/receipt，故无法断言本机使用哪一种。`rel02-python31213-base-provenance-supplement-20260928.json` SHA `F9818613A105AC3FDDB566690CCBF6A75E9322FB07EDA068AE0340F19DD0D59B` 给出精确官方 URL/大小/SHA，建议把更小的 stripped 包作为同次获取申请增加的一件，后续从该归档离线解压并用其解释器建 venv；此建议不声称与现有安装树逐字节一致。获取后需核 SHA/PE/版本与归档中的全部许可文本，再构建/发行。未下载、安装或构建。来源：https://github.com/astral-sh/python-build-standalone/releases/tag/20260718 ; https://api.github.com/repos/astral-sh/python-build-standalone/releases/tags/20260718 ; https://docs.astral.sh/uv/concepts/python-versions/ ; https://github.com/astral-sh/python-build-standalone/blob/main/docs/running.rst 。

## 2026-09-28 单次32件 sidecar 最小获取申请定稿（仍未执行）

以 `rel02-minimal-sidecar-build-acquisition-request-20260928-v2.json` SHA `490B20DF6734A969ABF47ECB45B4FDBC68DF91B64B47DDB67B118CDBD36CC223` 作为唯一待审获取申请：31个 PyPI wheel 7,149,210B + 官方 python-build-standalone `cpython-3.12.13+20260718-x86_64-pc-windows-msvc-install_only_stripped.tar.gz` 21,932,298B，合计32件29,081,508B。归档官方 release API 发布 SHA `0d422a1439ec308e03f47df551bc30f5994727c456e414b026d202bcda9b7c1c`；申请记录精确 URL、SHA、bytes、许可边界及隔离 `python-archive`/`python-base` 目录。PyInstaller 等31件 wheel 无变化，31名唯一、31 SHA格式/官方域及体积重新检查。旧31-only申请 SHA `82A7D0AA...` 仅作历史，不可单独执行。

离线顺序明确先对全部32件落地验 SHA/bytes，再审 tar 成员并隔离解压。创建 venv 前，须为新解压 Python 逐文件作完整清单、核 Python3.12.13/PE x64、核所有包内 LICENSE/NOTICE，再复核185个源码 `.py` 和 DEV05 SOURCE.json 15条哈希。`install_only_stripped` 官方文档说明归档顶层为 `python/`，且不含 full archive 的 `PYTHON.json`；故不能用本机 LICENSE.txt 代替新归档许可审查，也不能声称完整第三方许可表达式已在本次只读阶段核毕。随后仅从新解压 Python 以绝对路径新建隔离 venv，offline/no-index 安装31 wheel，最后按 frozen spec 构建。全部均为计划命令，没有下载、解压、安装、构建或 stage。

## 2026-09-28 32件落地与Python进程双视图条件停止

用户授权隔离构建后，REL02作为 `tool-review/sidecar-py312-win-x64-1` 获取阶段唯一写者，在该新根按v2申请逐件取得31 wheel+1 Python归档，32/32 文件名/bytes/SHA复核，合计29,081,508B；`acquisition-receipt.json` SHA `7FC29A7C570A32519429B26A240AD82AD3037D0AEFF862C8A68D44282885E464`。tar 3318成员拒绝越界、链接、重复与特殊类型，成员回执 SHA `F62C002E2C79775D84C7AD72622424C87106D8BCD71E9F25F7B95D10401FB9DC`；隔离解压后 Python3.12.13/PE x64，3318文件清单 SHA `202F2DAB56F82C3ACB7A46E3D92C2F54C28A8BCF40151E49ACE60A413FC3CF28`。在Python进程中，解压文件3318/3318与归档流哈希一致。31 wheel内嵌许可文件51份回执 SHA `CF8266C435E1846A49CDE6FF44C362F60B96E7D9AD943B200B4DF80F013A3373`，基底许可证文件44份回执 SHA `93B6E3FDBDEC09991F67F900325F8E6B894C9075223EAF4B4FE7FB47A0C8B1D8`；这不是独立发行许可签署。185 `.py` + DEV05 SOURCE 15条（有重合）在作者源和隔离冻结副本双边核对后为194唯一文件，`source-freeze-receipt.json` SHA `7376390D93A9BF55E155C160480D6C83CFBCBB5D8EB3752FC3103C1FAA5CAB86`。entry `888E...`/spec `C9D4...` 匹配。

首次解压清单脚本误把 uv 安装目录的 `BUILD` 标记视作上游归档文件，保留原始错误 `logs/extract-first-attempt-error.txt`，成员清单证实tar无此文件；仅回读原解压内容后PASS。wheel许可清单脚本首次误将 setuptools vendor 嵌套 METADATA 算作顶层，原始错误 `logs/wheel-license-first-attempt-error.txt` 已保留，按顶层深度修复后31件均有许可文本。

MGR04 独立只读发现进程双视图后，REL02复核：PowerShell `Get-FileHash` 读3318基底文件有1062个 `.py` SHA与Python清单不同，`powershell-base-view.json` SHA `00047B90E2D9A2C84D56B56CDD8C64EEDEEA2E87F094D75F6089EC46CB26A1EF`；由新解压 Python `-I -B` 读同3318基底及194冻结源码均0失配，`python-process-view.json` SHA `7D4909630E8BA6788A37AFCF794719BE8F83E1E9E890C5DEEAE04E9CD60B3703`。疑似E-SafeNet进程相关保护视图，既不以PS视图判归档损坏，也不以Python视图称实际uv/PyInstaller可用。最新状态 `REL02-STATUS-LATEST.json` SHA `15FF682C7937CC8FCC69AA10D593BC75D0DA28146C163263CACF4DCF69413FC4` 覆盖早期获取门PASS的build-ready解读：获取/冻结完成，但安装与构建条件保持，需MGR02/QA03在实际消费进程视角完成前后字节门。REL02未建venv、未安装、未运行PyInstaller、未产EXE、未动系统PATH或活venv。
