# 真实 Pro 助手参考浏览器门

入口：`node apps/studio-web/e2e/pro-mentions-audit.mjs`。复用原 Vite／随机 loopback 端口／Chrome 生命周期，可传既有 `--url`、`--browser`、允许的临时或忽略目录 `--out`；不递归清理用户目录。默认启动和 finally 清理原 runner，`chromiumSandbox:true`，禁止关闭沙箱。外部 HTTP 与 `/api` 一律阻断；文本和 native ABI 是受控替身，不访问会员或供应商。

| 固定状态                | 实际交互与断言                                                                                                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `refs-menu-project`     | 角色页实际 @ 菜单点击完整长人物名和带空格地点，真实解析／白名单 context／捕获用户要求，明确全项目 art 范围；完整长字段可读、默认未确认不修改，确认／不要控件可滚动可达。               |
| `refs-director-inverse` | 真实分镜 AI 输入当前场镜头参考；生产导演／表演链继承同次场范围，完整结构卡确认前不改；明确确认替换首镜，真实 postSelection 下专属撤销恢复原镜序，外场原媒体／版本保留，零隐藏 writer。 |
| `refs-invalid`          | 实际重名菜单禁用，手动输入重名／未知／未完成 token，精确短句、零文本请求、保完整输入，不自动切选镜。                                                                                   |
| `refs-stale`            | 默认确实 hold 已准入回复；期间输入下一稿、真实跨页返回及改名，旧回复不能发布／清新稿；新明确请求独立捕获，再改名后旧 pending 确认拒绝，实际画风及已保存媒体不变、不重发。              |

每态覆盖 1280×800／1920×1080 与 16:9／9:16，共 **16 个执行组合**。每次先断言真实 stage／卡片／实际控件到达，再跑原 `probeProLayout`，保原遮挡、溢出、裁切阈值；随后真实 scrollIntoView／试点击验证全控件可达，不注入 CSS／React state／时间 getter。报告保存各固定阶段几何与截图，失败最多 8 条公开注释，state/control/class 双白名单及有界 checkLine／数值，不输出原始正文、DOM、错误、路径或凭据。

合成工程 6 镜：当前场 2 镜为空素材，允许原生产结构规则审核替换；另场 4 镜各保留原 3 个版本。不借合成夹具放行删除受保护的目标媒体。初始化使用真实 Pro 规范化与普通保存；Node 投影验证使用同样的 `applyContinuityChecks(upgradeFilm)`，不把未规范化 seed 冒充生产请求基线。真实 native 文件／媒体／授权能力不由本门认证。

独立普通 Ubuntu `pro-mentions` job 复用既有固定 Actions／Node24.15／pnpm frozen，先跑 `*.contract.mjs`，只上传独立 `report.json` 和两窗口目录 PNG（包括各阶段截图），hidden=true、保留 7 天、无新缓存。原 workflow 完整前缀、原所有 profile／次数／默认行为保留；只扩闭合 profile 与诊断标识。

复跑：`node --test apps/studio-web/e2e/pro-mentions-fixture.contract.mjs`；全部契约 `node --test apps/studio-web/e2e/*.contract.mjs`。本机日志 `/tmp/mentions-browser-contract-final.log`（10）与 `/tmp/mentions-browser-all-contracts-final.log`（旧80＋新10=90）；首轮 Node 投影因未纳入原初始化检查而返回 null 的失败保留在 stage 日志，已按真实初始化修正，没有改生产投影。缺浏览器负向确实退出2、report仍标16与沙箱true，不能作为正常 Chrome 通过。

现有矩阵从实际导出数组核数：core24＋full15×4=60＋独立url/core24＋QC32＋progress32＋features6×4=24＋creation32＋mix／library／shot／groups／dialogue／assembly／scene各16=340。340是累计执行组合，core/url包含重复场景；新增本片接入后应为356。**当前新增正常 Chrome 尚未验，不能写356已通过**；现有真实会员、文件复制／解码／试听、画面理解及 Electron 验收边界不变。
