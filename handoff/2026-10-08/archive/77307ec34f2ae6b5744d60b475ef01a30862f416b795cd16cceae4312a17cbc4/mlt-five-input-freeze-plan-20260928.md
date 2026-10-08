# QA02 MLT 五输入冻结审门计划

状态：`WAITING_FOR_MGR02_FREEZE_APPROVAL`。本计划只生成离线合成 TEST 的 SRT 与五输入清单，**不调用 MLT、Electron、provider 或 c19 API**，不覆盖四媒体历史证据。目标目录当前不存在。

## 原始输入与身份

- 最终 ART04 规格 SHA256 `4323DFEF3EEF9337BAF49A5118DE1397B4C2AFBE2E67768E133F87C950DDF16D`。
- QA02 四媒体 `four-media-manifest.json` SHA256 `211DDD8872F1DE47A569849C7A6AE9763D125DF6BAE9F8416534976C5B83FF78`。四件原件：蓝 WebM `75FCA302…`/2619 B，红 WebM `507DB639…`/2542 B，提示音 WAV `E2C5F4AC…`/96078 B，BGM WAV `590CC4A3…`/480078 B；完整 SHA 与工具命令/探测/解码收据在原清单。QA01 独立审计 SHA `969D31C1BF1E3EB4A8F8B7BCD461D6801EF2DC67F08EE9D2D947AB33D37AA0EF`。
- QA01 原始身份 `IDENTITY-READBACK.json` SHA256 `67E4DAD955BC59EC573ADE5CD2373678738797CEC22022DFC4B0CC7798B4D32E`；GET-only `CAPTURE.json` SHA256 `33B1E446820C663126D241F2ADB7C07B3E51E29F565EE02E8FDD429ECDB87F2A`；exact script GET body SHA256 `C819E6473BDFA051C85341C633529F738C2E94A09BD484EE43EF3E1913879E0F`。四个 GET 均 200、sidecar 正常关闭，DB 前后 SHA 不变。QA01 首次写入 runner 的 exit 1 保留，身份通过随后独立 GET 读回确认；不能改写成首次尝试全程 PASS。
- 实际 project `prj_a28e95e94c8f4b30856f8694ea0aeded`、episode `ep_bef554f2d8844571a7c05a4e546bbcd4`、script version `ver_dcac90c5b9aa48b4be25a9cd097207c3`、content hash `sha256:0e3d63d72955769dc2a9bbf2b4a996e6af2ffb43cc81c620352890f4ed8a604e`。两块 ID 为 `sblk_bc34a35d11d6494d87f264a281eb930d` 与 `sblk_937703a76d0840c1aa1b31ddd63488cb`；原始文本分别为 `TEST 提示音一（非语音）`、`TEST 提示音二（非语音）`，speaker `TEST 提示音（非人声）`、delivery `OFF_SCREEN`。均由脚本直接比较 IDENTITY 与 exact/latest GET body，不靠本段手填。

## 将执行的单次离线冻结

脚本 `freeze-mlt-five-inputs-v1.mjs` SHA256 `1FB688C7696D7E5C5670FD0EA2CC9AD4317ECCF9E34A9E3BE63D566E6C02F730`；`node --check` 与只读 `--mode=dry-run` 均退出 0。脚本在任何写入前复核四媒体、锁定工具二进制、QA01 两原始回执及四个 GET body 的实际字节/SHA，精确比对版本/脚本块/文本/speaker/delivery，并拒绝输入 link/目录逃逸；目标必须是非链接 QA 根下的直接新子目录。

批准后的**唯一**目标目录：

`C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\qa02-mlt-test-20260928\five-inputs-20260928T035901Z`

