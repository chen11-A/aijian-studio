# 界面/原生本片记录（2026-11-09）

分支 `cursor/native-fixed-input-film-still-7ab5`。基线是交接 `6bb54bbcce5e4051454a9fa0a17ab4dd72472167`，产品祖先 `babefa9af3e3fff0ad49cea93c70b3f1abeb80a4`。PR 目标 `grok/aivora-next-integration-20261109`。没有合并 main、`aivora/dev` 或后端 PR #22，没有 tag，没有发包，没有真实会员或收费供应商调用。用户本机两个目录未核，不声称已同步。

提交 SHA 见本文件末尾；以 `git rev-parse HEAD` 为准。

## 隔离检查点

`docs/aivora/checkpoints/frontend-auto-source.bundle`

- 大小 6490，sha256 `6b1d400cee1ce70a5dd93d6034cdc3cfe97e894a8539cb48629561ecec8f09e5`，与 manifest 一致。
- `git bundle verify` 成功。head `939b4c975f38568d825d3d5e89a0a83106813ec0`，base `adb08bfdd5aad91605fdd22efc8bdbe2a3bc5b85`。
- 已 fetch 到本地 ref `refs/heads/handoff/frontend-auto-source-939b4c9`。原 bundle 未改，没有整包合并。
- 检查点 QA `docs/qa/prepared-generation-auto-frame-reprepare.md` 已在该提交中读过。相对 base 只动 4 个文件；其中 `services/api/tests/prepared_native_test_sidecar.py` 属后端，本片不移植。

## 产品变更

先做手工 `film:still` 的 main 私有确认/导入，再把检查点的 shot-frame 恢复接到当前工厂。

- 明确确认或 main 对话框导入后，同账号/项目/角色/SHA/MIME/canonical 路径的手工画面可以进入后续视频准备。
- 只落在 `series/stills`、没有回执也没有 READABLE shot-frame 的文件仍是 `UNSUPPORTED_SCOPE`。
- 已知自动输出不能靠回执降成 fixed input。
- 同账号/项目的 READABLE shot-frame 在新 execution 上恢复原 creator；两次 `prepared_generation_target.input_sha256` 相同。创作、账号或字节变化仍拒绝，且不增加目标行。
- 公共 `PREPARED` 仍只写 `CLIENT_IMAGES`。`prepareSlots` 未接。
- `NOT_NEEDED` 分支没有改。原保存队列函数 `dispatchGenerationOnProjectQueue` 没有改。确认/导入不写项目 JSON。

`ProWorkspace` 在手工 `film:still` 返回 `fixedInputOfferId` 后，把该 offer 交给「确认这张手工画面为固定输入」。生成本身不会自动确认。旧素材仍用「导入为固定输入」，只把 `projectId` 交给 main 对话框。取消或拒绝不改已保存的稿。确认后的首帧写入走原来的 `transactFilmProject` 保存队列，然后再 `prepare`。

账本只在内存里：未确认 offer 最多 64 个，回执最多 256 条。达到上限返回桌面本地的 `LEDGER_FULL`，界面说明可以重新选择，重启后旧确认不会保留，也不能当成持久授权。已有 offer 在名额已满时仍可明确确认。进程重启等于新账本，旧回执不再匹配。

## 实际命令

环境：本机原先没有 `node_modules`。用 Node `v24.22.2` 与锁定的 pnpm `11.9.0` 执行了 `pnpm install --frozen-lockfile`。为跑签名 sidecar，另装了 uv `0.13.7` 并 `uv sync --frozen`。这不是产品依赖变更。

通过：

```text
pnpm --filter @aijian/desktop exec vitest run --coverage=false \
  src/film-generation-fixed-input.test.ts \
  src/film-generation-execution-preload.test.ts \
  src/film-generation-queued-dispatch.test.ts \
  src/film-library-ipc.test.ts \
  src/still-diagnostics.test.ts
```

其中 fixed-input 3 项、preload 含新的 confirm/import 参数项、原保存队列 `film-generation-queued-dispatch.test.ts`、原 `film:still` IPC 与 still diagnostics 均通过。

```text
pnpm --filter @aijian/studio-web exec vitest run --coverage=false \
  src/aivora/pro/FixedInputImportButton.test.tsx
```

3 项通过：只传 projectId、取消/拒绝不改镜头、确认不传 path/origin/metadata/cacheHit。

`film-generation-execution.test.ts` 里本片新增并通过的是：编译后的 fixed-input 模块被工厂消费、未确认的手工 still 拒绝、回执不能降格自动输出、READABLE shot-frame 的新 execution 保持同一个 `input_sha256`、creative/account/bytes 三则拒绝。sidecar 为真实 `uv run` TestClient，`input_sha256` 读的是该进程写下的 `workspace.db`，没有改 Python sidecar。

`confirmOrImport` 在 `pickImage`、读文件和 `isAutomaticOutput` 之后再读当前账号租约、backend project、series 和 canonical 项目哈希。任一变化都不写入回执。`isAutomaticOutput` 里的 `current()` 只覆盖租约中途失效，不覆盖账号 SHA 或原稿变化，所以末门是后加的复读，不是假设旧 callback 已经足够。

## 工具

云机器原是 Ubuntu ffmpeg 6.1.1。按 lock 安装 Debian `7:7.1.5-0+deb13u1` 的 `/usr/bin/ffmpeg` 与 `ffprobe`，摘要分别为 `e8a8d46f5225f3062cec7c07fb145d58ae73c603cb740dcd5bad34bfb54e455a` 和 `cefc5f81c0b18429cdbf8fa5a89e1e9c759235e10f93f9b329ff1b2fdff26f46`。配套库放进默认链接路径，不靠 `LD_LIBRARY_PATH`。没有改 lock 或断言。

## 失败与限制

安装锁定工具后，`src/film-generation-execution.test.ts` 33 项全部通过。其中包括原签名视频（`sent == ["tts"]`）、planned-location、原 4 个 NOT_NEEDED / 迟到校验，以及回执不得打开 NOT_NEEDED。此前在未换工具时，原基线 `6bb54bbc` 的签名视频用例同样得到空的 `sent`；换上锁定二进制后新候选不再跳过这些断言。

随后 `film-generation-fixed-input.test.ts` 5 项通过，覆盖异步末门、64 个 offer、256 条回执和重启后的空账本。`ProWorkspace.test.tsx` 中「shows the manual still offer」1 项通过：生成后才出现确认按钮，确认前不调用，拒绝和取消不增加保存。`FixedInputImportButton.test.tsx`、`shot-still.test.ts`、`workflow.test.ts` 共 38 项通过。

账本上限和重启是内存限制：满额会明确拒绝，重启不会带回旧回执。这不是磁盘上的授权。

未跑：`pnpm typecheck`、`pnpm lint`、desktop/web 全量、`pnpm test:py`、正常 Chrome。这些留给总控串行门。本片定向结果不是最终同源完整验收。

没有把检查点的 `services/api` sidecar 字段移植过来。`input_sha256` 用 SQLite 读取证明，而不是改后端测试工具。

## 下一依赖

- 总控合同 v1 已写入 `aivora-native-contract-needs-20261109.md`。本片 closed 并审合之前，不把 `prepareSlots` 接到 main，也不移植三个私有 desktop client/parser。
- portrait/location 跨 execution、pending pipeline、连续帧、FAILED 下一版本不在本片。

## 提交

闭环前的实现提交是 `806fa7e6df4d37338a473c78e128418442ca53f5`。本片闭环提交以分支尖端为准。
