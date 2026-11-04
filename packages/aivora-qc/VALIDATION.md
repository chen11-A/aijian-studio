# 本次验证记录

- 基线：`origin/main`，`63c76db96ac64fb3dc960af6bda139aed3a6ec10`。
- 环境：Node.js v24.19.0，ffmpeg/ffprobe 7.1.5。
- `node --test --experimental-test-coverage packages/aivora-qc/test/*.test.mjs`：6个测试全部通过，无跳过；包含多组合成 MP4 实测。
- Node 内置覆盖率：行100%，分支91.33%，函数96.43%（模块总计，非整个仓库）。
- 本目录 Prettier 3.6.2 格式检查通过；ESLint 9.39.1 recommended 检查通过。验证工具安装于 `/tmp`，未加入模块依赖或修改仓库锁文件。
- `git diff --check` 通过；新增文件仅位于 `packages/aivora-qc/`。

仓库级 `pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 均尝试执行，但在运行脚本之前被 pnpm 自动依赖安装阻塞：环境无 node_modules，默认存储目录 `/home/agent/.local/share/pnpm` 无法创建（ENOENT）。因此不宣称仓库级门禁通过。未执行会重新生成既有契约文件的 `pnpm contracts:check`，遵守本次不得修改已有文件的范围限制。

测试媒体通过 FFmpeg lavfi 本地生成并在测试完成后清理；没有使用真实素材。测试覆盖正常成片、片头/片尾短黑屏、长黑屏、全黑片尾、静帧、台词覆盖、片头/片尾静音、音轨比视频短、缺音轨、无声的不可用响度、高峰值、SRT布局估算/重叠、无效参数、损坏输入、取消、超时和 CLI。
