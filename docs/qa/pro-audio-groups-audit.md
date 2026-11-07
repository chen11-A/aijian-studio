# 本镜配声建议：明确选用与整组核对浏览器门

本门运行真实 `ProWorkspace`，从剪辑页“查看本镜声音建议”进入；使用六镜、每镜三版及一条原有声音的合成工程。新增独立 `pro-audio-groups` Ubuntu job，原 276 态及既有质量门保持不变；新增 4 态 × 两窗口（1280×800、1920×1080）× 两画幅（16:9、9:16）共 16 态，合计 292。

| 固定状态                        | 实际操作与保障                                                                                                                                                                                                    |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `audio-groups-confirm-remove`   | 默认不勾选；勾选后关闭零写入；重新打开仍未选。明确选择环境音和音效两条完整轨道后只发一次 RPC，四段及完整包络加入；原片段/素材/版本保留。原字段撤销保留新组；明确“移除第1组声音”只移除该组引用，合成文件登记保留。 |
| `audio-groups-busy`             | 默认 native 准入即受控等待，重复点击不重发，关闭及选择锁定；退出回执为 busy。释放后需完整回执与真实存档采用，才显示保存完成。                                                                                     |
| `audio-groups-unknown`          | 传输未知不重发；原生未完成时核对返回 BUSY，退出 unknown。通过真实描述编辑、作品菜单切集，再核对原工程完整追加；当前另一集的完整 raw 与写入次数不变，原工程保留后来的文字编辑。                                    |
| `audio-groups-partial-conflict` | native 合成完整追加但回执缺成员，不能报成功。完整 fresh readback 仍不把不完整回执当成功；显示冲突选择，只有用户明确采用已保存版本后解除 pending，始终只一次选用。                                                 |

选择环境音和音效是明确的三轨子集，保留各自完整两段；配乐保持未选择，原本机六镜合成被受控拒绝且精确检查系列、六条当前版本路径、配乐参数及对白参数。所有付费/模型、旧单素材 add、工程包与导出派发仍禁止。没有把本机合成列为模型调用，也未把选择行为写成生成音频。

每个状态独立浏览器上下文，先断言真实剪辑页及对话框到达。沿用原几何阈值、滚动完整可达与可点击检查；保留页面错误、外部 HTTP/API 阻断、有限 source-line/控件枚举与最多 8 条安全 CI 注释。源指纹覆盖真实 Pro、队列、组 proof/helper、native、组件及固定 QA 源文件。截图与完整报告仅在指定忽略目录输出。

复跑：

```sh
node --test apps/studio-web/e2e/pro-audio-groups-fixture.contract.mjs
node apps/studio-web/e2e/pro-audio-groups-audit.mjs
# 可选：--url http://127.0.0.1:5173/ --browser /usr/bin/chromium
```

默认进程内 Vite 在 finally 关闭；Chrome 始终保留沙箱，输出目录沿用安全限制。CI 仅上传明确 report.json 与两窗口 PNG，隐藏文件允许、保留 7 天，不上传缓存。契约使用 `.contract.mjs`，不进入 Vitest 测试发现。

本地新增 11 项 Node 契约通过：真实默认 hold/unknown/partial 模式、完整成员与集合 SHA、CAS 变化拒绝、另一集 write 不抢 active、0 付费、CLI 安全输入、16 态报告及双白名单注释。与既有 35 项 Node 契约联合，共 46 项通过。日志 `/tmp/audio-groups-browser-contract.log`、`/tmp/audio-groups-browser-contracts-joint.log`。

**边界：16 态正常 Chrome 正向仍待 CI，不能把 Node 契约当成像素通过。** 这是 synthetic native ABI、合成文件登记与 UI 交互，不是真实媒体复制、ZIP、解码、试听、FFmpeg 或 Electron 全链路；真实 native 文件/摘要/复制已有独立 desktop 测试。浏览器未调用真实 provider，也没有关闭 Chrome 沙箱。
