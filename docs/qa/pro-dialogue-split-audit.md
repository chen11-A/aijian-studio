# 完整句拆镜：真实 Pro 浏览器门

基线 `7e4d714`（已接真实 main 审核、接受、完整 delta 与实际备份核对的产品切片）。新增独立 `pro-dialogue-split` 普通 Ubuntu Chrome job：4 固定态 × 1280×800 / 1920×1080 × 16:9 / 9:16，共 16。原 292 态、整个原 workflow 前缀与几何阈值保持不变，目标总数 308。

| 固定状态                            | 实际 Pro 路径与断言                                                                                                                                                                                                                                       |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dialogue-split-review-accept`      | 剪辑→查看完整句拆镜方案；原完整台词、三段及 12 条 notes/limitations 可滚动查看，默认未选、唯一主动作禁用。关闭零 apply；重开明确勾选、双击只一次接受，真实 UI 采用返回的三新镜结构。旧五镜全部版本/原音轨不变，原镜三版仍在合成备份模型里。               |
| `dialogue-split-unknown`            | 明确接受后传输未知；核对期间 native active 返回 BUSY，不能清状态或重发。退出回执 unknown；受控 native 完成后，完整 fresh delta 与独立 backup 验证均通过才能解除 pending/退出 saved。                                                                      |
| `dialogue-split-foreign-conflict`   | 首次实际 prepare 回包受控等待，关闭仍可、quit saved；真实描述编辑后释放旧回复，旧卡不复活且零 apply。重新查看并接受后，未知期间再改描述、经作品菜单切另一集；常驻面板展示保留稿，明确采用已核对保存版后才放弃原稿，另一集完整 raw/写入次数/可见标题不变。 |
| `dialogue-split-backup-delta-guard` | 同一次接受的原生回读先缺一个子镜，不能成功或触发备份授信；切换为完整回读后 checksum 仍坏，继续 unknown，不允许放弃原稿的按钮。splitSource/历史标签本身不能确认，0额外 apply/restore。                                                                     |

四态都从真实导航和按钮进入，不用故事页或内部 React state 注入。素材是六镜、每镜三版的固定合成项目和原有效小视频；没有生成新媒体。所有可操作对话框检查原文/长说明/checkbox/关闭/主按钮及冲突文字备忘的滚动、遮挡和完整可达，保留原 probe 判定。每态独立上下文，页面/API/外部 HTTP 错误即失败；诊断仅封闭 state/control/kind、有限数值与固定源行号，最多 8 条，不输出原始正文/路径/堆栈。

另一集 baseline 沿用已实证的 `da2507` 就绪条件：该作品实际完成的 mix 回执 + 可见试听失败/波形结束 + 正常页脚保存完成，再取完整 raw 和写入计数；不使用任意一次 write 或 activeId 存储副作用判 current，不 sleep/强制 flush 来隐藏正常保存尾。

合法本机能力独立记录：本源 legacy assembly 初次为六条当前版路径；UI 接受后为余下五条已有视频路径及五个空对白槽，精确检查 series/paths/music/gain/dialogue，受控拒绝且不声称成片或声音播放成功。没有把本机合成当付费模型。波形读取/混音预览只返回可控失败元数据；TTS preview/provider、旧音频添加/建议、capture/restore、旧导出都禁止。后续 B08 共享 assembly ABI 接入时必须单独适配真实契约，不恢复旧 fallback。

这里的 prepare/apply/verify 是 synthetic native ABI，调用实际 shipped 句界/结构投影 helper，备份只是内存模型；**不能替代产品切片的真实 FS/checksum/CJS 测试，不能声称实际历史文件、MP4 编解码、试听或 Electron 全链路通过。** 长说明是明确的合成 notes；真实生产 notes 仍由 main 返回。

复跑：

```sh
node --test apps/studio-web/e2e/pro-dialogue-split-fixture.contract.mjs
node apps/studio-web/e2e/pro-dialogue-split-audit.mjs
# 可选已有服务：--url http://127.0.0.1:5173/ --browser /usr/bin/chromium
```

默认随机 loopback 进程内 Vite，在 finally 关闭。Chrome 始终 `chromiumSandbox:true`；未绕过本机沙箱限制。输出安全限制与旧 CLI 相同，退出 0 仅限 16 态全部达到所有断言；失败 1、环境/参数失败 2，截图/JSON 在忽略目录。CI 上传仅明确 report.json 与两窗口 PNG，hidden=true、7 天，不上传 cache。

本地新增默认模式、production whole-review validator、完整投影/备份 hash、first-hold/unknown/坏回读/CAS、零付费、CLI 和受控安全注释共 12 项契约通过；与旧五套契约联合 59 项通过，日志 `/tmp/dialogue-split-browser-contract.log`、`/tmp/dialogue-split-browser-contracts-joint.log`。整份原 workflow prefix 字节一致，job 名无重复；目标 Node syntax/ESLint/Prettier/diff 检查记录在本轮日志。**正常 Chrome 16 态正向尚待远端 CI，不能把 Node 结果写成像素验收。**

本次审计期望修正：source `a483796` 的正常 Chrome run `42335767064` 在公开的 review-accept / unknown 组合报第二次合成参数不符。实际结构由六镜变八镜，但三条新镜尚无视频，生产 `dialogueTracks` 只为五条可导出视频生成五个槽；原八槽期望错误。受控测试以真实结构投影和生产函数复现旧期望失败，再验证五路径/五槽、旧媒体与完整备份不变；浏览器仍保留两次精确调用、全部状态与几何。此次只修 QA，正常 Chrome 复验待新 CI。
