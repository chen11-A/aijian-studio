# 四轨设置与试听：真实 Pro 浏览器门

独立 `audio-mix` profile，4态 × 1280×800/1920×1080 × 16:9/9:16，共16态。原196态与 creation32不减次数，不改几何阈值、quality矩阵或原job。必须从实际剪辑页到达后检查控件遮挡、裁剪、溢出及真实滚动/点击，不把组件测试当浏览器验收。

| 固定状态          | 实际路径与断言                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| mix-lane-settings | 剪辑→四个整轨slider用真实键盘调整→静音对白；canonical保存后真实镜头对比选第2版，整轨设置仍在，各旧片段gain/全部版本不变。                                          |
| mix-solo-export   | 实际点“单听环境音”，不改record；打开导出成片→默认关闭的自动调整音量→检查成片，精确核对工程/全部选版、实际QC settings不含solo，可信本机检查被替身明确拒绝，不发布。 |
| mix-preview-retry | 真实hook先save/read/hash后请求；8次BUSY后真实有限等待结束与失败短句、重试按钮；重试promise受控暂停，仍是核对中，失败后可再次重试READY，不声称已播放。              |
| mix-stale-reply   | 旧请求暂停→实际镜头对比换版→新canonical hash请求先READY→释放旧失败回包；不能出现旧失败/重试状态，旧片段/全部takes仍在。                                            |

保留六镜三版及四轨当前素材，并额外保留第3版旧配音、停用配音和未绑定配音；它们不能成为当前版对白或自动被绑定。合法的本机 `assembleFilm` 另记录并受控拒绝，精确核对原六镜所选路径、音乐/音量和唯一已绑定且启用的对白；初次一次，真实换版再一次。生成、配音、模型、旧导出及其他意外调用仍须为零，不把本机合成视作付费模型。

替身 `getFilmAudioMixPreview({projectId,expectedHash})` 必须匹配实际canonical clone写回/读取与稳定JSON SHA256。READY由生产共享 `buildAudioMixPlan` 编译，源读取返回本工具生成的确定性两秒单声道PCM静音，并核SHA/有界读取参数；不是产品默认素材。保留真实Chrome AudioContext，不以原视频声音代替混音。波形读取独立明确未提供工具，不造峰值。这些状态证明合成数据下的UI/ABI与守卫，不代表听感、最终混音、真实本机文件、FFmpeg或Electron全链路；后者以既有独立原生测试为准。

```sh
node --test apps/studio-web/e2e/pro-audio-mix-fixture.contract.mjs
node apps/studio-web/e2e/pro-audio-mix-audit.mjs --out .aijian-dev/pro-audio-mix-audit
# 可复用已有loopback服务，生命周期与安全规则同其他Pro门：
node apps/studio-web/e2e/pro-audio-mix-audit.mjs --url http://127.0.0.1:5173/ --out /tmp/pro-audio-mix-audit
```

默认自启/关闭进程内Vite；Chrome自身沙箱始终开启，禁止no-sandbox；阻断所有外部HTTP及/api。输出仅允许临时/忽略目录，不删除用户目录。0仅代表完整16态全过，1是行为/布局失败，2是环境/参数失败。失败截图、JSON和busy/失败/受控pending的分阶段截图保留；公开注释最多8条，只有固定状态/控件/类名、安全环境码、有界行号与数值矩形，不输出DOM、响应正文、路径、key或异常堆栈。

Node-only契约使用 `.contract.mjs`，由CI显式 `node --test`，不加入Vitest默认发现。本机只做契约/静态/负向；当前机器无可用Chromium沙箱，正常16态正向须由普通Ubuntu CI验证，不绕过沙箱。

本机结果：新8项与原creation8项Node契约联合16项通过，目标ESLint/Prettier/语法/diff检查通过；Vitest发现仍为408个原测试文件，两个node-only契约均未被收集。缺浏览器负向实际exit2、0正向/预期16、sandbox=true，退出后Vite端口已关闭；原workflow完整前缀相对4395cde字节相同。证据 `.aijian-dev/pro-audio-mix-negative/{report,verification}.json`，日志 `/tmp/audio-mix-audit-final-{contract,lint,prettier}.log`；16态正常Chrome结果待CI。
