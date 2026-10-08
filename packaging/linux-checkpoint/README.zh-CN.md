# AIVORA 原生桌面检查点

这是 Linux x64 原生桌面开发检查点。启动后会打开 Electron 桌面窗口，自动启动内置 Python 本机服务；无需打开浏览器、安装 Node.js/Python，或启动 Vite 开发服务器。

## 启动

1. 将整个压缩包解压到普通用户可读的本地目录。
2. 在 Linux 图形桌面的终端进入解压目录，执行 `./launch-aivora.sh`。
3. 使用 `./launch-aivora.sh --check` 可检查内置运行环境。该检查只使用临时空工作区，不接触你的作品。

关闭主窗口会同时关闭其本机服务。软件数据保存在用户配置目录下 `AIVORA Checkpoint/workspace`，通常为 `~/.config/AIVORA Checkpoint/workspace`。数据不写入程序目录。备份或迁移作品前，请先正常退出软件。

## 包内内容

- 官方 Electron 43.2.0 Linux x64 运行时
- Python 3.12 解释器、标准库和已锁定的生产依赖
- 编译后的 AIVORA 桌面主进程、preload 和内嵌界面
- 本机后端与媒体工具配置、许可证和逐文件 SHA-256 清单
- 空白初始工作区：不包含现有作品、凭据、测试工作区或本机缓存

## 当前边界

- 这是开发检查点，采用开发入口加载同一套真实桌面程序；不是正式签名安装包，也不是 Windows 安装器。
- 需要兼容的 Linux x64 图形桌面及 Electron 所需系统库。当前构建环境是 Debian 13 / glibc 2.41；未保证其他 Linux 发行版兼容。
- 保留 Electron 沙箱，不使用管理员权限。若系统禁止沙箱所需功能，请使用受支持的普通用户桌面环境，不要添加关闭沙箱的参数。
- 不含 FFmpeg/FFprobe、AI API 密钥或外部供应商配置。普通作品/文本编辑不需要它们；AI 生成、媒体导出及完整制作流程仍须各自验证。
- Windows 仍需单独生成与验证 sidecar.exe、补齐获准发行的媒体工具、固定安装器工具输入，并在 Windows 上测试安装、升级备份和保存重开。
- 本包的 `CHECKPOINT.json` 记录构建来源；`SHA256SUMS` 可通过 `sha256sum -c SHA256SUMS` 核对文件。

## 从源代码重建

在依赖已安装的 Linux x64 源码目录执行：

```sh
.venv/bin/python scripts/package-native-linux-checkpoint.py \
  --out-dir /absolute/path/to/new/AIVORA-linux-x64-checkpoint
```

构建脚本不会下载依赖，不会发布、修改系统权限或复制用户工作区；输出目录必须尚不存在。构建后运行检查命令，再由普通用户在图形桌面验证窗口与保存流程。
