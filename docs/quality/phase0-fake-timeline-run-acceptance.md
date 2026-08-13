# Phase 0 可恢复 Fake Timeline 后端验收

状态：PASS（后端纵切）；K01 未完成

## 已验证

- Sidecar 写路由 201 创建、200 精确重放；普通 Web 无写路由，运行时未启用时稳定 503。
- 并发相同 operation 收敛为一个 Workflow；不同 operation 对同一冻结输入不重复入队。
- 请求线程不生成媒体；Worker 只领取精确 task kind，并产生三段真实 125 帧 WebM 及对应
  WAV/PNG。
- Timeline 直接引用 preview WebM 的独立文件 SHA-256，总长 375 帧；Workflow、Node、Attempt、
  Task 都进入一致成功终态。
- accepted SourceManifest 在 enqueue 和最终 Artifact 写入时均重验；中途切换 accepted head 会
  原子失败且不创建 Timeline。
- Artifact 已持久化后注入崩溃，租约恢复不重做输出并推进 Workflow 成功；确定性媒体失败立即
  进入一致失败终态。
- Worker 运行中停止会在桌面 5 秒停机预算内退出，保持租约状态供下次恢复；FFmpeg/ffprobe
  最小环境不包含 `OPENAI_API_KEY` 一类父进程秘密。
- 旧同步端点只返回符合新 producer、节点和当前来源依赖的既有 Timeline，不再生成派生假哈希。

## 验收命令

```powershell
uv run pytest services/api/tests/test_fake_timeline_run_api.py services/api/tests/test_fake_timeline_workflow_api.py services/api/tests/test_fake_media_package.py services/api/tests/test_media_probe.py services/api/tests/test_sidecar.py services/api/tests/test_migrations.py -q
uv run pytest services/api/tests -q
pnpm contracts:check
pnpm typecheck
pnpm lint
pnpm build
git diff --check
```

## 未覆盖与进度口径

本记录不证明前端/Electron 已提供创建与恢复操作，也不证明用户能在同一 UI 流程中从小说走到
MP4；真实 Provider、人工 Gate 和正式发布均未接入。K01 继续为进行中，首个 8 周严格计数仍为
18/43，48 周整体仍约 11%。
