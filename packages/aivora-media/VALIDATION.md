# 验证记录

验证日期：2026-11-04（UTC）。分支 `gpt/aivora-media`，基线为最新 main `63c76db96ac64fb3dc960af6bda139aed3a6ec10`；完成前通过 `git ls-remote` 再次确认 main 未变化。未合并其他分支；仅只读参考 `gpt/aivora-qc` 的工具路径注入和无依赖 ESM 结构。仓库目录内未发现 AGENTS.md。

## 环境与依赖

- Node.js 24.19.0、pnpm 11.19.0、Python 3.12.14。
- FFmpeg / ffprobe 7.1.5（Debian，含 libass、libx264、AAC、loudnorm），系统有 Noto CJK 中文字体。
- ESLint 10.8.0、Prettier 3.9.6，沿用仓库配置。
- 默认 pnpm 缓存目录不可写；改用 `/tmp` 的 XDG 缓存与 pnpm store 后，`pnpm install --frozen-lockfile` 成功。仓库 lockfile 只增加空 importer `packages/aivora-media: {}`（及排版空行），没有新依赖或版本变更。

## 有 FFmpeg

```sh
node --test packages/aivora-media/test/*.test.mjs
```

最终完整运行：退出码 **0**，13 个测试通过、0 失败、0 跳过，耗时约 25.3 秒。

| 项目     | 实际验证                                                                                                                                      |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 字幕     | 双画幅、四种样式、16/22 码点行长、标点优先、emoji、时间码进位、排序、ASS 注入防护、非法参数                                                   |
| 烧录     | 本地 lavfi 合成视频，双画幅 1080×1920 / 1920×1080，ffprobe 确认 H.264 + AAC，真实像素确认字幕出现且竖屏下方 20% 无字幕白色像素                |
| 音量     | 两遍处理后重新测量；普通合成音轨双画幅均 −16.00 LUFS / −10.41 dBTP；高峰值素材 −15.73 LUFS / −1.23 dBTP；检查关闭开关、缺失音轨、静音轨       |
| 封面     | 两张 JPG 的编码/尺寸、标题白色像素、右下角标记、关闭标记产生不同像素、越界时间拒绝                                                            |
| 字卡     | 两种画幅 × 淡入淡出开/关，时长 2 秒，首/中/尾帧像素亮度证明淡入淡出及标题显示                                                                 |
| 归档     | 中文、空格、单引号临时路径；JSON、素材、成片字节往返；拒绝覆盖、源符号链接、输出位于项目内                                                    |
| 恶意 ZIP | 拒绝 `..`、绝对路径、Windows 路径、反斜杠、空/点路径段、符号链接、大小写重复名、非法 project.json、CRC 损坏及伪造超限大小；失败不留下恢复目录 |
| 工具注入 | 使用含中文空格的 ffmpeg / ffprobe 符号链接执行真实导出；缺失工具给出 ENOENT                                                                   |

所有测试媒体仅由 FFmpeg lavfi 本地合成。归档单元测试中的 `.mp4` 为用于字节保真验证的几个测试字节，不作为媒体输入。没有下载素材，没有使用真实项目数据。

## 无 FFmpeg / ffprobe

```sh
FFMPEG_PATH=/missing/ffmpeg FFPROBE_PATH=/missing/ffprobe \
  node --test packages/aivora-media/test/*.test.mjs
```

最终运行：退出码 **0**，总计 13 个测试，7 通过、6 媒体测试跳过、0 失败，约 1.1 秒。未卸载系统 FFmpeg；通过显式传入不存在的两个可执行文件路径模拟缺失环境。字幕、归档、安全测试仍实际执行。测试仅将 ENOENT 视为工具缺失，不会掩盖已安装工具的运行错误。

## 格式与静态检查

```sh
node_modules/.bin/eslint packages/aivora-media
node_modules/.bin/prettier --check packages/aivora-media
git diff --check
```

均实际执行并通过，退出码 **0**。检查范围为新增模块与 Git 差异；没有宣称运行全仓库应用测试。Prettier / ESLint 覆盖其支持的 JS、JSON、Markdown 文件；Python ZIP helper 通过实际归档测试验证，不在这两项工具的支持范围内。

## 已修复问题与已知边界

首轮测试发现静音的 loudnorm 字符串 `-inf` 不能直接用 `Number` 判断，已修复并加入静音真实导出测试。封面像素测试最初对静态 JPEG 做时间 seek 导致读不到帧，已修正测试读取方式，最终全量重跑通过。

这是独立 Node.js 模块，没有 UI、CLI 或 apps 接入。ZIP 使用可注入 Python 运行时；仅归档项目目录内文件，不解析或改写外部素材引用。恢复不支持加密/特殊压缩 ZIP，并要求目标目录不存在。全静音不会人为生成声音；极端音频若编码后不满足响度/峰值要求会拒绝发布。测试在 Linux 上执行，未验证 Windows 原生路径与可执行文件行为；工具路径参数和归档文件名的中文空格场景已在 Linux 上验证。字体需要调用环境提供。更多限制与失败语义见 README。
