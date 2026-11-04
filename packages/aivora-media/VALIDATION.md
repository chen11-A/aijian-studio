# 验证记录（Windows 兼容性修订）

验证日期：2026-11-04 UTC。在用户审核的 `f40d315d7ddbeafa962b35ff3889d2fa4b082d97` 上继续修改 `gpt/aivora-media`。本轮只改 `packages/aivora-media/`，删除 `archive.py`，没有新依赖或锁文件改动，没有改 apps、合并分支或创建 PR。

## 环境

Linux；Node.js 24.19.0、pnpm 11.19.0、FFmpeg/ffprobe 7.1.5、ESLint 10.8.0、Prettier 3.9.6。归档代码及全部测试不再调用 Python、zip/unzip 或其他归档子进程。额外使用系统 `unzip -t` 对生成 ZIP64 包做一次独立互操作校验，该工具不是模块或测试依赖。

## 有 FFmpeg：实际全量结果

```sh
AIVORA_TEST_FONT=/tmp/NotoSansCJKsc-Regular.otf \
  node --test packages/aivora-media/test/*.test.mjs
```

退出码 **0**；17 个测试全部通过、0 失败、0 跳过，耗时约 **25.6 秒**。

- 纯 Node 归档：中文空格目录和文件名、空目录、逐文件 SHA-256 一致、拒绝覆盖、拒绝源符号链接及目的地符号链接。
- 独立小 ZIP fixture 验证普通 STORE / DEFLATE 恢复；模块生成的 ZIP64 包完整往返。
- 恶意包：`../`、绝对路径、盘符、UNC、反斜杠、ADS、Windows 设备名、末尾空格/点、大小写和 Unicode 规范化冲突、符号链接、设备文件、文件/目录冲突、加密标记、CRC 错误、本地头与目录名称不一致、非法 JSON、解压超限、ZIP64 超限字段、非法偏移、错误 descriptor、截断尾记录均被拒绝。失败不发布恢复目录，并清理暂存目录。
- 字幕、双画幅烧录、响度、封面开关、两秒字卡、淡入淡出及中文工具路径原有回归测试全部通过。普通音轨 −16.00 LUFS / −10.41 dBTP；高峰值音轨 −15.73 LUFS / −1.23 dBTP；静音保持静音。

## 超过 1 GiB 的真实流式与内存验证

测试启动独立 Node 子进程，使用 `--max-old-space-size=128`，以 1 MiB 数据块实际写入 **1,152 MiB = 1,207,959,552 字节**素材，不使用稀疏文件或 truncate。随后打包、恢复并流式计算 `project.json` 和素材的 SHA-256，逐文件完全一致。

| 运行                         | 10ms 采样的 RSS 峰值 | 操作系统 maxRSS | 写入、归档、恢复及校验耗时 |
| ---------------------------- | -------------------- | --------------- | -------------------------- |
| 有 FFmpeg 全量测试中的子进程 | 105.2 MiB            | 105.4 MiB       | 5.87 秒                    |
| 无 FFmpeg 全量测试中的子进程 | 104.6 MiB            | 105.3 MiB       | 4.63 秒                    |

测试断言实际文件大于 1 GiB、全部哈希一致、RSS 两项均小于 256 MiB。内存数据只覆盖归档验证子进程，不把 FFmpeg 的内存混入结果。文件内容流式写入/读出，ZIP 使用 STORE，不将全部素材装入 Buffer。ZIP64 避免 32 位大小/偏移截断，并保留 8 GiB 内容上限；本次实际大文件验证为 1.125 GiB，未声称实跑 4 GiB 或 8 GiB 文件。

独立 `unzip -t /tmp/aivora-interop/result.zip` 对模块输出的中文目录、文件和 project.json 检查全部 OK，退出码 0。

## fontsDir 渲染与 Windows 路径

`exportVideo`、`createCovers`、`createTitleCard` 均传入 `fontsDir`。测试将字体复制到含中文、空格、单引号、方括号、逗号、分号和冒号的临时目录；子进程的 `FONTCONFIG_FILE` / `FONTCONFIG_PATH` 指向仅含空字体目录的配置，关闭系统字体发现，不修改机器的全局字体环境。

注意字体发现由 Fontconfig/libass 控制，可执行文件 PATH 不负责字体查找。因此这里使用字体发现隔离和不传 fontsDir 的对照，证明不是系统字体兜底。

| 黑底画面                 | 白色文字像素数（RGB 各通道 >180） |
| ------------------------ | --------------------------------- |
| 不传 fontsDir 的字卡对照 | 0                                 |
| 传 fontsDir 的字卡       | 2,862                             |
| 传 fontsDir 的字幕烧录   | 2,499                             |
| 传 fontsDir 的竖屏封面   | 3,225                             |
| 传 fontsDir 的横屏封面   | 4,670                             |

验证字体为官方 [NotoSansCJKsc-Regular.otf](https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf)，仅下载到 `/tmp` 用于测试，没有提交字体文件。SHA-256：`2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b`。媒体画面/音频全部本地 lavfi 合成，没有下载媒体素材。

`escapeFilterPath` 单测覆盖 `C:\Users\张 三\fonts`、其他盘符、UNC、反斜杠、中文空格、引号与滤镜分隔符，并用独立解析函数验证两层转义还原原路径。Linux 的真实 FFmpeg 测试验证复杂特殊字符目录可加载字体。**这是 Windows 路径语法单测，不是 Windows 实机验证；没有 Windows 执行器，本次没有验证 Windows 原生文件系统、libass 字体提供器或 DLL 环境。** Linux Fontconfig 隔离测试在其他平台会显式跳过。

## 无 FFmpeg / ffprobe

```sh
FFMPEG_PATH=/missing/ffmpeg FFPROBE_PATH=/missing/ffprobe \
  node --test packages/aivora-media/test/*.test.mjs
```

退出码 **0**；17 个测试中 **10 通过、7 媒体测试跳过、0 失败**，约 **4.9 秒**。通过明确注入不存在的两个可执行文件路径模拟未安装，并非卸载系统工具。字幕、路径转义、归档、恶意 ZIP 和 1.125 GiB 流式测试仍真实执行。只有 ENOENT 被视为缺少工具，不会隐藏已安装工具的执行失败。

## 格式与范围检查

```sh
node_modules/.bin/eslint packages/aivora-media
node_modules/.bin/prettier --check packages/aivora-media
git diff --check
```

以上实际执行通过、退出码 **0**；使用仓库配置，范围为模块与 Git 差异，不宣称执行了全仓库应用测试。所有生产代码现在都在 ESLint 支持的 JavaScript 范围内。

## 明确边界

ZIP64 STORE 写入牺牲压缩率换取流式处理与对视频素材的低 CPU 开销；恢复支持 STORE/DEFLATE。最多 10,000 条目、8 GiB 内容、16 MiB 中央目录、16 MiB project.json；不支持分卷、加密、非 ASCII 的旧 CP437 文件名或自定义 ZIP64 扩展尾记录。项目及输出父目录要求调用方控制，避免并发改写；恢复发布不是跨文件事务，强制终止进程可能留下部分目标目录。不会追踪或改写项目目录外的素材引用。详见 README。
