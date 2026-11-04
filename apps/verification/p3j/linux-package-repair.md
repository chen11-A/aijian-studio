# Linux 发布依赖保留期修复（RELEASE-01）

`587eccc46c856fdebaf251a1c25635403d45f0d0` 的双平台 CI 41875853136 成功后，已创建 `aivora-desktop-v0.3.0-phase3j`。Linux 打包运行 41888383265 在下载 FFmpeg 时收到 HTTP 404，尚未执行包内拼接、启动检查或上传。

原因：旧输入是 BtbN 的 2026-10-21 日构建。上游[保留规则](https://github.com/BtbN/FFmpeg-Builds#release-retention-policy)只保留最近 14 个日构建，月末构建保留两年。固定 URL 与 SHA 并不保证该资源一直存在。

改用同一 8.1.3 GPL shared 系列的月末构建：

- [官方固定下载](https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-31-12-59/ffmpeg-n8.1.3-27-g8dca1586f4-linux64-gpl-shared-8.1.tar.xz)
- [官方校验文件](https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-31-12-59/checksums.sha256)
- 实际下载：72,031,160 字节。
- SHA-256：`202fe67679a0860b155817a0907ffcc5c1ea82e186acaa21cb87d307f54fd59a`，与官方文件及发布资产摘要一致。

没有使用浮动 latest、跳过哈希、改变版本识别、取消启动验证或降低测试门槛。新增保留期回归要求官方 HTTPS 固定月末输入，旧配置 1 失败，修复后 1 通过；打包工作流在构建前执行此检查。

本地实际调用 `stage_ffmpeg` 校验并解包后，包内 ffmpeg/ffprobe 启动与版本/功能校验通过；`film-library-ffmpeg.test.ts` 使用这对二进制真实生成并拼接媒体，4 通过、0 跳过。Ruff 检查及格式检查通过，工作流 Prettier 通过。首次 Ruff 调用因默认缓存目录只读未执行，改用现有工作区任务缓存 `/tmp/aivora-uv-cache` 后通过。

证据目录：`/workspace/p3j-final-evidence/` 下 `linux-retention-before.log`、`linux-retention-after.log`、`linux-replacement-ffmpeg.log`、`release-job-126778875591.log`；实际二进制摘要另存 `/workspace/p3j-linux-repair/verified-profile.json`。

现有 3j tag 保留原指向；此修复提交不能冒充已由该 tag 构建。新的完整安装包及对应 CI 尚待执行，不将依赖包摘要写成安装包摘要。
