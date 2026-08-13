# Phase 0 可恢复 Fake Timeline 运行合同

状态：Implemented backend vertical slice；K01 仍在进行

## 目标

把已验证的本地 Fake 媒体包接入 Sidecar 后台任务：从当前已批准的 `SourceManifest`
冻结一次运行，生成三段各 125 帧的真实 WebM/WAV/PNG，并用 WebM 的真实字节 SHA-256
创建不可变 `TimelineVersion`。请求线程只入队，不运行 FFmpeg。

## 公共边界

- 写入口仅为受认证 Sidecar 的
  `POST /api/v1/projects/{project_id}/fake-timeline-runs`；普通 Web OpenAPI 不发布该入口。
- `Idempotency-Key` 固定为
  `fake-timeline-run:create:v1:<lowercase UUIDv4>`。同键同输入返回 200 原运行；同键异输入
  或不同键重复同一冻结输入返回 409。
- 201/200 回执只包含项目、来源、Workflow/Node/Attempt/Task 标识和状态，以及三项明确的
  Fake 能力损失；不返回路径、密钥或 Provider 数据。
- 旧 `/workflows/fake-timeline` 保留响应合同但已废弃：只读取由本运行定义、当前已批准
  SourceManifest 产生的既有 Timeline；没有兼容结果时返回 409，绝不入队或同步执行媒体工具。

## 冻结真相与恢复

- enqueue 的同一个 `BEGIN IMMEDIATE` 内重验 SourceManifest accepted head、内容哈希、来源归属
  和原始字节哈希；Definition、graph、input bindings、task kind、toolchain identity 全部进入持久真相。
- Worker 只领取 `local.timeline.assemble.fake.media.v1`，启动时和周期性只恢复该 task kind。
- 媒体生成期间至少每秒续租；停止信号会中断发布锁等待、FFmpeg 和 ffprobe，不把停机伪造为失败。
- Timeline 写入使用 `producer_attempt_id` 唯一输出；Artifact 已提交但任务尚未完成时，租约恢复
  读取该输出并推进 Attempt、Node、Workflow 到 `SUCCEEDED`，不重复创建版本。
- Timeline 对冻结 SourceManifest 记录 blocking `derived_from` 依赖，并在 Artifact 写事务内要求它仍是
  accepted head。生成期间来源审批切换会失败关闭，不产生陈旧 Timeline。
- 确定性的媒体、真相、依赖或输出冲突会立即将 Attempt/Node/Workflow 标成 `FAILED`，Task 标成
  `COMPLETED`；基础设施瞬时故障仍交给租约恢复，禁止无限自动重试。

## 媒体与安全

- Timeline asset 的 `source_asset_sha256` 必须是相应 preview WebM 的真实文件哈希，且
  `source_frame_count=125`；包哈希、PNG 哈希和逻辑内容哈希不能替代它。
- FFmpeg/ffprobe 只从锁定的 development-evidence toolchain 启动，`shell=False`、stdin 禁用，
  子进程环境仅保留 Windows 运行所需的固定允许项，不继承 API key。
- 包发布继续使用工作区内 staging、进程身份 lease、项目级 OS 发布锁、完整复验和目录级 rename。

## 明确非目标

- 本切片没有新增 Renderer/Electron 创建 capability、operation journal 或 UI 按钮。
- 没有真实 Provider、计费、自动 Gate、accepted Timeline head、角色语义生成或成片发布。
- 旧同步 API 不再生成假哈希，但前端迁移与同一 Electron 流程中的 MP4 导出仍待后续增量；
  因此 K01、Sprint 3 和 48 周严格进度均不增加。
