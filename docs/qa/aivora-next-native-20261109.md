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

代码候选是 `1642bb6437abedcd4a36a06f08a4b2fb6535cd77`。该提交之后没有再改源码，已通过的 desktop 2515 与 web 5638 不重跑。

合入前只格式化 Prettier 点名的 `docs/aivora/云端执行队列.md` 与 `docs/aivora/当前进度.md`。diff 只是两张表的列对齐，历史事实未改。`docs/aivora/验收与交接.md` 未动。

仅格式提交是 `676be73d1d22725b97cc061868d502a7b4c1ccb2`，父提交就是代码候选 `1642bb6437abedcd4a36a06f08a4b2fb6535cd77`。该格式提交只含上述两份进度文档。

`pnpm exec prettier --check .` 在 `676be73d` 的工作树上退出 0，输出 `All matched files use Prettier code style!`。本记录提交不再改源码，也不改那两份进度文档。分支尖端若只比 `676be73d` 多出本 QA 记录，仍然不是新的代码候选。

## 已有 CI 归因（head 0de5e4b）

总控核验的是已有 CI，不是新门。head `0de5e4b377d6d153c1d1f6ae9096b1663fc58b33` 上读取的失败日志：

- push [42728215212](https://github.com/chen11-A/aijian-studio/actions/runs/42728215212) Linux quality job `129539223531`
- PR [42728221961](https://github.com/chen11-A/aijian-studio/actions/runs/42728221961) Linux quality job `129539247406`，以及 Windows quality job `129539246965`

push 与 PR 的 Linux 是同一签名，只分析一次。Lint、typecheck 和合约校验在这三份 job 里都已通过，失败都在 Test。

本片回归：`ProWorkspace.test.tsx` 的 “shows the manual still offer for an explicit confirm and leaves the saved draft on cancel or refusal”。三份日志都是 `expected 3 to be 2`，栈在第 3236 行。前两次写入计数已经相等，多出的一次发生在导入取消的等待期间。画面 `applyLive` 仍走原来的 400ms `saveFilm`；确认、拒绝和取消本身不调用 `apply`。测试在计数前等到含 `manual-still.png` 的那次保存落地，并核对最后一次保存的稿没有变化。

定向命令，没有重跑已通过的 desktop 2515 或 web 5638：

```text
pnpm --filter @aijian/studio-web exec vitest run --coverage=false \
  src/aivora/pro/ProWorkspace.test.tsx \
  -t "shows the manual still offer|does not let a late import"
```

exit 0。1 file，2 passed，141 skipped，4.63s。这次修复提交是 `06ccc2e532cdedc659e9f82079d9cb35861ca359`。它只改这个测试。代码候选因此从 `1642bb6437abedcd4a36a06f08a4b2fb6535cd77` 移到该提交；不能用 `0de5e4b` 或本地完整 TS 通过代替远端结果。

继承基线：Windows 另有 `film-audio-library.test.ts:847` 的 `source` 与 `clean` 两条 `Test timed out in 5000ms`。没有产品断言失败。本片没有改这个文件，Linux 同一文件通过。公开记录里该文件已有同样的 5000ms 超时：`42334708295` 的第 914 行，以及 root `4b77` 的第 950 行。不提高 timeout，不删断言，这道 Windows 门仍未关闭。

不是后端 `test_real_original_changed_with_restored_size_and_mtime_is_not_reused`。那条签名是同长覆写、SHA 不同、全部 stat 含 ctime 不变、identity cache 误报 `VERIFIED`，20ms 后 ctime 变化才拒绝，记录在 `c1a70020`。这三份 job 的 annotations 没有该测试名，本片不重复调查，也不把那道门当成通过。

`prepareSlots` 仍未接。不自行合并。

## 新 head 6dede4f 的已有 CI

`6dede4f76c6618453a9d06eb6b5ea14fcb3e9a59` 的 push [42733662667](https://github.com/chen11-A/aijian-studio/actions/runs/42733662667) 与 PR [42733670872](https://github.com/chen11-A/aijian-studio/actions/runs/42733670872) 都在 Typecheck 失败，签名相同，只看一次。`ProWorkspace.test.tsx` 第 3229 行把 `writeFilmProject` 的参数当成 `unknown`，`shots`、`item`、`still` 因此报错。Vitest 不跑 `tsc`，所以上一轮定向没有拦住。现已把这次保存标成 `FilmProject | undefined`。该修复是 `5f0b169cbdae47de3046319c35f037a6b6ddbc27`。

定向仍是上一条过滤命令，exit 0，2 passed / 141 skipped，4.56s。`pnpm --filter @aijian/studio-web typecheck`（`tsc -b --pretty false`）exit 0。没有重跑 desktop 类型检查、desktop 2515 或 web 5638。

PR 的 `pro-scene-audio (ubuntu)` job `129557595459` 16 项里只失败 `1280x800-16x9-scene-audio-confirm-remove`，停在 `pro-scene-audio-cases.mjs:255` 等待「声音已加入并保存」。摘要是 `sceneReply=ADDED`、`sceneSaved=0`。同一提交的 push job `129557565894` 整项通过，其余 15 个组合也通过。本片没有改这场审计或场景声音产品代码。不把这一次单独失败当成通过，也不改断言。

## 0388182 的 Windows 定向失败

同一 head `0388182b876f8a455461eb2d6fcb75322d788de0` 的 push [42735977747](https://github.com/chen11-A/aijian-studio/actions/runs/42735977747) 上，两道已有 Windows 定向门失败。同一次提交的 PR run [42735983478](https://github.com/chen11-A/aijian-studio/actions/runs/42735983478) 里，`audio-library-write` job `129565212318` 和 `speech-window` job `129565212006` 是成功的。这不是销案。

`audio-library-write (windows, targeted)` job [129565192807](https://github.com/chen11-A/aijian-studio/actions/runs/42735977747/job/129565192807)，runner `GitHub Actions 1000003182`。`film-audio-library.test.ts:919` 的 `before` 在原 5000ms 超时。已有诊断：`elapsed=4902ms`，`fixture:1312ms|suggest:1419ms|apply:1124ms`，`stage=commit`，`probes=12`。`commit` 只标在 `beforeCommit` 入口；钩子本身没有后续工作，`write` 观察点没有出现。挂点在钩子返回之后、项目写入之前的那段库内核对，包括混音解析和媒体子进程。当时没有子进程退出数，也没有内存数字。

`speech-window (windows, targeted)` job [129565192815](https://github.com/chen11-A/aijian-studio/actions/runs/42735977747/job/129565192815) 的交付清单步骤失败。`film-export-qc-ownership.test.ts:7` 整段 5000ms 超时，1 failed。这个用例是进程内 SQLite 和 `realpathSync`，没有 ffmpeg。日志没有阶段，挂点未定位。

本机 Linux 只作对照，不代替 Windows：`before` 这一条 2.34s 通过；ownership 14ms 通过，阶段是 db 1ms、rows 9ms、owner 10ms、done 11ms。原 5 秒、断言和这两个 CI 入口都没改。没有全量重跑。两项仍未定位。

诊断提交 `7083b7009e51958b1e617a528a7406e0d3ed4816` 只让下一次既有 Windows 定向门多记：`before` 的 `commit-return`、子进程 open/closed/failed、最后工具名、heap 和 free；ownership 的 db/rows/owner/done/cleanup。不记录路径。这次提交本身还没有新的 Windows 结果。`67681bf` 上这两道既有 Windows 入口的 push 与 PR 都通过。那是后绿，不是 `0388182` 的根因销案。ownership 失败日志仍然没有阶段。

## 场景声音成功反馈

PR22 [42738189561](https://github.com/chen11-A/aijian-studio/actions/runs/42738189561) job `129572483003` 复现同一失败。`a29bf843` 把同场次任意键变化当成结算，审查未批准。修订后只把 `host.current()` 与本次 `added` 且输入键确实变化的那份作品对齐；对不上就保留外部变化提示。`read`、关闭和离开剪辑都会清掉例外。失败路径不写成功句。

修前「选用未完成时的真实画风」看不到刷新提示。修后同一异步结算能等到这句，并且没有「声音已加入并保存」。成功之后再改画风仍出现刷新提示。transport 失败显示「尚未确认」，没有成功句，随后的画风变化仍提示刷新；关闭再打开不留下成功句或刷新句。离开剪辑会关掉对话框。原 10 秒未改。这是 Linux 对照。

source/clean 的 `host.run` 包装能看到库内部调用：source 在 Linux 上 `library` 大于测试自己的 encode，且 `closed === started`，说明 `QcRunner` 的 `onProcess(done)` 有回调。source 的探测会因替换字节失败一次，这个 `failed` 计数是真实失败，不是未退出。`42748976378` 的 audio-library-write 6 过、30 跳过、before 3920ms，没有跑 source/clean，不能销旧挂点。

`f67e0fcf` 复审后补了一处：选用过程中作品已变、结果又是 unknown/failed 时，不再用「请刷新后重新核对」盖住「不要重复加入」。成功句改绑 settle 返回的 `adopted`，不绑返回后的任意 `current()`。修前该用例只剩刷新句；修后能等到「不要重复」，刷新句不在。`ProWorkspace.scene-audio-suggestions.test.tsx` 17 项通过。原 10 秒未改。Windows before/ownership/source-clean 仍是已登记的继承时序，这次不加新诊断。
