# Integrated Windows 同候选原位重装检查

基线 `3e52afb44d815b4db76ddae155d0e2ff9562c977`，复用已 clean 的 trial QA 工作树，新分支 `codex/aivora-integrated-reinstall-smoke`。不改产品、NSIS 安装/升级/权限算法或旧 media-free 开发检查。真实 Windows 执行尚未发生，不声称安装/重装成功或不同版本 migration 已通过。

## 实际执行链

1. 原 integrated fresh guard 仍拒绝已有安装、AIVORA/旧开发 profile、私有 proof 或 delivery；仍只授权本仓库 Windows CI。使用同一 `AIVORA-Setup-0.3.0-win-x64.exe`、原 `/S /D=`、HKCU/HKLM 检查。
2. 原已安装 Electron 正常沙箱启动，health、固定 bundled FFmpeg/ffprobe SHA、stub 视频/音轨/真实 ffprobe 和截图原门保留。首次真实 createProject、stub createStoryFilm，另通过原 native/API 创建合成来源/集、实际保存非默认 app preferences；读取完整 project/source/episode/settings 数据。不是用静态 getStoryFilmPlan 冒充持久样本。
3. 等 application.close 完成并确认本安装目录 app/sidecar 均退出，才生成数据 snapshot。原生 ID/full raw/设置/输出 SHA 仅在 RUNNER_TEMP 下独立私有 checkpoint，绝不放 evidence/delivery。创建安装目录及 profile 两个未知 sentinel；后者含非文本 bytes。
4. 记录关闭后的 workspace（含 SQLite WAL/shm 若仍真实存在）、films/story-films 所有文件的大小/SHA。原安装器同目录再安装后，要求 installer/exe 身份与全部原用户数据 bytes、未知文件完全相同；不重建 seed，不过滤 savedAt 或 DB 内容差异。
5. 第二次调用受限 verify 模式，必须匹配固定私有位置、checkpoint SHA、candidate head、installer SHA、exe SHA/路径和 profile。真实进程重新 health，并仅 GET 原 project/source/episode/preferences；完整 raw 精确相等、原 stub 视频 SHA/真实 ffprobe 仍通过。此模式不 create/seed/provider。正常启动可能 checkpoint DB，因此“安装前后 bytes”与“重启后完整原生 readback”分开验证，不用运行期 DB 变化冒数据丢失。再次真正关进程后捕获卸载基线，原卸载 app 移除/完整用户数据与两个未知文件保留继续要求。

公开 report 仅固定 PASS/范围/文件 SHA/截图 basename，无 full raw、实际项目 ID、绝对路径、token 或账户设置；私有 proof 有 16MiB 拒绝上限，不截断实际内容。新增结果明确 different_version_migration=NOT_TESTED。原真实 FFmpeg join、中文字幕、unelevated 安装/卸载步骤保持，不改 artifact 或发布条件；本片不实际发布。

## Linux 上可执行证据

- `packaging/windows/test_integrated_reinstall.py`：实际被编排调用的文件 snapshot/校验 helper，覆盖原样通过、改 DB/删文件/新增 WAL/重建样本/改 sentinel 均拒绝、缺 sentinel/link 拒绝、默认 fresh 已有 profile 零 install/seed、仅观测本安装进程且不 kill。
- `scripts/e2e/windows-integrated-reinstall-proof.test.mjs`：实际 resume reader 的完整 raw 保留、SHA/candidate/exe/profile/installer 绑定、异工程与外部输出/live 结果/未保存设置拒绝、空/非法/超上限 proof 拒绝。
- 最终 Linux 可执行结果：Windows packaging guard 集 **46项运行，45通过/1跳过**（跳过项沿原平台条件），新 Node proof **4/4**。目标 Ruff、mypy、JS ESLint、Prettier、node check、Python compile 和 diff 检查通过。最终日志：`/tmp/integrated-reinstall-windows-guards-final.log`、`/tmp/integrated-reinstall-proof-tests-final.log`、`/tmp/integrated-reinstall-py-{lint,format}.log`、`/tmp/integrated-reinstall-js-{lint,format}.log`。这些是 guard/helper 证据，不是 Windows 二进制执行证据。

Windows workflow 在原 smoke 前持续执行新 helper/Node 回归，再运行同候选重装；实际 Windows candidate 正向由 root 后续单独触发和记录。未覆盖真实标准用户干净机器人工验收、签名、SmartScreen 免提示、不同版本迁移、会员/付费或人工完整视听。
