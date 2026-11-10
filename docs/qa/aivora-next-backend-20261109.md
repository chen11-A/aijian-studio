# 后端 API55 缓存边界（2026-11-09）

本文件只记录后端代理这一片。它不是最终验收，也不是检查点阶段绿。完整重型 TS、原完整 Python 覆盖门和界面接线都没有跑。

## 位置

| 项 | 值 |
| --- | --- |
| 任务分支 | `cursor/aivora-api55-cache-boundary-93a6` |
| 实现提交 | `74704d0a6df0f0b450ade19f04fa1f39e4d1f799` |
| 基线 | `grok/aivora-next-integration-20261109@6bb54bbcce5e4051454a9fa0a17ab4dd72472167` |
| 检查点 | `166dc89d35d3cfab6f220a409b34a0874f38ee08` |
| 检查点 base | `d658377cd866c6acbf89bf06f86399a619717df1` |
| 隔离 ref | 本地 `refs/heads/handoff/backend-cache55-isolated`，未推送 |

恢复入口仍是原档案 `docs/aivora/checkpoints/backend-cache55.bundle`。本片没有整包合并，没有覆盖原 bundle，没有改 `packages/contracts`、`apps/desktop` 或 `apps/studio-web`。

`git bundle verify docs/aivora/checkpoints/backend-cache55.bundle` 退出 0。bundle 要求 base `d658377`，包含 `166dc89 refs/heads/codex/aivora-prepared-generation-cache-ledger`。字节 30663，SHA256 `263ca0bbc9a507413f33f0373a8ba342432359c15ce49e91ef9894db564c96bc`，与 manifest 一致。base 是当前 HEAD 的祖先。

## 这一片做了什么

从隔离检查点只移植 `services/api`。当前集成分支相对检查点 base，这些生产文件除 `test_video_recovery.py` 多三行诊断导入外没有漂移；该补丁以 3 行偏移干净套上，没有丢掉这三行。

新增并保留的行为：

- schema 55 只加 `prepared_generation_slot_preparation`。六份旧迁移夹具仍比较原 SQL，版本断言从 54 改为 55。
- `cache-preparations` 在 image、arm 或额度之前原子冻结整表。slot 0 在非首次重生成且 schema-3 快照可核验时为 `STORYFILM_CACHE`，slot 1/2 为 `CLIENT_IMAGES`。
- 晚缺、同长度替换和链接替换不转新的 provider POST，也不新增预算尝试。
- 新测试证明：已有 `UNKNOWN` 在缓存准备、缓存消费、把失败上限从 1 提到 1000、以及新 execution 之后仍是原来的一行 `UNKNOWN`。新 execution 的 image dispatch 为 409 `ATTEMPT_ALREADY_RESERVED`。用冻结缓存请求去 arm slot 1 为 409 `INPUT_UNVERIFIABLE`。消费缓存时 provider 调用次数为 0。

合同形状写在 [aivora-api55-contract-proposal.md](aivora-api55-contract-proposal.md)。总控冻结前不发布共享类型。

## 检查点里未改的桌面文件

| 文件 | 相对 `d658377` |
| --- | --- |
| `apps/desktop/src/generation-cache-preparation.ts` | 新增 258 行 |
| `apps/desktop/src/generation-cache-preparation.test.ts` | 新增 184 行 |
| `apps/desktop/src/generation-preparation-client.ts` | 修改 +19 行，`prepareSlots` |

未发布：`packages/contracts/openapi.json`（检查点约 +232 行）、`packages/contracts/src/generated.ts`（检查点约 +116 行）。

## 命令与真实结果

工作区原先没有 `uv`。按锁定文件执行 `uv sync --frozen`，装到本地 `.venv`，没有改产品锁。云机器自带的是 Ubuntu ffmpeg 6.1.1，SHA256 不在 `config/draft-media-toolchain-linux-dev-lock.json`。测试仍要求 `/usr/bin` 上的 Debian `7:7.1.5-0+deb13u1` 原字节。本片没有改锁、没有改断言、没有 skip。

1. `uv run ruff check` 覆盖新增缓存模块和缓存测试：通过。`uv run ruff format` 只重排了 `test_prepared_generation_cache.py`。
2. 第一次目标 pytest，系统 ffmpeg 未换：`40 passed, 17 errors in 8.28s`。17 个错误都是 `actual_cache` 在 `discover_media_toolchain` 报 `the resolved media tool binaries are not present in the lock`。守卫测试和六份迁移夹具当时已通过。
3. 把锁定二进制放到 `/usr/bin` 后，若只靠 `LD_LIBRARY_PATH`，第二次目标 pytest：`2 failed, 55 passed in 28.65s`。失败是 `test_cache_only_actual_storyfilm_consumes_saved_video_without_provider_or_policy` 和 `test_cache_read_does_not_settle_unknown_or_unlock_it_with_new_limit_or_execution`。两者都得到 `FAILED` / `FILM_FAILED`，草稿导出日志为 `PROBE_FAILED`。原因是草稿编码器启动 ffprobe 时不继承 `LD_LIBRARY_PATH`，锁定的 `libavutil.so.59` 在默认链接路径上找不到 `vaMapBuffer2`。这不是把成功改成失败的产品改动。
4. 把同一 Debian 7.1.5 的缺失库装进默认链接路径后，同一组目标 pytest：`57 passed in 31.24s`。包含迁移、混合槽、晚缺、UNKNOWN，以及原缓存守卫。没有降低超时或放宽匹配。

没有调用真实会员额度或收费供应商。缓存消费测试用抛错的假 transport，调用列表保持为空。

## 2026-11-10 合同冻结与这一轮完整 Python 门

总控已把本文上一节的请求和响应冻成 v1。`uv run python scripts/export_openapi.py` 与 `openapi-typescript@7.13.0` 生成了 `packages/contracts/openapi.json`（+232）和 `packages/contracts/src/generated.ts`（+116）。第二次生成没有再产生 diff。`uv run ruff check services/api` 与 `uv run ruff format --check services/api` 通过，586 个文件已是格式化状态。`uv run mypy` 为 329 个源文件、退出码 0，没有依赖生成的 TypeScript。

`pnpm test:py` 停在 Corepack 对 `pnpm@11.9.0` 的下载确认，没有进入测试。随后用该脚本本体跑完整门。结果 `143 failed, 5204 passed, 6 skipped, 100 errors in 1960.27s`，退出码 1。覆盖检查没有运行。243 个 nodeid 的签名、日志 SHA256 和干净环境复跑见 [Python 门分类](aivora-api55-python-gate-20261110.md)。这道门的结果保留。没有新的源码变化就不再重跑。它不是最终验收，也不代替最终集成候选上的完整重型门。

账号、额度、UNKNOWN 和来源拒绝仍由 `services/api/tests/test_prepared_generation_cache.py` 里的真实 TestClient + SQLite 用例覆盖，包括重读来源字节/canonical/MIME、跨账号与跨项目 lineage、image/arm 先于冻结则不写表、冻结后 image 只占用 CLIENT 槽、并发 prepare 与 image-dispatch，以及 UNKNOWN 不被缓存读取结算。原断言没有放宽。

## 未完成与下一依赖

- 桌面三个私有 parser/client 仍由界面代理按生成 schema 实现。`prepareSlots` 未接 main。PR 23 head `0de5e4b377d6d153c1d1f6ae9096b1663fc58b33` 的本地 TS 与格式已过，远端 CI 排队，未合入。
- 本地连续帧和明确 FAILED 后的下一版本不在本轮。
- 最终集成候选才集中跑完整重型门。本片不循环查询 CI。
