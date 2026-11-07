# StoryFilm 原创作链跨任务失败保护

本片仅覆盖 `StoryFilmService.produce` 的真实 Grok image/TTS/video 链，单镜和有序 shot-list。独立 image/TTS/edit/extend 等协议或 API 路由不在本片；它不是费用额度、报价、会员或试片质量授权。新配置界面由后续联合片接入，当前桥/API 可调用但不称完整用户入口已经交付。

## 两层身份与配置

- 旧 `GROK_VIDEO_SUBMIT_FAILURES`（51/52）仍按实际 video POST bytes 分桶；新的 `GROK_STORY_CREATION_FAILURES` 独立配置，不从旧视频限额推断允许数，默认为 UNCONFIGURED。严格 revision CAS、0..1000 显式整数；0 阻止新增请求，无默认 N、价格、usage 或 remaining。
- native 仅主帧固定频道 GET/PUT、API 项目 ID 与二字段更新；回执必须 exact scope、CONFIGURED、expected revision +1 与本次 limit。形状合法但旧/错回执仍 WRITE_UNCONFIRMED，不能自动 PUT 重试。真实账户沿原 main 签名 raw-body 通路，不接受 renderer 自造账户摘要；刷新 token、connection revision、scope 排序不重置原账户。
- 父身份由真正 pure prompt/delivery/reference producer 投影原有序创作：实际模型、有效画面/视频 prompt、voice 与 directed speech、请求时长/画幅、用户参考的真实 bytes。排 idempotency key、token revision、regenerate 开关、自动生成首帧结果和输出路径；已提供 first frame 时不让未消费的 image model 建新桶。无可证 bytes 的 HTTP 引用仍拒绝，不凭 URL hash 冒充内容。
- 父桶不含每次随机生成的首帧，但每次真实 send 前会核 actual body：当前 producer 刚生成/准备的 image bytes 和当轮 speech-adaptive 精确秒数必须一致（不是任意可哈希图片或任意 cap 内秒数）。原 video 子桶继续独立绑定该次真实 body。

## 原子与结算

旧 cache 优先；缓存/GET/本地预检不占新增生成。未配置等可预知阻塞在第一新增生成前检查。首次真正 image/TTS/video POST 前 SQLite 原子 reserve；重启/并发/新 key 仍看到 PENDING/UNKNOWN。没有 HTTP 的同步取消才可释放本次未提交占位；已进入任何 transport 的异常、部分成功或不确定状态保守占位，不自动换 key/POST/整链重试。

父记录只有全部目标的可读视频与语音已验证才 SUCCEEDED。仅图片或单目标成功不释放整链；所有媒体真实完成后，本地 FFmpeg/字幕/export 失败不伪称 provider 失败。旧子视频恢复 GET 不单独重签整个父链成功；无法证明原全链结果时父占位保持 UNKNOWN，需要核对原任务，不把子缓存/技术或人工决定当父成功凭据。

53 为 additive：仅新增 `story_creation_failure_policy/attempt` 及其索引；51/52 原表 SQL、原状态/余额/不可变断言不改。新表为空不制造允许数。原五处 migration fixture 跟随 53；旧版本 fixture 真正移除未来表后再迁移，完整比对旧 SQL、attempt 与 recovery 行。

## 定向记录与范围

- 首轻量 identity 夹具把默认 9:16 再设 9:16，首失败留 `creative-budget-first-tests.log`；改为真实 16:9 对照，没有改算法。
- 旧 video fixture 首 6 项被新 UNCONFIGURED 正确拦下，`creative-budget-original-video-compat.log` 保留；仅显式配置独立 parent scope 后保原 video/GET/assertions。
- 10 文件 budget/migration 首轮 118/3 保 `creative-budget-final-budget-migrations.log`：新 SQL 对照需排新表 autoindex、旧 v51 fixture 未移除未来 53 表、旧恢复 producer fixture 未配置 parent。修后最终同源 `creative-budget-final-budget-migrations3.log` 121 项 / 70.07s 通过；旧 SQL/状态/锁/真实进程退出断言保留。
- 原 StoryFilm/B07/TLS/对白五文件首轮 74/5 保 `creative-budget-original-production-media.log`；5 项均是 TLS transparent client wrapper 未接受新回调，未到 transport，不归 provider 故障。接参 assert+透传后，原 TLS5 + parent12 的真实联合 17 项通过，保 403/SSL/脱敏/完整语音/缓存/旧短回包拒绝。
- 直接 private `_live_media` 测试显式调用同一 `_begin_creation` 初始化原 request/prepared/refs；未 monkeypatch identity compiler 或跳 SQLite/body/send 门。HTTP produce 自身复用初始化，旧手工费用/数量门不变。
- 旧两镜同 video 输入案例以 parent limit1、video limit1 实测两 POST、完整成功与仅一条父 SUCCEEDED 记录。另 partial→UNKNOWN、image 成功/TTS 未决、重启/刷新/新 key、并发、引用变化、actual image/秒数篡改 0 video POST、pre-send 取消 0 POST 均有真实 store/producer 对照。
- 真实配置主帧/沙箱/ACK 9 项、notice 111 项通过；历史文案 118/106/14 分组不降。正式 TS/native 类型、workspace build、Python mypy/Ruff/format、原生成合同与独立 compiled SDK44/main config 检查另有最终日志。SDK44 `/tmp/aivora-creative-budget-sdk44-final` 实际临时目录 require 全 exports；主配置真实 compiled IPC + loopback fake response，0 provider calls，无源码 fallback。

所有 provider 为 synthetic transport 或本机 TLS 替身，FFmpeg/SQLite/进程/原文件实跑；无真实会员、供应商或外网生成。最终完整 Python/coverage、完整 native/web 和真正配置 UI/Windows 联合由 root 固定源码验证，不能拿原 API52 的 5258/6 或这些定向数字替代 API53 全门。
