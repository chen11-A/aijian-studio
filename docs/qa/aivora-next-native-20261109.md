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

画面上的「导入为固定输入」只把 `projectId` 交给 main。带 offer 时，组件上的确认按钮只交 `projectId` 和 `offerId`。`ProWorkspace` 目前只挂导入按钮，还没有把刚生成的 offer id 传进去。确认通道本身已由 IPC 和组件测试覆盖。

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

## 失败与限制

以下失败在未改产品逻辑的 `film-generation-execution.ts` 上同样出现，不是本片断言被放宽：

- `crosses actual Python signed routes...` 与 planned-location 视频用例期望 `sent == ["tts"]`，本环境得到 `[]`。对照命令是把该文件临时还原到 `6bb54bbc` 后只跑 frame stage=false，结果仍是 `expected [] to deeply equal ['tts']`。随后已把本片文件拷回。
- 原 4 个 NOT_NEEDED / 迟到校验用例，以及本片新增的“回执不得打开 NOT_NEEDED”用例，都在 `verifiedQcTools` 抛 `TOOLS_UNAVAILABLE`。系统 ffmpeg/ffprobe 在 PATH 上，但不是 `config/draft-media-toolchain-linux-dev-lock.json` 里的 Debian 7.1.5 摘要。没有改这些断言，也没有跳过。因此本环境没有完成“真实 ffprobe 下 NOT_NEEDED 零请求”的复跑；代码路径仍停在 pipeline 早返回，定向测试未能走到断言。

未跑：`pnpm typecheck`、`pnpm lint`、desktop/web 全量、`pnpm test:py`、正常 Chrome。这些留给总控串行门。本片定向结果不是最终同源完整验收。

没有把检查点的 `services/api` sidecar 字段移植过来。`input_sha256` 用 SQLite 读取证明，而不是改后端测试工具。

## 下一依赖

- 总控冻结 `docs/qa/aivora-api55-contract-proposal.md` 的缺口，见 `aivora-native-contract-needs-20261109.md`。冻结前不移植 `generation-cache-preparation.ts`、其测试，以及 `generation-preparation-client.ts` 的 `prepareSlots`。
- 冻结后才把私有 `PREPARATIONS` 接到 main，并保持公共 `PREPARED` 不带 cache 事实。
- `ProWorkspace` 尚未把新的手工 still offer 交给确认按钮。
- portrait/location 跨 execution、pending pipeline、连续帧、FAILED 下一版本不在本片。
- 需要带锁定 Debian ffmpeg 的环境，才能复跑原 NOT_NEEDED 零请求探针。

## 提交

产品实现提交是 `806fa7e6df4d37338a473c78e128418442ca53f5`。若其后还有只改本文的补记，以 `git log --oneline` 的分支尖端为准，不把补记当成新的产品行为。
