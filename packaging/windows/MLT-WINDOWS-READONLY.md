# MLT Windows 运行与打包依赖只读调查

状态：2026-09-28。只读本机、仓库及 MLT 官方源码/文档；未下载、解包、安装、编译、运行 MLT，也未复制 Shotcut 或开发版 FFmpeg。本文是 TEST 工程选型输入，不是可发行运行时清单。

## 本机与产品现状

- `Get-Command melt,mlt,shotcut` 无结果；`C:/Program Files/Shotcut`、`MLT`、`melt` 标准路径均不存在。未做全盘搜索，故结论限于 PATH 与这些路径。`cmake`、`ninja`、`cl`、`vcpkg` 当前 PATH 均无结果；本机有 Git。
- 首次调查时本候选尚无 MLT 调用点；现回读 `services/api/src/aijian_api/mlt_execution_adapter.py` 与 `mlt_execution_worker.py` 已有隔离合成 TEST 的适配器和 subprocess runner。`MltEngineeringRuntime` 明确标为 `ENGINEERING_TEST_ONLY`，要求固定安装根、melt/module 目录及全树文件 SHA；当前没有 MLT Windows 二进制、已通过的服务查询或产品发行入口，不能将这些源码视为可执行运行时或安装器输入。
- 现有 WinGet `ffmpeg.exe`/`ffprobe.exe` 是 8.1.2 Gyan full、GPL `DEVELOPMENT_ONLY` CLI；它不能替代 MLT `avformat` 模块链接所需的匹配 FFmpeg 开发库/DLL，也不能进入发行包。

## 官方可固定来源

