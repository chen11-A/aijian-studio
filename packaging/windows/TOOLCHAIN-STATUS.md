# Windows x64 构建环境：2026-10-08 实际进展

这是当前独立重建分支的环境准备记录，补充本目录旧的 2026-09-28 提案。已按用户“安装下载环境，继续执行开发”的要求下载固定工具并安装隔离构建依赖。**没有生成 Windows 安装包，没有在 Windows 执行程序，也没有改变媒体发行许可或资源安全检查。**

## 已完成

| 输入                     | 固定版本                    | 当前证据                                                                     |
| ------------------------ | --------------------------- | ---------------------------------------------------------------------------- |
| Windows CPython x64      | 3.12.13 / Astral 20260807   | 已下载并解压；另保留原始 archive 与 SHA256                                   |
| Windows Node.js x64      | 24.19.0                     | 官方 ZIP，按官方 SHASUMS256 校验                                             |
| pnpm                     | 11.9.0                      | 隔离 npm 包，版本命令通过，与仓库 packageManager 一致                        |
| Electron Windows x64     | 43.2.0                      | 官方 ZIP，SHA 与官方清单及现有 builder 配置一致；PE machine=0x8664           |
| electron-builder         | 26.17.0                     | 隔离安装，npm 完整 lock/integrity；版本命令和现有配置 schema 校验通过        |
| NSIS / resources         | 3.0.4.1 / 3.4.1             | builder 固定的官方工具 archive，SHA 校验通过                                 |
| winCodeSign 工具集       | 2.6.0                       | 仅下载并核 SHA；未调用签名、未使用证书                                       |
| 7-Zip 构建工具           | builder 7zip@1.0.0          | Windows 和 Linux archive 均按 builder 固定 SHA 校验                          |
| Python runtime + freezer | 31 个 Windows 适用 wheel    | 全部从 PyPI 下载、按固定 SHA 校验；含 PyInstaller 6.22.3、hooks 2026.8       |
| FFmpeg / FFprobe         | Gyan 8.1.2 full Windows x64 | 官方 archive SHA 通过；解包后两项 exe SHA 与仓库 DEVELOPMENT_ONLY 锁逐字相同 |

40 项固定 archive/wheel 合计 386,949,852 bytes，不含解压目录和 npm 缓存。位置：`/workspace/shared/aivora-windows-toolchain/`。完整下载来源与哈希保存在 `build-toolchain/downloads.lock.json`，实际只读复核回执是工具缓存中的 `PREREQUISITES-VERIFIED.json`。这些是开发依赖缓存，不是软件交付包。

隔离 npm 依赖位于 `packaging/windows/build-toolchain/node_modules`（Git 忽略）。根目录 `package.json`、`pnpm-lock.yaml`、`uv.lock` 未因这项工作改变。npm 安装使用 `--ignore-scripts`；尚未证明 Windows 上的完整安装器构建可离线完成，不能仅凭 Linux npm 缓存作此承诺。

## 可复现下载与检查

在仓库根目录用 Python 3.12 或以上执行：

```sh
python packaging/windows/prepare-prerequisites.py --cache /absolute/path/to/windows-toolchain
python packaging/windows/prepare-prerequisites.py --cache /absolute/path/to/windows-toolchain --offline
python -m unittest discover -s packaging/windows -p 'test_*.py' -v
```

Windows 的 `--cache` 改为绝对本地路径，例如 `C:\AIVORA-build\toolchain`。工具拒绝目录链接、路径穿越、哈希漂移及不在已固定来源范围内的 URL。`--offline` 只读核现有文件，不回退下载。开发需求或 `uv.lock` 改动会阻断旧缓存清单的构建使用，需重新生成 Windows 依赖清单；不能取消源码锁检查。

Python 运行与冻结依赖由仓库 `uv export --frozen --no-dev --no-emit-project` 的固定依赖，加上 `pyinstaller==6.22.3`，针对 `x86_64-pc-windows-msvc` / Python 3.12.13 解析而来。仅下载 wheel，不在 Linux 编译或运行 Windows 原生扩展。`sidecar-requirements-win-x64.txt` 包含全量哈希；下载清单进一步固定实际选取的 31 个 wheel。Python 自身采用 uv 官方使用的 Astral python-build-standalone，不冒充 python.org 的 3.12.13 Windows 安装器。

## Windows 本机冻结入口

