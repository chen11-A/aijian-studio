# 七段说明与工程包：真实 Pro 浏览器门

新增独立 `pro-creation` profile：8 个实际交互态 × 1280×800/1920×1080 × 16:9/9:16，共 32 态。复用原 ProWorkspace、合成六镜三版工程、有效本地测试视频与原几何探针；原 core24/full60/url24/QC32/progress32/features24 共 196 态不减次数、不放宽阈值。此门不代表所有页面、像素/动作审核、真实原生选择器或 Electron 全链路验收。

| 固定状态                | 必须实际操作与断言                                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| seven-preview           | 分镜→属性→高级→整理视频说明，真实七段/一字段预览，确认前完整存档不变、零媒体派发                                            |
| seven-confirm           | 实际确认并保存，再调用浏览器加载的真实 storyFilmBatches，消费文本与显示的完整提交说明相同；保留全部原媒体和版本             |
| seven-stale             | 实际修改分镜画面后拒绝旧确认；重新整理后进入单镜并实际打开 AI 助手，同页卡仍可确认；点击第2版后拒绝过期确认，保留所有 takes |
| seven-long-unknown      | 长事实与提交说明展开/滚动可读，未知身份及声音能力边界清楚，不把全库人物或后期声音设想塞入视觉请求                           |
| archive-export          | 作品菜单→导出工程包→实际按钮，精确工程身份/hash、忙碌禁重复，受控原生 ABI 成功与原媒体保留                                  |
| archive-export-outcomes | 真实缺源失败再重试取消，错误/取消准确、原工程保留                                                                           |
| archive-import-reopen   | 作品菜单→打开工程包→按钮，新 ID 入库/打开，实际作品菜单切回原作品并重新打开新作品，旧新均保留                               |
| archive-import-guard    | 导入处理中禁止关闭/重复请求，实际菜单选项须由真实 modal 挡住；只做 trial，不强点穿透。回包仅打开新 ID，原作品保留           |

先断言真实页签或对话框到达，再量控件遮挡/裁剪、文档溢出、候选卡边界。主要按钮、关闭与展开控件须真实滚动到完整可见并通过点击 trial；禁用态仍量几何。每个逻辑审核卡或对话框只能有一个可见主动作。不会跳过旧项目、禁用按钮、待回包态或以强制点击穿过遮挡。该导入态验证忙碌 modal 的真实设计；浏览器不声称切作品后迟到 guard 已覆盖，跨工程保护另由既有 ProWorkspace.project-archive.test.tsx 宿主 prop 切换回归证明。

所有状态在独立 Chromium context 中运行，阻断外部 HTTP 和全部 `/api`。供应商、配音、旧导出等一律禁止，不能借布局测试付费。工程包浏览器仅模拟 native ABI 的 canonical clone/hash 与返回值，不执行 ZIP/文件系统，也不冒充已有真实 main/ZIP 往返测试。保留合法本机 assemble 的独立记录与受控拒绝；这些 32 态预期不进入剪辑合成，若触发将失败，不悄悄移出 forbidden 来取得通过。

```sh
# 无浏览器的真实编译器/替身存档/指纹/CLI 安全契约：
node --test apps/studio-web/e2e/pro-creation-fixture.test.mjs
node apps/studio-web/e2e/pro-creation-audit.mjs --help
node apps/studio-web/e2e/pro-creation-audit.mjs --browser /usr/bin/google-chrome --out .aijian-dev/pro-creation-audit
# 也可复用已有本机 Vite：
node apps/studio-web/e2e/pro-creation-audit.mjs --url http://127.0.0.1:5173/ --browser /usr/bin/chromium --out /tmp/pro-creation-audit
```

默认在 Node 内启动随机 loopback 端口的 Vite，并在 finally 关闭 HTTP/Vite/浏览器。只允许临时目录或仓库 `.aijian-dev` 产物目录，不递归清空用户提供的目录。Chrome 始终保留自身沙箱；不允许 `--no-sandbox`。退出码 0=32 态全部过，1=交互/布局回归，2=配置或环境失败。

报告记录固定状态计数、源码 SHA256、到达、几何、按钮可达性和每态 PNG。源码指纹包括真实七段编译/请求/事务、工程包 UI/portable main/桥与脚本。公开失败注释仅输出双白名单状态/控件/元素/CSS 类、有界行号和几何数值，最多 8 条；不输出正文、DOM、路径或 key。完整失败定位以截图和 report 为准。

独立普通 Ubuntu `pro-creation` job 使用系统 Google Chrome、Node24.15、frozen pnpm，无新增共享缓存；无论失败与否只上传 report 和两窗口 PNG，hidden 开启、保留 7 天，排除 Vite cache。当前本机沙箱限制下仅验证静态、负向和替身契约；32 态正向结果必须等真正 GHA Chrome，不把源码存在或本机 setup 失败说成通过。

## 首次云端失败后的导航修正

首次普通 Chrome 的 32 态中，4 个 `seven-stale` 组合在原第265行失败。源码中“单个镜头”只切换分镜的显示方式（`stage=board` 不变），但单镜右栏默认打开“属性”，七段卡只有实际切到“AI 助手”才挂载。原脚本直接查询未挂载的卡，未完成真实导航。现先实际点击 AI 助手并断言卡可见，再保留原“同页切显示方式不失效”和选版后失效的全部断言；未修改产品或降低几何门。修订后的正向结果仍待新的正常沙箱 Chrome 运行。
