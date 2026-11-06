# 审核修订验证记录

## 环境与范围

2026-11-04，在 Linux 本机实测；Node.js v24.19.0、pnpm 11.19.0、FFmpeg/ffprobe 7.1.5，使用仓库锁定的 ESLint 10.8.0、Prettier 3.9.6 和根目录配置。修订基线为 `32f1d78aee51c5a79ecf855c3b861d7b84bd76e0`，分支 `gpt/aivora-qc`。

仅修改 `packages/aivora-qc/` 及 `pnpm-lock.yaml`；锁文件只新增 `packages/aivora-qc: {}` importer。没有修改 apps、其他源码或根配置。

## 冻结安装

在无 node_modules 的干净源码副本 `/tmp/aivora-qc-clean-review` 中执行 `pnpm install --frozen-lockfile`，**退出码0，安装成功**，输出：

```text
Scope: all 5 workspace projects
Lockfile is up to date, resolution step is skipped
Packages: +310
Done in 5.7s using pnpm v11.19.0
```

本次通过 `PNPM_HOME`、`XDG_DATA_HOME`、`XDG_CACHE_HOME` 和 `npm_config_cache` 将缓存/存储放入可写的 `/tmp`，解决上次默认目录无法创建的环境问题；未关闭冻结锁文件检查，未忽略安装失败，也未修改依赖版本。没有网络或权限拒绝阻碍最终安装。

## 本模块验收

在同一源码副本中，以安装后的仓库依赖实际执行：

| 命令                                  | 有 FFmpeg            | PATH 无 ffmpeg/ffprobe，且清除 AIVORA_FFMPEG/AIVORA_FFPROBE |
| ------------------------------------- | -------------------- | ----------------------------------------------------------- |
| `eslint packages/aivora-qc`           | 退出0                | 退出0                                                       |
| `prettier --check packages/aivora-qc` | 退出0                | 退出0                                                       |
| `pnpm --dir packages/aivora-qc test`  | 退出0；10通过、0跳过 | 退出0；6通过、4跳过、0失败                                  |

无工具环境通过专用 PATH 目录提供 node、pnpm 和其他系统工具，排除 ffmpeg/ffprobe；生产 API 没有启用任何跳过开关。媒体测试输出 `t.skip` 原因：“未找到 ffmpeg 或 ffprobe，跳过需要本地合成媒体的测试；纯逻辑测试继续运行。”参数、rules、subtitles 和缺工具错误码仍实际运行。

具体回归：

- 显式传入“含空格 和中文”目录中的实际 ffmpeg/ffprobe 可执行文件，完成合成视频检测；CLI 参数覆盖错误环境变量；环境变量路径在 PATH 不提供媒体工具时可用；错误显式路径或错误环境变量均返回 `FFMPEG_NOT_FOUND`。
- 无音轨仅产生一个音频问题 `no_audio`；有音轨但静音仍走 silence/loudness。
- 1080×1920 默认54px字号：15个汉字不报越界，20个报越界；原16:9测试继续通过。
- 普通 message/suggestion 不包含用户列出的专业术语；每条问题含稳定 id、severity、timeLabel、action 和非空 detail；同时间不同字幕条目 ID 不重复。
- 黑屏/静帧/台词覆盖/静音/响度/峰值/重叠、取消、超时、损坏输入仍通过。测试媒体由 lavfi 本地合成，自动清理，无真实素材。

Node 覆盖率实测：行100%、分支93.06%、函数96.43%（模块总计）。`git diff --check` 通过。未在 Windows 主机执行；测试路径已使用 `fileURLToPath`，缺工具跳过逻辑在 Linux 上用隔离 PATH 实测。

## 全仓递归测试：未通过，非 QC 模块失败

`pnpm -r --if-present test` 在有工具和无工具两种环境中均真实执行，**退出码1**。QC 包均正常完成；desktop 为382通过、5失败（4个测试文件），递归命令因失败提前结束，不宣称 studio-web 或全仓检查通过。

最终无工具测试 PATH 保留 uv 和系统命令；Python 虚拟环境已由正常环境的 `uv run` 建立。剩余失败不是缺少 ffmpeg、权限或网络问题：

- `apps/desktop/src/api-client.test.ts`：provider connection 响应未通过既有契约校验。
- `fake-timeline-run-contract.test.ts`、`proposal-run-contract.test.ts`：现有后端 `main.py` 导入不存在的 `ProviderConnectionVersionConflictError`，Python 子进程失败。
- `sidecar-process.test.ts`：真实 Python sidecar 启动失败；另一例期望 `Error`，实际为 `SidecarStartupError`，异常对象断言不匹配。

这些文件不在本次获准修改范围内，未修改。因此用户要求的“无 ffmpeg 时全仓递归测试退出0”尚未达成；已完成本包的跳过修复并保留此阻碍供后续独立处理。

## 1223ad3 之后的小改验证

ID 的起止时间统一为两位小数（原始 time/end 数值精度不变）；silence/no_audio 的 action 改为 add_audio，README 同步解释 true_peak 阻止导出、loudness 仅提示的原因。

新增针对性测试覆盖 `freeze-2.97-4.20`、`black-3.00-3.63`、同一合成视频重复检查 ID 一致、add_audio 动作及严重程度映射。实际执行 `pnpm --dir packages/aivora-qc test`：有 FFmpeg 时11通过、0跳过；无 FFmpeg 时7通过、4跳过；两者均退出0。仓库配置下的 ESLint、Prettier 检查通过。此次未重复全仓测试，上述全仓失败记录仍保留，不宣称已修复。
