# Windows 媒体工具发行输入

状态：2026-09-28 本机只读核查；未批准把媒体二进制放入安装候选。本记录供版本负责人、媒体代码 owner 与许可证负责人选择发行路径，不替代法律审查。

## 已有字节与真实配置

本机 PATH 的 `ffmpeg.exe`、`ffprobe.exe` 是 WinGet Links，目标位于 `Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.1.2-full_build/bin`。两文件 SHA256 分别为 `AD8F211BC894755E0061C55AB280AE00E8D3D4F15A8CC4372B24CFA247B5942E`、`9DF3B0B5275E830961DF6D94E1F7A71121A7ABD5FF708E9FEC8A0B6084A55015`，与仓库 `config/media-toolchain-lock.json` 的唯一 `windows-x86_64-gyan-full-8.1.2-dev` profile 一致。

本机 `ffmpeg -version` 与 `ffprobe -version` 均报 `8.1.2-full_build-www.gyan.dev`、静态构建，配置含 `--enable-gpl --enable-version3 --enable-static --enable-libx264 --enable-libx265` 等；`-L` 报 GPLv3 或更高版本。本机包 `LICENSE` 为 GPLv3，SHA256 `8CEB4B9EE5ADEDDE47B31E975C1D90C73AD27B6B165A1DCD80C7C545EB65B903`；`README.txt` SHA256 `09124E0F7C3D43D9054C62726A176371E8B99960732F51DDD68C6AE68982F434`，指向 FFmpeg 源码 commit `38b88335f9`。本次未核到与每个静态链接外部组件及构建选项逐项对应的完整源码/NOTICE 包。

当前锁标为 `GPL-3.0-or-later`、`DEVELOPMENT_ONLY`。本机文件只限版本经理明确的开发或隔离合成素材技术验证；不复制入暂存目录，不作为正式安装输入。正式发行门必须核真实媒体锁 profile、成对二进制 SHA 和许可材料；改 manifest 标签不放行。

## 与编码功能的关系

`services/api/src/aijian_api/timeline_export.py:279-281` 指定 `libx264` 进行 MP4 视频编码。`fake_media_package.py`、`media_proxy.py` 还使用 `libvpx-vp9` 与 `libopus`。发行 profile 必须由 DEV08/独立 QA 证明实际编码器、容器、分辨率、声音和播放要求；不能只看 FFmpeg 命令存在。使用无 `libx264` 的 LGPL 构建前，须确定替代编码器与代码/输出契约变更；保留 `libx264` 则须评估 GPL 发行义务。

## 待选的发行路径

| 路径 | 必须固定的材料与动作 | 当前缺口 |
| --- | --- | --- |
| 保留适用 GPL 的独立 FFmpeg CLI | 明确分发方式及 GPL 对整个交付的适用范围；获得该二进制精确对应的 FFmpeg 源码、补丁、构建参数、静态链接外部库源码/许可与提供方式；附 GPL 全文、NOTICE、源码取得方式及版本哈希，由许可证负责人签署。 | 当前只有本机 GPL 全文、README 的上游 commit 和二进制哈希；没有完整对应材料及发行签署。仓库锁仍 `DEVELOPMENT_ONLY`。 |
| 使用 LGPL 媒体构建 | 固定不启用 GPL/nonfree 的 FFmpeg/FFprobe 构建、完整配置及成对 SHA；逐项确认外部库许可、对应源码、NOTICE、必要动态链接/替换条件；验证产品所需编码器，协调 DEV08 处理当前 `libx264` 依赖。 | 没有已选构建、可复现来源、编码能力证明或媒体代码变更。构建/下载可能需要新增工具和时间。 |

FFmpeg [官方许可说明](https://ffmpeg.org/legal.html)指出启用 GPL 部分后 FFmpeg 整体适用 GPL，并列出 LGPL 合规核查项；[官方外部库说明](https://ffmpeg.org/general.html)指出 `libx264`、`libx265` 要求启用 GPL。Gyan [Windows 构建页](https://www.gyan.dev/ffmpeg/builds/)说明其提供的预编译包为 64 位静态 GPLv3 构建。以上为来源事实；哪种发行方式满足本产品条件仍需有权负责人审查。

## 一次汇总的授权输入

1. **来源与版本**：选择具体发行路线、二进制或源码提供方、准确版本、下载地址、预期 SHA、构建参数及所需编码器。当前不运行下载或构建命令。确认后可按固定地址下载到独立审查目录，先核供应方签名/校验值，再计算本地 SHA；不得从本机 WinGet 开发安装目录复制替代。
2. **许可包**：获取许可全文、每个启用组件来源与义务、对应源码/构建说明、NOTICE、源码提供方式；由许可证负责人签署适用于 AIVORA per-user Windows 安装的分发边界。现有免费开发工具不等于免费且无义务的发行许可。未查到本次必付金额；具体费用、法务工作量和新增构建工具成本待所选路线确定。
3. **代码与锁**：媒体契约 owner 增加可表示已签署发行 profile 的真实状态和验证，不把 `RELEASE_REVIEW_REQUIRED` 或 `DEVELOPMENT_ONLY` 文本改名即放行；DEV08/QA 验实际编码；REL02 消费冻结的成对二进制和许可证材料、生成包内哈希清单。
4. **工具安装与签名**：如需安装 FFmpeg 构建工具、Python sidecar 冻结工具或 Windows 安装器，先列产品/版本/来源/命令/预期空间与费用，再由总控处理。代码签名证书和对外发布另行决定。本任务未安装、下载、签名或发布。