MLT 官方 GitHub `v7.40.0` release 仅有 `mlt-7.40.0.tar.gz` 源码资产，大小 **6,775,875 bytes**，GitHub API 的 asset digest 为 `sha256:f11c30e21670f62a3dfc56a31306ac02f3feea00908a2821a4a0bf3e989d3d6a`，URL `https://github.com/mltframework/mlt/releases/download/v7.40.0/mlt-7.40.0.tar.gz`。该 release 未提供 Windows melt/MLT 二进制；不能把 Shotcut 全包冒作 MLT 发行 runtime。源码 tag/commit、资产 digest 和编译依赖都需在获准获取后复核。官方旧版 [Windows build 文档](https://www.mltframework.org/docs/windowsbuild/) 自标过时，不能当作 v7.40 的可复现步骤。

官方 v7.40.0 Windows CI 使用 MSVC、CMake 的 `vcpkg-ninja` preset 和 vcpkg，构建、安装并运行 ctest；没有在 release 附可供本项目直接核 SHA 的 Windows 二进制。其 `vcpkg-configuration.json` 将 registry baseline 固定到 `12dcccadfe573d0eaa6c67a968413ded7805d256`；`vcpkg.json` 直接依赖含 FFmpeg、pthread、libxml2、qtbase、qtsvg、gdk-pixbuf、glib、SDL2、frei0r、libsamplerate、libvorbis、rubberband、OpenCV(contrib) 等。官方 preset 默认打开 `MOD_AVFORMAT`、`MOD_QT6`、`MOD_GDK`、`MOD_FREI0R`、`MOD_PLUSGPL` 等，不能直接视为本产品的最小/许可已核构建。若采用源码构建，必须先冻结实际模块子集及完整传递依赖、工具版本/来源/哈希、构建参数与许可包；MSVC/vcpkg/cmake/ninja 当前未获安装授权。

## TEST 工程与运行时范围

ART04 隔离合成 TEST 的当前执行规格 SHA `4323DFEF3EEF9337BAF49A5118DE1397B4C2AFBE2E67768E133F87C950DDF16D` 已在本次回读匹配，目标为 **125 帧、25/1 fps、5.000 s、1080×1920**：蓝 V1 `[0,75)`、红 V2 `[50,125)`，仅 `[50,75)` 有 25 帧叠化；1000 Hz 非语音提示音分别 `[25,50)` 与 `[75,100)`，220 Hz BGM `[0,125)`，两条字幕随提示音；V1/V2 320×568 到 1080×1920 仅本 TEST 固定 `STRETCH_TO_CANVAS`，填满且白识别条完整；音轨 `gain_millidb=0`，无归一化/限幅/鸭式压低，QA 实测混合峰值及削顶；输出 H.264/AAC MP4。五件合成输入、工程及 MP4 尚未生成，均无实际 SHA。旧规格 SHA `AF56D3870FC6E188AE8C4372EF834A02E94E0EBFD1FA489BDD6BB3E06207550F`、`D687F2118217A46039C80A0F9715FB3DD731D455E5EB9C335BC9E15D25159EA8`、`7D1E494083EF6702E9B17F8A2D923A46E03A763525E2DF3737C33AFC7ED07FE0` 只留历史，依次为对白边界前、增益未定、画布映射未定版。初步会涉及 XML 序列化、core 轨道与混音、`avformat` 解码/编码；字幕若用 `qtext`/`qtblend` 会需要 Qt 模块，若用 `pango` 则需 Windows 构建确实包含它。真实服务名、编码器与依赖以所选构建的 `melt -query`、输出/播放证据为准。

Qt 不能因 Electron UI 而略去：v7.40.0 `src/modules/qt/CMakeLists.txt` 的 Qt6 模块链接 Qt Core、Gui、Xml、SvgWidgets（可选 Core5Compat），并包含 `qtext`、`qtblend` 等实现。相反，`pango` 并非无条件可用：`src/modules/gdk/CMakeLists.txt` 仅在 Pango 与 Fontconfig 均被 CMake 找到时才编译 `producer_pango.c`；v7.40.0 vcpkg manifest 未直接列这两包。因此“改用 pango 就无 Qt”仍是待验证分支。

DEV08 当前适配候选已选择官方 XML `luma` 视觉转场、`mix sum=1` 音频混合、`qtext` 字幕、`avformat` 生产/消费和 `xml` 加载；源到画布的 `STRETCH_TO_CANVAS` 另用每个视频 producer 的 `affine` filter（`transition.distort=1`、全幅 `transition.rect`、`use_normalized=1`）。因此本 TEST 的 Qt 模块、实际 Qt DLL/插件、字体及许可是必核依赖，隔离包服务查询还须核 filter/transition 的 `affine`，不能以 pango 假设代替。具体服务参数和实际可加载性仍待所选 Windows 包 `melt -query`、固定 XML 和渲染结果验证。

预期发行布局须至少逐文件锁 `melt.exe`、MLT framework DLL、启用模块 DLL、与这些模块匹配的 FFmpeg/Qt/其它依赖 DLL、MLT profiles/presets/module data、字体/Qt 插件（若实际用到）、许可证全文、NOTICE、对应源码与构建说明。Windows relocatable build 的官方文档称 `MLT_REPOSITORY` 被忽略；不能仅设该环境变量就断言加载了受控模块目录。每个文件需来源、版本、SHA 与加载路径证据，先做不依赖系统 PATH 的隔离运行，再讨论安装器复制。

## 许可与下一门

[MLT copyright policy](https://www.mltframework.org/docs/copyrightpolicy/)称 framework/libmvcp 为 LGPL-2.1，`melt` 命令及 melted 系列为 GPL-2，模块许可分别判断；[安装文档](https://www.mltframework.org/docs/install/)也标 `qt`、`plusgpl` 等可能含 GPL 依赖/代码。MLT 的 GPL/LGPL 与 FFmpeg/Qt/字体/frei0r/其它 DLL 权利链须按实际构建逐项审，不因进程隔离或只取部分文件就视作已获发行许可。

下一门：QA 生成并锁五件合成素材与工程 SHA，DEV08 固定所需服务和输出规范；版本组据此定 v7.40.0 源码构建范围及 Windows 工具链审批。审批输入最低包括上述官方 tarball URL/大小/SHA、vcpkg baseline、固定模块与完整传递依赖、MSVC/CMake/Ninja/vcpkg 的精确版本/哈希、预计下载及磁盘范围、许可证负责人路径、只解包或安装动作。现在这些工具链的精确版本和依赖体积尚未知，不能把源码包 6.8 MB 冒称完整获取成本。若要先验证可信 Windows MLT 包，需提供其官方来源、文件树、签名/哈希和许可清单；当前本机未找到。

主要官方来源：[v7.40.0 release](https://github.com/mltframework/mlt/releases/tag/v7.40.0)、[Windows CI](https://github.com/mltframework/mlt/blob/v7.40.0/.github/workflows/build-windows-msvc.yml)、[vcpkg manifest](https://github.com/mltframework/mlt/blob/v7.40.0/vcpkg.json)、[CMake preset](https://github.com/mltframework/mlt/blob/v7.40.0/CMakePresets.json)、[MLT 环境变量](https://mltframework.org/doxygen/envvars.html)。

## 一个优先的 Windows 实验获取方案

仅为**隔离合成 TEST 的技术验证**，建议总控审批官方 Shotcut `v26.8.1` **portable ZIP 解包**，先核其中是否有可用 `melt.exe` 与所需模块；若无则停止，不用其 GUI、安装器或整个目录作 AIVORA 运行时。Shotcut [官方下载页](https://shotcut.org/download/)提供 Windows portable ZIP；其 [官方用户指南](https://shotcut.org/stockmedia/Shotcut%20User%20Guide.pdf)明确 Windows 安装目录内可运行 `melt.exe`，但 v26.8.1 ZIP 的实际文件树/MLT 版本与模块必须在验哈希后只读验证，不能从文档推断已具备。只读取得官方 849-byte `sha256sums.txt` 的 ZIP 条目，与下述 GitHub asset digest 完全一致；未获取 ZIP 本身。

| 方案                                    | 固定输入、动作与已知体积                                                                                                                                                                                                                                                                                                                                                                                                                                       | 当前未核项/边界                                                                                                                                                                                                                                                      |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **推荐先试：Shotcut 官方 portable ZIP** | `https://github.com/mltframework/shotcut/releases/download/v26.8.1/shotcut-win64-26.8.1.zip`，GitHub release asset **225,002,077 bytes**，SHA256 `b0148856de01b39add4bf4d6a813bfbc554b4663b65e3ca25cb2589f47555a6a`；同 release 的 `sha256sums.txt` 为 849 bytes、asset SHA256 `0f53aa87ce0221486e042b12b6008d3ce06bde602c5f1746591a0160fb8cad78`。获准后仅下载到隔离审查目录、比对官方校验清单/本地 SHA、解包到独立新目录，不安装、不运行 GUI、不复制进产品。 | 解包后才可核 `melt.exe -version`、`melt -query`、DLL 依赖、FFmpeg 编码器、许可文件、实际 MLT 版本与所需模块。Shotcut 项目本身 GPLv3；仅用于本地技术 TEST 的批准不等于 AIVORA 分发许可或可剥离 runtime。须在无系统 PATH 污染下运行固定 TEST XML，记录所用包文件 SHA。 |
| **后备：官方 MLT v7.40.0 源码构建**     | 上述源码 tarball **6,775,875 bytes**、SHA256 `f11c30e...`；官方 CI 的 MSVC+CMake+Ninja+vcpkg，registry baseline `12dcccadfe573d0eaa6c67a968413ded7805d256`。                                                                                                                                                                                                                                                                                                   | 本机无 CMake/Ninja/MSVC/vcpkg，FFmpeg/Qt 等传递依赖下载量、编译占用和 DLL 许可清单未固定；必须先由 owner 缩减模块、固定工具版本/哈希及缓存/网络范围，再单独审批。源码包大小不是完整获取量。                                                                          |

给总控的**精确首步请求**：在 ART04 最终规格 SHA 确认后，批准只获取上述官方 Shotcut `v26.8.1` ZIP 与 849-byte `sha256sums.txt`，总下载 **225,002,926 bytes**（不含网络协议开销），在独立目录做 SHA 校验和解包，读取 `melt.exe` 版本、`melt -query`、模块/DLL/许可证树；如果内含符合规格的功能，再仅以 ART04/QA 合成输入做 TEST。无新增系统安装、无用户媒体、无 provider、无产品集成、无发行复制。若解包后缺 melt/模块或许可不合适，再回到源码构建审批，不能悄悄换方案。
