# 整场声音建议：正常沙箱浏览器门

基线 `b100cfd`，复用真实 ProWorkspace、保存队列、全局待核对面板及原几何探针。新增固定四态 × 1280×800／1920×1080 × 横／竖画幅，共十六态；原三百二十四态、原 job 与断言不删不改。新增普通 Ubuntu runner 的 `pro-scene-audio` job，Node 24.15.0 与预装 Google Chrome；始终保留 Chromium 自身沙箱。

| 状态                           | 实际操作与保护                                                                                                                                                                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scene-audio-review`           | 剪辑→查看本场声音建议，核三轨各两段、全片六镜时钟与每段包络、全部长提醒／限制；默认空选、确认禁用，查看与关窗零 apply，人工审阅时 quit 不 busy。                                                                                               |
| `scene-audio-confirm-remove`   | 真实填写描述→查看→选完整环境音和音效；关窗不提交、重开仍空选；明确一次 scene apply 后四段跨镜组保存，旧片段与全部 takes 保留。字段撤销不移声音组；随后整组移引用、保留合成文件登记。                                                           |
| `scene-audio-unknown`          | 丢 ACK 后不重发，原生 actor 未结束时 inspect BUSY／quit unknown；用户在真实界面改描述并切另一集，等待该作品 wave／preview／assembly 与保存完成的同 scope 基线后完成原 actor、从全局面板核对。原稿合并四段，另一作品完整 raw 与写次数保持不变。 |
| `scene-audio-partial-conflict` | 部分回执不冒成功；真实剪掉非首镜后保留未保存稿，从全局面板查看冲突。只有显式采用重新核对的已保存完整版本才恢复该镜并清 unknown，没有再次 apply。                                                                                               |

夹具使用真实 206 条目录的公开名称、来源、许可、SHA 等 metadata。时钟、native 文件登记、返回项目和回执均是合成 ABI；不代表真实文件复制／解码、试听、素材授权或 Electron 验收。移组摘要使用现有正式纯 helper 的逐成员及集合 SHA，不靠组字段或当前镜子集授信。scene producer 的精确 raw CAS 漂移返回真实 `PROJECT_CHANGED`，不把合法保存竞争当成 mock throw；成功回包仍要求当次完整选择和 hash 匹配。

复跑：

```sh
node --test apps/studio-web/e2e/pro-scene-audio-fixture.contract.mjs
AIVORA_CHROMIUM=/usr/bin/google-chrome AIVORA_AUDIT_OUT=.aijian-dev/pro-scene-audio-audit node apps/studio-web/e2e/pro-scene-audio-audit.mjs
```

可用既有受控 `--url http://127.0.0.1:5173/`；默认进程内 Vite 随 finally 关闭。输出只允许临时／忽略目录，不递归删除调用者目录；外部 HTTP/API 全阻断，零 provider／旧 export／旧 assembly／旧单素材 add。报告固定源文件 hash，失败只发封闭状态／控件／有限矩形与行号，最多八条注释；完整 JSON 与两窗口 PNG 用精确路径上传，hidden=true、七天，无缓存目录。

本地证据：新九项契约通过；旧新七十一＋九项联合八十项通过，日志 `/tmp/scene-browser-contract-final.log` 与 `/tmp/scene-browser-all-contracts-final.log`，不相加重复计数。契约调用真实默认模式，含缺浏览器 exit2 报告、非法 URL／输出／参数、计数固定十六、隐私与非有限值不出注释。新十六态正常 Chrome 正向待 CI，不能把静态／Node 通过写成像素通过。
