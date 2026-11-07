# Windows 音效组写回矩阵：安全定位与独立快门

公开 CI `42334708295 / 128288892020` 在旧 source `37f9966` 的 `film-audio-library.test.ts:914` 报原 5000ms timeout。该处是六参数矩阵，公开日志没有指出哪一参数或停在哪段；没有产品断言失败或 Windows 根因的证据。本片不修改产品、不提高 timeout、不改变 workers、不缩减库或真实 SHA/write/readback 检查。

原每一参数实际执行：真 2 秒视频 fixture 和全 206 项库校验、只读建议、apply 内重编/资源复制/队列内再次重编和源核对、故障 write/readback、实际读盘、原目标 inspect 以及每个保留副本的 SHA。不能把测试耗时说成仅小文件写入，或从 Linux 通过推断 Windows 已修。

## 固定观察

仅这六项测试记录固定 mode、当前 stage、真实 elapsedMs、有界 completed 阶段和工具 runner 调用数。原 4.9 秒 timer 只保存当时观察，不取消、不重试、不改变原 5 秒 deadline，也不证明停止或已写完。`onTestFailed` 输出近门观察或当前观察；正常 CI 成功不输出。临时本地设置 `AIVORA_TEST_SAFE_PHASES=1` 可输出已完成阶段，仍不改变测试行为。

阶段来自原调用的前后及透明测试写回替身：fixture/suggest/apply/commit/write/write-ack/readback/actual-read/inspect/hash-check/done。写回仍调用原实际 write，所有原断言保留。输出不含路径、项目/成员 ID、SQL、任意参数、声音正文或异常文字。Node 包装器只接收封闭 schema、固定六种 mode 和阶段、有限整数；总计最多六条原 GitHub 安全错误注释，stdout/stderr 与 child exit 原样保留。

## 独立 Windows 定向任务

追加 `audio-library-write-windows`，使用原 Node 24.15.0/Python 3.12/uv frozen/pnpm frozen，以及原 `ci_media_tools.py` 固定 Windows 开发工具 pin。原 quality、speech-window 和此前所有 job 保持逐字前缀；不代替或 skip 完整门。

`pnpm test:audio-library-write:ci` 只调用 Node 原诊断包装器固定 `--audio-library-write-test` 分支。分支验证 pnpm JavaScript 入口，使用 `process.execPath` 和 `shell:false`，固定选择原标题的 before/after/unreadable/readback-stale/readback-empty/readback-wrong 六项。不接任意路径/regex/命令；该分支多余参数在 spawn 前拒绝。没有更改 default/self-test/speech 的有效行为。

## 实际本机证据

- 原六项在 5000ms 门内通过；固定新 launcher 实跑也是 **6 passed / 26 deselected**，不是零条匹配。日志 `/tmp/windows-library-write-fixed-cli-six.log`。
- 此次固定 launcher 的六项总耗时分别为 4272/3505/2718/2323/2142/2182ms，均有 15 次原工具 runner 调用。before 的 fixture422、suggest1159、apply932、commit至write1606、实际write11、inspect143ms。数字仅为本次 Linux 测量，不是 Windows 原因。
- Node 诊断回归及实际 `--self-test`：27 项通过。包含闭合数据、未知字段/秘密/NaN/Infinity/越界/条数上限；固定 CLI 真实 child 的 exit0/23、原 streams、shell:false 和多余参数 0spawn。日志 `/tmp/windows-library-write-diagnostics-tests.log`、`/tmp/windows-library-write-selftest.log`。
- 正式 desktop 类型、目标 ESLint/Prettier/diff 检查；没有依赖或锁变更、没有真实供应商调用。

本片是取得下一轮真实 Windows 参数和阶段证据的诊断工具，尚不能称超时根因已修。成功定向也不代表完整 Windows quality 已通过。