1. 在获授权的 Windows x64 构建机，用已经校验的 CPython archive 解压得到 `python\python.exe`。这不要求管理员、注册表修改或全局 Python 安装。Node ZIP 也可以解压后仅在当前终端设置 PATH。
2. 先执行上述离线复核，再使用该固定解释器运行：

```powershell
& C:\AIVORA-build\python\python.exe .\packaging\windows\freeze-sidecar.py --cache C:\AIVORA-build\toolchain --output C:\AIVORA-build\sidecar-001
& C:\AIVORA-build\python\python.exe .\packaging\windows\smoke-frozen-sidecar.py --resources C:\AIVORA-build\sidecar-001\resources
```

`--output` 必须是仓库外全新目录。冻结脚本在修改文件前拒绝非 Windows x64 或非 Python 3.12.13。它建立隔离 venv，通过 `--no-index --require-hashes --only-binary=:all:` 安装已下载 wheel，执行 `pip check`，然后以 PyInstaller onedir 模式生成：

```text
sidecar-001/
  resources/
    sidecar/aijian-sidecar.exe
    sidecar/_internal/...
    config/media-toolchain-lock.json
  FROZEN-SIDECAR.json
```

保留 console/stdin/stdout，供现有 Electron 认证握手和父进程退出监督使用；不是 windowed 子程序。没有将 Python.exe 改名或伪造 `sys.frozen`，没有修改现有资源根检查。冻结前后核源码哈希，构建中源码变化会失败。sidecar 启动和保存重开测试复用当前临时合成项目的基线检查，不访问真实素材或 provider，不读取真实凭据。

**此刻这些 Windows 步骤未执行。** PyInstaller 不是跨平台冻结器；当前环境为 Linux x64，没有 Windows/Wine 执行环境。Linux 能下载、静态检查与验证哈希，不能证明 Windows DLL 加载、凭据库、sidecar 生命周期、桌面界面或安装/卸载行为。官方说明：[PyInstaller 多平台要求](https://pyinstaller.org/en/stable/usage.html#supporting-multiple-operating-systems)、[electron-builder 多平台构建](https://www.electron.build/v26/docs/features/multi-platform-build/)。

## 安装器与许可边界

独立 builder 重装命令：`npm ci --prefix packaging/windows/build-toolchain --ignore-scripts --no-audit --no-fund`。需先把已校验的 Node 放入当前终端 PATH；不用全局 npm、不用无固定版本的 npx。现有 `electron-builder.v26.json` 已通过实际 26.17.0 schema 校验，但本次没有调用打包、签名或发布。

正式安装输入仍走 `scripts/release-preflight-windows.ps1` → `stage-windows-runtime.ps1` → `verify-windows-stage.ps1`，保留同一候选、完整文件清单与独立 Electron 冒烟要求。全部前置门完成后，才在已核暂存根调用隔离工具的 `electron-builder --config build/electron-builder.json --win nsis --x64 --publish never`。这里不是现在运行 builder 的许可或通过证明。

媒体二进制仍只在开发缓存中：

- FFmpeg SHA256：`ad8f211bc894755e0061c55ab280ae00e8d3d4f15a8cc4372b24cfa247b5942e`
- FFprobe SHA256：`9df3b0b5275e830961df6d94e1f7a71121a7abd5ff708e9fec8a0b6084a55015`
- Gyan README 确认 GPL v3 和源码 commit `38b88335f9`。提供单一 LICENSE/README 不等于全部发行义务已经满足；完整相应源码、外部组件材料、NOTICE 与授权审查仍未完成。冻结脚本不复制 FFmpeg 到 resources/media。

参见 [媒体发行记录](MEDIA-RELEASE.md)、[FFmpeg 官方许可说明](https://ffmpeg.org/legal.html)、[Gyan 官方构建说明](https://www.gyan.dev/ffmpeg/builds/)、[PyInstaller 许可与打包例外](https://pyinstaller.org/en/v6.22.3/license.html)。

当前仍需完成：真实 Windows freeze/smoke；完整桌面生产运行树与 Electron 实测；媒体发行输入审查；安装器覆盖旧版前的一致性备份与故障测试。现有 NSIS 对旧安装/既有用户数据的安全中止未解除。无开发工具的 Windows 标准用户安装、中文路径、重开、升级恢复及卸载数据保留仍按 [INSTALL-VERIFY.md](INSTALL-VERIFY.md) 验证。
