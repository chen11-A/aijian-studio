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

真实租约 `mediaDispatchLease().current()` 是同步谓词：session 对象、access token、过期、inferenceDenied，以及 subject 算出的账号 SHA 必须仍等于捕获的 `account.accountSha256`。登出或换账号会让旧租约的 `current()` 变成 false。`stillCurrent` 原先在 `await readProject` 之前检查租约和账号，读完后只比较原稿。读文件期间登出或改账号 SHA，回执仍可能按读之前的 scope 写下。现在 canonical 读完后再检查 `authorized`、`lease.current()` 和账号 SHA，不过才比较原稿。回归把第二次 `readProject` 堵住，在堵住期间登出或改账号 SHA，确认被拒绝；租约恢复后同一个 offer 仍可明确确认。

`importShotFixedInput` 原先在对话框返回后对捕获的旧 `film` 调 `updateShot` 再 `onFilm`。切项目、改稿或删镜头会把旧稿写回。现在只在当前作品 id 相同且镜头还在时，把 poster 打到当前稿上。取消、拒绝、换作品、删镜头都不调用 apply。保存走 `createFilmPersistence`：当前对象已换成新稿时，旧对象入队会被 guard 丢掉，不写盘。

64 个未确认 offer 满了之后，新的手工画面不再发 offer，已有 offer 仍可确认；此时导入仍可增加回执。256 条回执满了之后，再导入或确认都是 `LEDGER_FULL`，重新选择不会再增加回执。提示写明这一点。重启是新的空账本，旧回执不再匹配，不能当成持久授权。

## 工具

云机器原是 Ubuntu ffmpeg 6.1.1。按 lock 安装 Debian `7:7.1.5-0+deb13u1` 的 `/usr/bin/ffmpeg` 与 `ffprobe`，摘要分别为 `e8a8d46f5225f3062cec7c07fb145d58ae73c603cb740dcd5bad34bfb54e455a` 和 `cefc5f81c0b18429cdbf8fa5a89e1e9c759235e10f93f9b329ff1b2fdff26f46`。配套库放进默认链接路径，不靠 `LD_LIBRARY_PATH`。没有改 lock 或断言。

## 失败与限制

安装锁定工具后，`src/film-generation-execution.test.ts` 33 项全部通过。其中包括原签名视频（`sent == ["tts"]`）、planned-location、原 4 个 NOT_NEEDED / 迟到校验，以及回执不得打开 NOT_NEEDED。此前在未换工具时，原基线 `6bb54bbc` 的签名视频用例同样得到空的 `sent`；换上锁定二进制后新候选不再跳过这些断言。

本轮定向（合入集成分支记录并修好末门之后）：

- `pnpm --filter @aijian/desktop exec vitest run --coverage=false` 上述 6 个文件：exit 0，6 files，63 tests。其中 `film-generation-fixed-input.test.ts` 7 项，含读边界登出/换账号。
- `pnpm --filter @aijian/studio-web exec vitest run --coverage=false` 五个相关文件并按名称过滤：exit 0，4 passed / 178 skipped。通过的是 offer 确认、晚到导入不覆盖新稿、满额提示、保存队列。`shot-still` 与 `workflow` 被过滤跳过，随后进入完整 web 门。

## 本轮完整 TypeScript 门

串行，没有 skip ci，没有跑 Python 完整套件。

| 命令                                    | 退出 | 结果                                                                                                                                                              |
| --------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck:ts`                     | 0    | contracts、desktop、studio-web 均完成。中途 desktop `backendProjectId` 与 web 测试 mock 类型曾 exit 2/1，已收窄后重跑通过。                                       |
| `pnpm lint:ts`                          | 0    | `eslint .`。中途 4 个 no-useless-assignment exit 1，去掉无用初值后重跑通过。                                                                                      |
| `pnpm exec prettier --check .`          | 1    | 只剩合并进来的 `docs/aivora/云端执行队列.md`、`docs/aivora/当前进度.md`。这两份是集成分支记录提交原样，本候选没有改它们。本片自己的测试和 QA 已按 Prettier 写过。 |
| `pnpm --filter @aijian/desktop test`    | 0    | 176 files，2515 tests，140.55s。原覆盖门 statements 90.68、branches 91.29、functions 93.36、lines 92.21。                                                         |
| `pnpm --filter @aijian/studio-web test` | 0    | 474 files，5638 tests。覆盖 statements 90.31、branches 86.79、functions 92.62、lines 93.07。                                                                      |

没有跑 `pnpm test:py`、`pnpm typecheck:py`、`pnpm lint:py`。不是最终同源完整验收，也没有正常 Chrome。

账本上限和重启是内存限制。256 条回执已满时，重新选择不能解锁。

没有把检查点的 `services/api` sidecar 字段移植过来。`input_sha256` 用 SQLite 读取证明，而不是改后端测试工具。

## 下一依赖

- 总控合同 v1 已写入 `aivora-native-contract-needs-20261109.md`。本片 closed 并审合之前，不把 `prepareSlots` 接到 main，也不移植三个私有 desktop client/parser。
- portrait/location 跨 execution、pending pipeline、连续帧、FAILED 下一版本不在本片。

已用普通 merge 接上 `origin/grok/aivora-next-integration-20261109` 的记录提交 `f59affe2`，merge 提交 `74d25599`。没有改写历史。`prepareSlots` 和连续帧没有叠加。原 bundle 未改。

## 提交

末门产品提交 `c25b94d884df8775ff0f046b3b73a13d1788b60a`。类型、lint 修正和本记录提交后的尖端以 `git rev-parse HEAD` 为准。