在该新目录复制四件原媒体（逐件重核 SHA/字节），以 UTF-8、LF、无 BOM 写 `subtitle-test.srt`：S1 1.000–2.000 s，S2 3.000–4.000 s，文字取 QA01 exact GET。只读试算 SRT SHA256 `3561D5DF3229D71CE53F427C65A850DCF8C23BDFE0D7D9F03C8BC7D50DC81CDC`。随后写不可覆盖的 `five-input-manifest.json`，顶层 `kind=QA02_MLT_SYNTHETIC_FIVE_INPUT_MANIFEST`、`status=FIVE_INPUTS_FROZEN_NO_MLT`、`usage=SYNTHETIC_TEST_ONLY`、规格 SHA/工具锁及 ffmpeg/ffprobe 绝对路径+SHA、真实六项 TEST 身份；`files` 恰好四媒体加 SRT，每项 `name/path/bytes/sha256/usage`。最终清单 SHA 只能在实际文件写后回算，不能预填。

以下是包装器固定的**子进程参数**，不直接执行主脚本：

```powershell
node 'C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\native-source-qa-20260924\freeze-mlt-five-inputs-v1.mjs' `
  '--mode=freeze' `
  '--four-manifest=C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\qa02-mlt-test-20260928\four-media-20260928T022740Z\four-media-manifest.json' `
  '--four-sha256=211DDD8872F1DE47A569849C7A6AE9763D125DF6BAE9F8416534976C5B83FF78' `
  '--qa01-identity=C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\qa01-mlt-20260928\script-identity-readback-01\IDENTITY-READBACK.json' `
  '--qa01-identity-sha256=67E4DAD955BC59EC573ADE5CD2373678738797CEC22022DFC4B0CC7798B4D32E' `
  '--qa01-capture=C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\qa01-mlt-20260928\script-identity-readback-01\CAPTURE.json' `
  '--qa01-capture-sha256=33B1E446820C663126D241F2ADB7C07B3E51E29F565EE02E8FDD429ECDB87F2A' `
  '--output=C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\qa02-mlt-test-20260928\five-inputs-20260928T035901Z'
```

一次性外置包装器 `invoke-mlt-five-input-freeze-once-v1.mjs` SHA256 `2101F9C363B2AA1354EFE71283DC01FA3726EC2D0FA0A5ACB8D5659350233E8A`。实际执行只调用包装器，并提供 MGR02 新批准文件及其 SHA；包装器先核批准 JSON 的 `kind=MGR02_QA02_MLT_FIVE_INPUT_FREEZE_APPROVAL`、`scope=SYNTHETIC_TEST_ONLY`、`maxAttempts=1`、`noMlt=true`、目标目录、计划/脚本/包装器/四媒体/QA01 两证据的 SHA。批准 JSON 未创建，绝不代填批准哈希。

批准后唯一顶层命令的形状（两处批准路径与 SHA 由 MGR02 在审门后给出）：

```powershell
node 'C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\native-source-qa-20260924\invoke-mlt-five-input-freeze-once-v1.mjs' `
  '--approval=<MGR02批准JSON绝对路径>' `
  '--approval-sha256=<MGR02批准JSON的SHA256>'
```

包装器在调用 Node 子进程前，以独占新目录 `qa02-mlt-test-20260928/invocations/five-inputs-20260928T035901Z` 写 `intent.json`（时间、Node 路径/哈希、完整命令参数、cwd、输入/计划/脚本/包装器/批准 SHA）。子进程启动即把 stdout/stderr 分别直接重定向到 `stdout.raw`、`stderr.raw`，不经文本转换；`receipt.json` 记录 PID、exit code/signal、同步或异步 spawn error、开始/结束时间、两 raw 哈希及生成清单哈希。目录和文件均不得覆盖；失败时保留 raw、标 `FAILED_RAW_PRESERVED_NO_RETRY`，不自动重试。成功也只标 `FIVE_INPUTS_FROZEN_NO_MLT`，待另行独立读回五文件、manifest、SRT 与进程退出。

`FIVE_INPUTS_FROZEN_NO_MLT` 只说明五件 QA 原始文件与 TEST 脚本身份固定。每件输入进入受控工程前仍须另有选定 AssetVersion、真实文件 SHA、权利决定及 pinned ffprobe/音频 inspection；合成用途标签不能替代这些门。melt runtime 未获用户批准，不能下载、安装或运行；这里也不声称真实预览、MP4 或中文对白已通过。
