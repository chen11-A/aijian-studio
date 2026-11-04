# AIVORA — Windows x64 installer

## 中文快速使用说明

这是可安装的开发核心版，目标为 Windows 10 及以上的 x64 系统。已通过
Windows 云构建机器的真实安装、桌面启动、剧本保存重开及卸载保留数据检查；
尚未完成普通用户 Windows 10/11 电脑上的完整手工验收，也不是签名正式版。

1. 保存安装器及同包的 `SHA256SUMS`。安装向导可以选择目录、当前用户或所有用户，
   以及开始菜单和桌面快捷方式。默认安装给当前用户。为所有用户安装需要管理员
   权限。不需要关闭杀毒软件或修改系统安全设置。未签名软件可能收到系统提示，
   请自行核对来源和校验值；本说明不要求绕过安全警告。
2. 在开始菜单或桌面打开 AIVORA，进入创作工作台。最后一页可以勾选“启动 AIVORA”。
   首次服务选择可以跳过账号登录，
   先使用本地编辑；也可进入 API 设置。显示登录入口不代表真实 AI 已验收。
3. 新建项目并选择剧集，在“故事/剧本”中编辑场景和正文，点击保存，等待
   “已读回保存版本”。角色、世界、场景及分镜也支持手工文本编辑和保存。
4. 关闭软件后再打开项目，可以继续编辑。工作区位于
   `%APPDATA%\AIVORA\workspace`。备份前先正常退出软件，保留整个
   工作区，不要只复制数据库文件。
5. 本包未附带 FFmpeg/FFprobe 命令行工具。未配置经过校验的工具时，素材原件
   可以导入并尝试播放，但音视频探测、连续预览生成及 MP4 编码不可用。新的
   本机工具选择入口仅接受明确锁定的工具版本和哈希；Windows 实机媒体验收
   仍在进行中，请以同包验收记录为准。“字节已校验”不等于已成为可剪辑输入。
6. 安装到已经有 AIVORA 的目录会就地升级程序文件。登录和作品留在
   `%APPDATA%\AIVORA`。第一次打开会从旧的 `%APPDATA%\AIVORA Dev Core` 复制一份，旧目录保留。安装程序不会删除这两个目录。目录里如果是别的
   文件，安装会停下来。卸载仅移除已记录的软件文件，保留工作区和未知的用户
   新增文件。

完整媒体制作、真实 AI、升级恢复和正式发布检查仍在继续，不能将本包当作
完整首发产品。后面的英文说明列出构建证据和边界；组件许可证保持原文。

This unsigned build is a limited desktop installer, not a completed
media-production release. The displayed name is AIVORA. Packaged Windows builds
use `%APPDATA%\AIVORA`. The first launch copies an existing
`%APPDATA%\AIVORA Dev Core` folder and does not delete it.

## Operating-system prerequisite

