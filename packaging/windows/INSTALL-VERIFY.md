# Windows 安装、升级与卸载验证入口

执行者：独立 QA。输入必须是版本组冻结的同一安装包 SHA256、源码/构建映射及操作说明。`scripts/verify-windows-install.ps1` 只读核文件和哈希；实际安装、桌面操作、数据库读回及恢复由 QA 执行并保留原始证据。

## 环境与记录

使用干净 Windows 标准用户账号，无预装 Node、Python、FFmpeg 开发工具；保留系统版本、账号权限、中文用户名/路径、安装包路径及 SHA、运行进程 PID、Electron/sidecar 启停和所有错误。测试 profile 与其他 QA 隔离。安装目录应为 per-user、无需管理员提权。

## 顺序

1. **安装前**：对安装包运行 `verify-windows-install.ps1 -Phase PreInstall`，核哈希及目标目录不存在；记录原始输出。运行由版本组提供的安装器，不使用开发 `electron .`。
2. **安装后**：用 `-Phase PostInstall` 检查程序文件。以 DEV07 新 c19 最小功能包的实际构建 SHA 为输入，核 packaged 主进程的 sidecar 可执行文件、`args`、`cwd` 和 renderer index 均来自安装资源目录；不能用旧 c19 main 或作者未集成源代替。正常启动 AIVORA，同一界面创建或打开受控测试作品，保存并正常关闭、重开；读取项目/来源身份和全文。确认 sidecar 由桌面管理、无假在线状态，程序正常退出后无遗留 sidecar。再以中文目录及标准用户重复必要操作。
   后续 c19 packaged QA 包须从版本组 `release-snapshots/20260928-c19-packaged-resource-root-sync-1/CURRENT-C19-IDENTITY.json`（SHA256 `55F9D528ED97A44258521A95D571BBC6BA39E74B25E767AEF3101C5BC954EDE1`）取当前身份，并在执行前重核源 `main.ts` SHA256 `E1BAAA599BB340BA4F2DEAD8755485B2E55406894E23F29D225EC0690823ABF0` 与 `dist/main.js` SHA256 `4541E89FFC4944ED449FD85F1C01AA6CCF7AEA14C5D53C3593327CDBDA78FB03`。旧 QA03 run-once 脚本固定旧基线，仅作历史证据，不直接复用作同步后的实包 QA。
   对 D/repo30 的媒体执行入口，独立记录本次打包 Electron 的 `process.resourcesPath`、sidecar 子进程收到的 `AIJIAN_RESOURCE_ROOT`、实际 `aijian-sidecar.exe` 路径、sidecar 解析出的 `config/media-toolchain-lock.json` 与 `media/ffmpeg.exe`、`media/ffprobe.exe` 文件 SHA，并与同一安装包清单核对。仅凭 `main.ts` 传参和暂存目录不能证明安装态资源根可读；缺任一读回或发行锁未批准时，不做 D 新 POST/输出认领。记录路径、PID、哈希和失败码，不采集环境中的其它变量或凭据值。
3. **升级前**：先在隔离旧版环境留受控测试数据和独立基线；用 `-Phase PreUpgrade` 核旧程序和原数据目录存在。安装器自身必须在覆盖旧版前备份 `userData/workspace`、校验备份并在失败时中止。QA 观察该执行顺序和失败注入。
4. **升级后**：`-BackupPath` 指向安装器生成的全新备份**目录**，`-ExpectedBackupSha256` 填该目录 `receipt.json` 的预先固定 SHA。用 `-Phase PostUpgrade` 核 receipt 的源 workspace、数据库及所有列名文件的大小/SHA、未列名文件与链接、程序文件及数据目录；在隔离位置恢复备份并读回，再在界面重开原作品，核身份、内容、版本及任务恢复。脚本的逐文件哈希不证明 SQLite 可恢复或跨文件一致。备份失败时应保留旧版与原数据，不得进入覆盖；升级失败则按经审核的回退步骤恢复，不删数据库。
   备份目录与源工作区不得互为父子目录；复核脚本会拒绝两种重叠方向。旧版和新版的工作区绝对路径应分别来自实际 Electron 读回；凭据仅核引用与状态，不读取密钥值。
5. **卸载后**：执行安装器卸载，用 `-Phase PostUninstall` 确认程序文件移除、用户数据目录保留；检查凭据引用未被误删。用户数据清理是另一个明确动作，本验收不执行。

命令模板（路径及 SHA 由当前固定候选填写）：

```powershell
& .\scripts\verify-windows-install.ps1 -Phase PreInstall -InstallerPath <安装包绝对路径> -ExpectedInstallerSha256 <64位哈希> -InstallDirectory <用户安装目录绝对路径> -UserDataDirectory <Electron的userData/workspace绝对路径>
```

脚本返回的 `scope=filesystem-and-hash-only` 是明确边界。QA 另核安装器退出码、界面版本、数据库读回、升级迁移、断网/磁盘不足/素材缺失、数据保全与卸载后的恢复能力。静态脚本通过、暂存目录或截图均不构成 AC01/AC10 或整品验收。