This profile requires Windows 10 or later, x64, consistent with the
[exact Electron 43.2.0 platform boundary](https://github.com/electron/electron/blob/v43.2.0/README.md#platform-support).
The installer fails closed when the Windows major-version registry value is
missing or below 10; the frozen development sidecar checks the runtime OS too.
Neither check establishes support for every Windows build or edition.

Windows supplies the Universal CRT. Microsoft's
[UCRT deployment guidance](https://learn.microsoft.com/en-us/cpp/windows/universal-crt-deployment?view=msvc-170#local-deployment)
states that Windows 10/11 use the system UCRT even when an application-local copy
exists. Pinned PyInstaller 6.22.3 `depend/dylib.py` describes the same boundary.
The development-only freeze therefore omits only the 43 reviewed UCRT/API-set
names in `system-ucrt-inputs.json`, after checking their actual source is the
Windows system directory or an x64 Windows SDK UCRT directory. A new name or
unclassified origin aborts; VCRuntime and all other dependencies remain subject
to the exact-input distribution check.

The frozen receipt records every native input origin/hash and each omitted
file's PE version/hash. The installed smoke checks the real sidecar's loaded
`ucrtbase.dll` resolves to Windows System32 and records its version/hash and OS
build. This is checked execution evidence, not a redistribution permission for
Microsoft files. No OS runtime is downloaded or installed by this installer.

## Available scope

- Local projects, episodes, text-source import, editable scripts and manual
  creative/storyboard records, with local persistence
- Original media byte import and supported source playback, without treating an
  unprobed audio/video file as validated editing input
- Existing original interface layout, with neutral build-only placeholders for
  reference artwork whose redistribution provenance is unresolved

## Explicit limitations

- FFmpeg/FFprobe command-line tools are not included. Without an explicitly
  selected, exact-version/hash-verified external pair, media probing, saved
  composition rendering and DRAFT MP4 export are unavailable. This candidate
  adds fail-closed machine-local selection; actual Windows media acceptance
  is pending and must be checked against its own evidence receipt. The bundled
  full-media installer is still incomplete. External tools are neither installed
  nor silently downloaded by the app or included in its artifact.
- Real AI sign-in/inference is not established by this build or its synthetic CI
  smoke. No account, credential, provider configuration or user workspace is
  bundled. Real authorization and any provider costs remain user decisions.
- No signing certificate is used. Windows may warn about unsigned software;
  do not disable security protections to install it.
- Installing into an existing AIVORA directory replaces program files in place.
  A separate backup/restore helper is not implemented or claimed. The installer
  and uninstaller do not delete `%APPDATA%\AIVORA` or `%APPDATA%\AIVORA Dev Core`. Uninstall preserves
  the user workspace; data cleanup is a separate action.
- Hosted-runner installation and native smoke are bounded engineering evidence,
  not clean standard-user, all-Windows-version or full user-workflow acceptance.

## Provenance and evidence

`DEV-CORE-INPUTS.json` binds one source commit to each staged file SHA. The
installer checksum is in `INSTALL-RESULT.json` and `SHA256SUMS`. The artifact is
uploaded only after Windows sidecar startup/persistence and actual installed
Electron save/reopen checks, a fail-closed reinstallation check and an uninstall
data-preservation check pass. No formal GitHub Release is created.

The app includes available component license texts and explicit dependency-input
inventories under `resources/licenses`. Those inventories must not be described
as a legal opinion or as formal release approval. Formal media release still
requires the original reviewed-source/NOTICE/profile gates. The development
pipeline does not alter them.

The second preparation checkpoint pins the exact Python companion licence texts
and maps native DLL/PYD bytes back to the original verified archives. A complete
mapping is a factual material-hash check, not whole-installer legal approval.
The installer now uses a small first-party NSIS script with core/zlib instructions
and the Simplified Chinese Modern UI 2 pages shipped with NSIS. It does not embed
StdUtils, Nsis7z, UAC or other third-party NSIS resource plug-ins. The exact core
compiler and its supplied COPYING text are pinned; Electron's own supplied licence
texts must also remain intact. The final gate regenerates the script and rechecks
its input-file, installer and licence hashes. Unknown native bytes or missing
material still block binary upload while native build/tests and bounded
non-binary diagnostic evidence can proceed.

The wizard asks for an install directory, per-user or all-users scope, Start Menu
and desktop shortcuts, and offers “启动 AIVORA” on the finish page. A silent
`/S /D=` install uses the requested directory and does not launch the app.
Installation replaces program files when the directory already contains AIVORA
and refuses a directory occupied by unrelated files. Uninstall removes only the
enumerated program files and then empty directories. User-created files not in
that list are retained; the Windows synthetic acceptance specifically verifies
that behavior and workspace retention.

The workflow is restricted to `codex/windows-installer-dev-20261008`, uses the
standard Windows hosted runner with a 35-minute job timeout and one-day artifact
retention, and never uploads tool caches, workspaces, credentials or test profiles.
